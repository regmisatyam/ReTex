import {
  DiagnosticCode,
  DiagnosticSeverity,
  type AuthorNode,
  type BibItemNode,
  type CaptionNode,
  type Diagnostic,
  type DocumentNode,
  type FieldMap,
  type ListItemNode,
  type MarkNode,
  type Node,
  type PartialTheme,
  type SectionNode,
  type TableAlign,
  type TableCellNode,
  type TableRowNode,
  type Theme,
} from "../types/index.js";
import { flattenText } from "../ast/text.js";
import { validate } from "../validator/index.js";
import { isBlockNode } from "../renderers/context.js";
import { applyPaperOptions, paperStyleNames, paperThemes } from "../theme/papers.js";
import {
  lineDiagnostic,
  parseBlocks,
  type BlockContext,
  type LinkDefinition,
  type MdBlock,
} from "./blocks.js";
import { extractFrontMatter, type FrontMatterValue } from "./frontmatter.js";
import {
  bracesBalanced,
  parseInline,
  type InlineContext,
  type TitledImage,
} from "./inline.js";

export interface MarkdownOptions {
  /** Paper style: `normal` (the default), `ieee`, `acm`, `arxiv`, `lncs`, `apa`, `journal`. */
  style?: string;
  /** Text columns per page, overriding the style. */
  columns?: 1 | 2;
  /** Page size, overriding the style. */
  pageSize?: "Letter" | "A4";
  /** Base font size, overriding the style. */
  fontSize?: "10pt" | "11pt" | "12pt";
  /** Force automatic section numbering on or off, overriding the style. */
  numbering?: boolean;
  /** Paper title, overriding anything found in the document. */
  title?: string;
  /** Authors, overriding anything found in the document. */
  authors?: Array<string | FieldMap>;
  /** Abstract text (Markdown), overriding anything found in the document. */
  abstract?: string;
  /** Keywords, overriding anything found in the document. */
  keywords?: string[];
  /** Publication date, overriding anything found in the document. */
  date?: string;
  /**
   * Clean up what AI assistants add around an answer: "Sure! Here's…" and "Let me
   * know if…" lines, citation markers like `【4†source】`, and emoji in headings.
   * Each removal is reported as a diagnostic. Default `true`.
   */
  stripChatter?: boolean;
  /** Resolve style names beyond the built-ins. The engine wires this up for you. */
  lookupStyle?: (name: string) => PartialTheme | undefined;
}

export interface MarkdownResult {
  /** An ordinary ReTeX document: every renderer and the printer accept it. */
  ast: DocumentNode;
  diagnostics: Diagnostic[];
  /** The paper style that was applied. */
  style: string;
}

/* ------------------------------ AI cleanup ------------------------------ */

const ARTIFACT_PATTERNS = [
  /【\d+(?::\d+)?†[^】]*】/g,
  /:contentReference\[oaicite:\d+\]\{index=\d+\}/g,
  /\[cite_start\]/g,
  /\[cite:\s*[\d,\s]+\]/g,
  /\ue200[^\ue201]*\ue201/g,
];

const OPENING_CHATTER = [
  /^(?:sure|certainly|of course|absolutely|great|okay|ok|alright)\s*[!,.:—–-]/i,
  /^(?:here(?:'s|’s| is| are)|below is)\b.*[:.!]$/i,
  /^i(?:'ve|’ve| have)\s+(?:written|drafted|prepared|put together|created)\b/i,
];

/** Only phrases that offer more help: this must never eat a real closing sentence. */
const CLOSING_CHATTER = [
  /^(?:let me know|feel free to|want me to|shall i|i can also)\b/i,
  /^if you(?:'d|’d| would) (?:like|prefer)\b/i,
  /^if you (?:want|need|like)\b.*\b(?:i can|i could|let me know|just ask|feel free)\b/i,
  /^(?:would you like|do you want)\b.*\?$/i,
  /^(?:i )?hope (?:this|that) (?:helps|is helpful|was helpful)\b/i,
  /^happy to (?:help|assist|expand|adjust|refine)\b/i,
];

const EMOJI_PREFIX_RE = /^[\p{Extended_Pictographic}\ufe0f\u200d\s]+(?=\S)/u;

/** The words of a raw line, without the emphasis markers around them. */
const plain = (text: string): string => text.replace(/[*_`]/g, "").trim();

function removeChatter(blocks: MdBlock[], diagnostics: Diagnostic[]): MdBlock[] {
  const out = [...blocks];

  const first = out[0];
  if (
    first?.kind === "paragraph" &&
    out.length > 1 &&
    first.text.length <= 300 &&
    !first.text.includes("\n") &&
    OPENING_CHATTER.some((re) => re.test(plain(first.text)))
  ) {
    diagnostics.push(lineDiagnostic(`Removed opening chatter: "${first.text}"`, first.line));
    out.shift();
  }

  const last = out[out.length - 1];
  if (
    last?.kind === "paragraph" &&
    out.length > 1 &&
    last.text.length <= 300 &&
    CLOSING_CHATTER.some((re) => re.test(plain(last.text)))
  ) {
    diagnostics.push(lineDiagnostic(`Removed closing chatter: "${last.text}"`, last.line));
    out.pop();
  }
  return out;
}

/* --------------------------- document metadata ------------------------- */

interface Front {
  title?: string;
  authors: FieldMap[];
  date?: string;
  abstract?: MdBlock[];
  keywords?: string[];
}

const SECTION_NAME_RE =
  /^(?:introduction|background|overview|summary|abstract|motivation|related work|methods?|methodology|results?|discussion|conclusions?|references)$/i;
const ABSTRACT_RE = /^abstract[:.]?$/i;
const KEYWORDS_RE = /^(?:keywords?|key words|index terms)[:.]?$/i;
const REFERENCES_RE =
  /^(?:references?|bibliography|works cited|literature cited|citations|sources)[:.]?$/i;
const UNNUMBERED_RE =
  /^(?:acknowledge?ments?|funding|conflicts? of interest|competing interests|author contributions?|data availability|appendix\b.*|appendices)[:.]?$/i;

const META_RE =
  /^([*_]{0,2})\s*(authors?|affiliations?|institutions?|e-?mail|date|keywords?|key words|index terms|abstract|title)\s*([*_]{0,2})\s*([:.—–-]?)\s*([*_]{0,2})\s*(.*)$/i;

/** Recognise a `**Label:** value` line, returning the label and its value. */
function metaLine(line: string): { label: string; value: string } | undefined {
  const m = META_RE.exec(line.trim());
  if (!m) return undefined;
  const opened = m[1] !== "";
  const closed = m[3] !== "" || m[5] !== "";
  const separator = m[4]!;
  // Plain "Abstract art is…" is prose: require emphasis or an unmistakable colon.
  if (!opened && separator !== ":" && separator !== "—" && separator !== "–") {
    return undefined;
  }
  if (opened && !separator && !closed) return undefined;
  let value = m[6]!.trim();
  // `**Keywords: a, b**` closes its emphasis at the far end of the line.
  if (opened && !closed) value = value.replace(/[*_]{1,2}$/, "").trim();
  return { label: m[2]!.toLowerCase(), value };
}

/** Parse "Jane Doe (MIT), John Smith and Ann Lee" into author records. */
function parseAuthorList(value: string): FieldMap[] {
  return value
    .split(/\s*(?:[,;]|\band\b|&)\s*/)
    .map((part) => part.trim())
    .filter((part) => part && !/^(?:ph\.?d\.?|m\.?d\.?|jr\.?|sr\.?|et al\.?)$/i.test(part))
    .map((part): FieldMap => {
      const m = /^(.*?)\s*\(([^)]+)\)$/.exec(part);
      return m ? { name: plain(m[1]!), affiliation: m[2]! } : { name: plain(part) };
    });
}

const splitKeywords = (value: string): string[] =>
  value
    .split(/\s*[,;·•]\s*/)
    .map((k) => plain(k).replace(/\.$/, ""))
    .filter(Boolean);

function applyAffiliation(front: Front, key: "affiliation" | "email", value: string): void {
  // One value given for the whole paper applies to everyone it can.
  if (front.authors.length === 0) front.authors.push({ name: "" });
  for (const author of front.authors) if (!author[key]) author[key] = value;
}

/**
 * Consume `**Label:** value` lines from a paragraph at the top of the document,
 * returning whatever was not metadata. An abstract takes the rest of its paragraph.
 */
function consumeMetaLines(block: Extract<MdBlock, { kind: "paragraph" }>, front: Front): string {
  const lines = block.text.split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const meta = metaLine(line);
    if (!meta || (!meta.value && meta.label !== "abstract")) {
      kept.push(line);
      continue;
    }
    const { label, value } = meta;
    if (label.startsWith("author")) {
      if (front.authors.every((a) => !a.name)) {
        const previous = front.authors[0];
        front.authors = parseAuthorList(value).map((a) => ({ ...previous, ...a }));
      }
    } else if (label.startsWith("affiliation") || label.startsWith("institution")) {
      applyAffiliation(front, "affiliation", plain(value));
    } else if (label === "email" || label === "e-mail") {
      applyAffiliation(front, "email", plain(value));
    } else if (label === "date") {
      front.date ??= plain(value);
    } else if (label === "title") {
      front.title ??= value;
    } else if (label === "abstract") {
      const rest = [value, ...lines.slice(i + 1)].join("\n").trim();
      if (!front.abstract && rest) {
        front.abstract = [{ kind: "paragraph", text: rest, line: block.line }];
        break;
      }
      kept.push(line);
    } else {
      front.keywords ??= splitKeywords(value);
    }
  }
  return kept.join("\n").trim();
}

/** Decide whether the document's first block is its title, and take it if so. */
function takeTitle(blocks: MdBlock[], front: Front): MdBlock[] {
  const out = [...blocks];
  const index = out.findIndex((b) => b.kind !== "rule");
  const first = out[index];
  if (first?.kind !== "heading") return out;

  if (front.title !== undefined) {
    // A title in the front matter is usually repeated as the first heading.
    if (plain(first.text).toLowerCase() === plain(front.title).toLowerCase()) {
      out.splice(0, index + 1);
    }
    return out;
  }

  const headings = out.filter(
    (b): b is Extract<MdBlock, { kind: "heading" }> => b.kind === "heading",
  );
  const topLevel = Math.min(...headings.map((h) => h.level));
  const peers = headings.filter((h) => h.level === first.level).length;
  const isOutermost = first.level === topLevel;
  const standsAlone = peers === 1 && (first.level === 1 || headings.length > 1);
  const startsSeries = first.level === 1 && !SECTION_NAME_RE.test(plain(first.text));

  if (isOutermost && (startsSeries || (standsAlone && !SECTION_NAME_RE.test(plain(first.text))))) {
    front.title = first.text;
    out.splice(0, index + 1);
  }
  return out;
}

/** Everything before the first ordinary section can hold metadata. */
function takeFrontMatter(blocks: MdBlock[], front: Front): MdBlock[] {
  const out: MdBlock[] = [];
  let i = 0;
  for (; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (block.kind === "paragraph") {
      const left = consumeMetaLines(block, front);
      if (left) out.push({ ...block, text: left });
      continue;
    }
    if (block.kind !== "heading") {
      out.push(block);
      continue;
    }
    const name = plain(cleanHeadingText(block.text, true));
    if (ABSTRACT_RE.test(name) && !front.abstract) {
      const body: MdBlock[] = [];
      i++;
      while (i < blocks.length && blocks[i]!.kind !== "heading") {
        const part = blocks[i]!;
        // Keywords often sit at the end of the abstract, without a heading of their own.
        if (part.kind === "paragraph") {
          const left = consumeMetaLines(part, front);
          if (left) body.push({ ...part, text: left });
        } else if (part.kind !== "rule") {
          body.push(part);
        }
        i++;
      }
      i--;
      front.abstract = body;
      continue;
    }
    if (KEYWORDS_RE.test(name) && !front.keywords) {
      const next = blocks[i + 1];
      if (next?.kind === "paragraph") {
        front.keywords = splitKeywords(next.text.replace(/\n/g, ", "));
        i++;
      } else if (next?.kind === "list") {
        front.keywords = next.items
          .map((item) => (item[0]?.kind === "paragraph" ? plain(item[0].text) : ""))
          .filter(Boolean);
        i++;
      }
      continue;
    }
    break; // The first real section: the front matter is over.
  }
  return [...out, ...blocks.slice(i)];
}

function frontFromYaml(data: Record<string, FrontMatterValue>): Front {
  const text = (key: string): string | undefined => {
    const v = data[key];
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  const front: Front = { authors: [] };
  front.title = text("title");
  front.date = text("date");

  const authors = data.authors ?? data.author;
  if (typeof authors === "string") {
    front.authors = parseAuthorList(authors);
  } else if (Array.isArray(authors)) {
    front.authors = authors.map((a) => (typeof a === "string" ? { name: a } : a));
  }
  const affiliation = text("affiliation") ?? text("institution");
  if (affiliation) applyAffiliation(front, "affiliation", affiliation);
  const email = text("email");
  if (email) applyAffiliation(front, "email", email);

  const abstract = text("abstract");
  if (abstract) front.abstract = [{ kind: "paragraph", text: abstract, line: 1 }];

  const keywords = data.keywords ?? data.tags;
  if (typeof keywords === "string") front.keywords = splitKeywords(keywords);
  else if (Array.isArray(keywords)) {
    front.keywords = keywords.filter((k): k is string => typeof k === "string");
  }
  return front;
}

/* ------------------------------- headings ------------------------------ */

function cleanHeadingText(text: string, stripEmoji: boolean): string {
  return stripEmoji ? text.replace(EMOJI_PREFIX_RE, "") : text;
}

const DOTTED_NUMBER_RE = /^([*_]*)\d+(?:\.\d+)*[.):]\s+(?=\S)|^([*_]*)\d+(?:\.\d+)+\s+(?=\S)/;
const BARE_NUMBER_RE = /^([*_]*)\d+\s+(?=\S)/;
const LETTER_NUMBER_RE = /^([*_]*)(?:[IVXLC]+|[A-Z])\.\s+(?=\S)/;

/**
 * Build a function that removes hand-written numbers from headings. Without this
 * an AI's "## 1. Introduction" would come out as "I. 1. INTRODUCTION".
 *
 * Forms that could be ordinary words ("3 Body Problem", "C. elegans") are only
 * treated as numbers when the document uses them consistently.
 */
function headingNumberStripper(texts: string[]): (text: string) => string {
  const bareEverywhere = texts.length >= 2 && texts.every((t) => BARE_NUMBER_RE.test(t) || DOTTED_NUMBER_RE.test(t));
  const lettered = texts.filter((t) => LETTER_NUMBER_RE.test(t)).length >= 2;
  return (text) => {
    const keepEmphasis = (_: string, ...groups: unknown[]): string =>
      groups.find((g): g is string => typeof g === "string") ?? "";
    let out = text.replace(DOTTED_NUMBER_RE, keepEmphasis);
    if (out === text && bareEverywhere) out = text.replace(BARE_NUMBER_RE, "$1");
    if (out === text && lettered) out = text.replace(LETTER_NUMBER_RE, "$1");
    return out;
  };
}

/* ------------------------------ references ----------------------------- */

interface RawReference {
  key?: string;
  body: string | MdBlock[];
}

const REF_LINE_RE = /^\[([^\]\s]+)\]:?\s+(.*)$/;
const REF_NUMBER_RE = /^(\d+)[.)]\s+(.*)$/;

function referencesFromBlocks(blocks: MdBlock[]): RawReference[] {
  const refs: RawReference[] = [];
  for (const block of blocks) {
    if (block.kind === "list") {
      block.items.forEach((item, i) => {
        refs.push({
          ...(block.ordered ? { key: String(block.start + i) } : {}),
          body: item,
        });
      });
    } else if (block.kind === "paragraph") {
      // Consecutive `[1] …` lines are one Markdown paragraph, but separate entries.
      const lines = block.text.split("\n");
      let current: RawReference | undefined;
      for (const line of lines) {
        const m = REF_LINE_RE.exec(line.trim()) ?? REF_NUMBER_RE.exec(line.trim());
        if (m) {
          current = { key: m[1]!.replace(/^@/, ""), body: m[2]! };
          refs.push(current);
        } else if (current && typeof current.body === "string") {
          current.body += `\n${line}`;
        } else {
          current = { body: line };
          refs.push(current);
        }
      }
    }
  }
  return refs;
}

/* ------------------------------- conversion ---------------------------- */

const FIGURE_CAPTION_RE = /^[*_]*\s*fig(?:ure)?\.?\s*(?:\d+|[ivxlc]+)\s*[:.—–-]+\s*[*_]*\s*/i;
const TABLE_CAPTION_RE = /^[*_]*\s*tab(?:le)?\.?\s*(?:\d+|[ivxlc]+)\s*[:.—–-]+\s*[*_]*\s*/i;
const PLACEHOLDER_ALT_RE =
  /^(?:image|img|figure|fig|picture|photo|screenshot|diagram|chart|graph)(?:\s*\d+)?$/i;

/** A column is this many characters wide before a table outgrows one text column. */
const WIDE_TABLE_CHARS = 60;

/** The caption text in a "Table 1: …" paragraph, without its label or framing. */
function captionText(text: string, re: RegExp): string | undefined {
  if (text.length > 400 || text.includes("\n") || !re.test(text)) return undefined;
  const framed = /^[*_]/.test(text);
  let out = text.replace(re, "");
  if (framed) out = out.replace(/[*_]+$/, "");
  return out.trim();
}

const MAX_FOOTNOTE_DEPTH = 8;

class Converter {
  private readonly converting = new Set<string>();
  private currentLine = 1;
  readonly inline: InlineContext;

  constructor(
    private readonly footnoteDefs: Map<string, MdBlock[]>,
    linkDefs: Map<string, LinkDefinition>,
    private readonly twoColumn: boolean,
    private readonly diagnostics: Diagnostic[],
  ) {
    this.inline = {
      linkDefs,
      citeKeys: new Set(),
      footnote: (id) => this.footnote(id),
      warn: (message) =>
        this.diagnostics.push(
          lineDiagnostic(
            message,
            this.currentLine,
            DiagnosticSeverity.Warning,
            DiagnosticCode.UnsafeUrlBlocked,
          ),
        ),
    };
  }

  private footnote(id: string): Node[] | undefined {
    const def = this.footnoteDefs.get(id);
    // A note that cites itself would never finish converting, and a long chain of
    // notes citing notes would exhaust the stack.
    if (!def || this.converting.has(id) || this.converting.size >= MAX_FOOTNOTE_DEPTH) {
      return undefined;
    }
    this.converting.add(id);
    const nodes = this.blocks(def);
    this.converting.delete(id);
    return nodes;
  }

  inlineNodes(text: string): Node[] {
    return parseInline(text, this.inline);
  }

  /** Convert a run of blocks, keeping paragraphs apart with paragraph breaks. */
  blocks(blocks: MdBlock[]): Node[] {
    const out: Node[] = [];
    const consumed = new Set<number>();

    blocks.forEach((block, i) => {
      if (consumed.has(i)) return;
      this.currentLine = block.line;
      const next = blocks[i + 1];
      const previous = blocks[i - 1];

      switch (block.kind) {
        case "paragraph": {
          if (next?.kind === "table" && captionText(block.text, TABLE_CAPTION_RE) !== undefined) {
            return; // Becomes the caption of the table that follows.
          }
          if (
            previous?.kind === "table" &&
            !blocks[i - 2]?.kind.startsWith("para") &&
            captionText(block.text, TABLE_CAPTION_RE) !== undefined
          ) {
            return; // Already used as the caption of the table before it.
          }
          const nodes = this.inlineNodes(block.text);
          const only = nodes.length === 1 ? nodes[0] : undefined;
          if (only?.type === "image") {
            const nextCaption =
              next?.kind === "paragraph"
                ? captionText(next.text, FIGURE_CAPTION_RE)
                : undefined;
            if (nextCaption !== undefined) consumed.add(i + 1);
            out.push(this.figure(only, nextCaption));
          } else if (nodes.length > 0) {
            out.push(...nodes);
          }
          out.push({ type: "parbreak" });
          break;
        }
        case "heading":
          // Nested in a quote or list. Top-level headings are handled by the caller.
          out.push(...this.inlineNodes(`**${block.text}**`), { type: "parbreak" });
          break;
        case "code":
          out.push({
            type: "codeblock",
            value: block.value,
            ...(/^[\w+#.-]+$/.test(block.language) ? { language: block.language } : {}),
          });
          break;
        case "math":
          // A formula that could not be written back as source is shown as written.
          if (bracesBalanced(block.tex) && !block.tex.includes("\\end{equation}")) {
            out.push({ type: "math", tex: block.tex, display: true });
          } else {
            out.push({ type: "codeblock", value: block.tex });
          }
          break;
        case "quote":
          out.push({ type: "quote", children: this.blocks(this.githubAlert(block.blocks)) });
          break;
        case "list":
          out.push({
            type: "list",
            kind: block.ordered ? "enumerate" : "itemize",
            ...(block.ordered && block.start !== 1 ? { start: block.start } : {}),
            items: block.items.map((item): ListItemNode => ({
              type: "item",
              children: this.blocks(this.taskItem(item)),
            })),
          });
          break;
        case "table":
          out.push(this.table(block, previous, next));
          break;
        case "rule":
          // A divider before a heading is an AI habit; the heading already divides.
          if (i > 0 && next && next.kind !== "heading") out.push({ type: "rule" });
          break;
      }
    });

    while (out[out.length - 1]?.type === "parbreak") out.pop();
    // A block ends the paragraph before it anyway, and a stray break would make a
    // tight list item with a sublist look like a multi-paragraph one.
    return out.filter(
      (node, i) => node.type !== "parbreak" || !out[i + 1] || !isBlockNode(out[i + 1]!),
    );
  }

  private taskItem(blocks: MdBlock[]): MdBlock[] {
    const first = blocks[0];
    if (first?.kind !== "paragraph") return blocks;
    const m = /^\[([ xX])\]\s+/.exec(first.text);
    if (!m) return blocks;
    const box = m[1] === " " ? "☐" : "☑";
    return [{ ...first, text: `${box} ${first.text.slice(m[0].length)}` }, ...blocks.slice(1)];
  }

  /** GitHub's `> [!NOTE]` callouts read better in print as a plain label. */
  private githubAlert(blocks: MdBlock[]): MdBlock[] {
    const first = blocks[0];
    if (first?.kind !== "paragraph") return blocks;
    const m = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(first.text);
    if (!m) return blocks;
    const label = m[1]![0]!.toUpperCase() + m[1]!.slice(1).toLowerCase();
    return [
      { ...first, text: `**${label}.** ${first.text.slice(m[0].length)}` },
      ...blocks.slice(1),
    ];
  }

  private figure(image: Extract<Node, { type: "image" }>, caption?: string): Node {
    const titled = image as TitledImage;
    const title = titled.title;
    delete titled.title;
    let text = caption ?? title;
    if (text === undefined && image.alt && !PLACEHOLDER_ALT_RE.test(image.alt)) {
      text = image.alt.replace(FIGURE_CAPTION_RE, "");
    }
    const children: Node[] = [image];
    if (text) children.push(this.caption(text));
    return { type: "figure", children };
  }

  private caption(text: string): CaptionNode {
    return { type: "caption", children: this.inlineNodes(text) };
  }

  private table(
    block: Extract<MdBlock, { kind: "table" }>,
    previous: MdBlock | undefined,
    next: MdBlock | undefined,
  ): Node {
    const cell = (text: string): TableCellNode => ({
      type: "cell",
      children: this.inlineNodes(text),
    });
    const rows: TableRowNode[] = [
      { type: "row", header: true, cells: block.header.map(cell) },
      ...block.rows.map((r): TableRowNode => ({ type: "row", cells: r.map(cell) })),
    ];

    const captionSource =
      (previous?.kind === "paragraph"
        ? captionText(previous.text, TABLE_CAPTION_RE)
        : undefined) ??
      (next?.kind === "paragraph" ? captionText(next.text, TABLE_CAPTION_RE) : undefined);

    const align: TableAlign[] = block.align.some(Boolean)
      ? block.align.map((a) => a ?? "left")
      : [];

    // A table too wide for one text column spans the whole page instead.
    const widths = block.header.map((_, col) =>
      Math.max(
        plain(block.header[col] ?? "").length,
        ...block.rows.map((r) => plain(r[col] ?? "").length),
      ),
    );
    const total = widths.reduce((sum, w) => sum + w, 0);
    const wide = this.twoColumn && (block.header.length >= 5 || total > WIDE_TABLE_CHARS);

    return {
      type: "table",
      rows,
      align,
      ...(captionSource !== undefined ? { caption: this.caption(captionSource) } : {}),
      ...(wide ? { wide: true } : {}),
    };
  }

  /** Build a reference list, numbering entries that do not bring their own key. */
  references(raw: RawReference[]): Node {
    const used = new Set<string>();
    const keyFor = (ref: RawReference, i: number): string => {
      const key = ref.key && !used.has(ref.key) ? ref.key : String(i + 1);
      used.add(key);
      return key;
    };
    // Keys must all be known before any text is parsed, or `[1]` won't resolve.
    const keys = raw.map(keyFor);
    for (const key of keys) this.inline.citeKeys.add(key);
    return {
      type: "references",
      items: raw.map((ref, i): BibItemNode => ({
        type: "bibitem",
        key: keys[i]!,
        children: typeof ref.body === "string" ? this.inlineNodes(ref.body) : this.blocks(ref.body),
      })),
    };
  }
}

/** A plain-text-or-rich title, in the shape both `\section` and `\title` use. */
function richTitle(nodes: Node[]): { text: string; children?: Node[] } {
  // Emphasis around a whole heading adds nothing: headings are already bold.
  let content = nodes;
  while (
    content.length === 1 &&
    (content[0]!.type === "bold" || content[0]!.type === "italic")
  ) {
    content = (content[0] as MarkNode).children;
  }
  const text = flattenText(content).replace(/\s+/g, " ").trim();
  return content.some((n) => n.type !== "text") ? { text, children: content } : { text };
}

function documentClassFlags(
  options: MarkdownOptions,
  data: Record<string, FrontMatterValue>,
): string[] {
  const value = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const v = data[key];
      if (typeof v === "string" && v !== "") return v.toLowerCase();
    }
    return undefined;
  };
  const flags: string[] = [];

  const columns = options.columns ?? Number(value("columns") ?? NaN);
  if (columns === 1) flags.push("onecolumn");
  else if (columns === 2) flags.push("twocolumn");

  const page = (options.pageSize ?? value("pagesize", "papersize", "page", "paper"))?.toLowerCase();
  if (page === "a4" || page === "a4paper") flags.push("a4paper");
  else if (page === "letter" || page === "letterpaper") flags.push("letterpaper");

  const size = (options.fontSize ?? value("fontsize"))?.toLowerCase();
  if (size === "10pt" || size === "11pt" || size === "12pt") flags.push(size);

  const yamlNumbering = value("numbering", "numbered");
  const numbering =
    options.numbering ??
    (yamlNumbering === undefined
      ? undefined
      : !/^(?:false|no|off|none|0)$/.test(yamlNumbering));
  if (numbering === true) flags.push("numbered");
  else if (numbering === false) flags.push("nonumbers");

  return flags;
}

/**
 * Convert Markdown to a ReTeX document in a chosen paper style.
 *
 * The result is an ordinary {@link DocumentNode}, so it goes through the same
 * renderers as hand-written ReTeX, and can be printed to an editable `.retex`
 * file. Like the rest of the pipeline this never throws: problems are reported as
 * diagnostics, and an unknown style falls back to `normal`.
 *
 * The document's structure is inferred, because AI answers rarely state it: a lone
 * first heading becomes the title, `**Authors:**`-style lines become metadata, an
 * `Abstract` heading becomes the abstract, and a `References` section becomes a
 * numbered bibliography that `[1]` in the text links to.
 */
export function parseMarkdown(markdown: string, options: MarkdownOptions = {}): MarkdownResult {
  const diagnostics: Diagnostic[] = [];
  const stripChatter = options.stripChatter ?? true;

  const normalized = String(markdown ?? "")
    .replace(/^\ufeff/, "")
    .replace(/\r\n?/g, "\n");
  const { data, body: withArtifacts, bodyLine } = extractFrontMatter(normalized);

  let body = withArtifacts;
  if (stripChatter) {
    let removed = 0;
    for (const pattern of ARTIFACT_PATTERNS) {
      body = body.replace(pattern, () => {
        removed++;
        return "";
      });
    }
    if (removed > 0) {
      diagnostics.push(lineDiagnostic(`Removed ${removed} AI citation marker(s).`, bodyLine));
    }
  }

  /* --------------------------------- style ---------------------------- */

  const lookup = (name: string): PartialTheme | undefined => {
    const key = name.trim().toLowerCase();
    const custom = options.lookupStyle?.(key);
    if (custom?.paper) return custom;
    return Object.prototype.hasOwnProperty.call(paperThemes, key) ? paperThemes[key] : undefined;
  };
  const yamlStyle = [data.style, data.documentclass, data.class].find(
    (v): v is string => typeof v === "string" && v !== "",
  );
  let style = (options.style ?? yamlStyle ?? "normal").trim().toLowerCase();
  if (!lookup(style)) {
    diagnostics.push(
      lineDiagnostic(
        `Unknown paper style "${style}", using "normal". Available: ${paperStyleNames().join(", ")}.`,
        1,
        DiagnosticSeverity.Warning,
        DiagnosticCode.UnknownLibrary,
      ),
    );
    style = "normal";
  }
  const flags = documentClassFlags(options, data);
  const theme = applyPaperOptions(lookup(style) as Theme, flags);
  const autoNumbered = (theme.paper?.numbering ?? "none") !== "none";

  /* --------------------------------- blocks --------------------------- */

  const linkDefs = new Map<string, LinkDefinition>();
  const footnoteDefs = new Map<string, MdBlock[]>();
  const blockContext: BlockContext = {
    linkDefs,
    footnoteDefs,
    report: (message, line) => diagnostics.push(lineDiagnostic(message, line)),
  };
  let blocks = parseBlocks(body.split("\n"), blockContext, bodyLine);
  if (stripChatter) blocks = removeChatter(blocks, diagnostics);

  // Models sometimes wrap the entire answer in a ```markdown fence.
  if (blocks.length === 1 && blocks[0]!.kind === "code") {
    const only = blocks[0]!;
    if (only.language === "markdown" || only.language === "md") {
      blocks = parseBlocks(only.value.split("\n"), blockContext, only.line + 1);
      if (stripChatter) blocks = removeChatter(blocks, diagnostics);
    }
  }

  /* ------------------------------ front matter ------------------------ */

  const front = frontFromYaml(data);
  if (options.title !== undefined) front.title = options.title;
  blocks = takeTitle(blocks, front);
  blocks = takeFrontMatter(blocks, front);
  if (front.title !== undefined) front.title = cleanHeadingText(front.title, stripChatter);
  if (options.date !== undefined) front.date = options.date;
  if (options.keywords !== undefined) front.keywords = options.keywords;
  if (options.abstract !== undefined) {
    front.abstract = [{ kind: "paragraph", text: options.abstract, line: 1 }];
  }
  if (options.authors !== undefined) {
    front.authors = options.authors.map((a) => (typeof a === "string" ? { name: a } : a));
  }

  /* ------------------------------- conversion ------------------------- */

  const converter = new Converter(
    footnoteDefs,
    linkDefs,
    theme.paper?.columns === 2,
    diagnostics,
  );

  const headings = blocks.filter(
    (b): b is Extract<MdBlock, { kind: "heading" }> => b.kind === "heading",
  );
  const headingText = (h: { text: string }): string => cleanHeadingText(h.text, stripChatter);
  const stripNumber = autoNumbered
    ? headingNumberStripper(headings.map(headingText))
    : (text: string) => text;

  // Whatever levels the document uses, the outermost becomes `\section`.
  const levels = [...new Set(headings.map((h) => h.level))].sort((a, b) => a - b);
  const levelOf = (h: { level: number }): number => Math.min(levels.indexOf(h.level) + 1, 4);

  // Take the reference list first: `[1]` in the text can only resolve against it.
  let referencesAt = -1;
  let referencesEnd = -1;
  let referenceNode: Node | undefined;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]!;
    if (block.kind !== "heading") continue;
    if (!REFERENCES_RE.test(plain(stripNumber(headingText(block))))) continue;
    let end = i + 1;
    while (end < blocks.length) {
      const next = blocks[end]!;
      if (next.kind === "heading" && next.level <= block.level) break;
      end++;
    }
    const raw = referencesFromBlocks(blocks.slice(i + 1, end));
    if (raw.length > 0) {
      referencesAt = i;
      referencesEnd = end;
      referenceNode = converter.references(raw);
    }
    break;
  }

  const bodyNodes: Node[] = [];
  let pending: MdBlock[] = [];
  const flush = (): void => {
    if (pending.length === 0) return;
    if (bodyNodes.length > 0) bodyNodes.push({ type: "parbreak" });
    bodyNodes.push(...converter.blocks(pending));
    pending = [];
  };

  const pushHeading = (heading: Extract<MdBlock, { kind: "heading" }>, node?: Node): void => {
    flush();
    const cleaned = stripNumber(headingText(heading));
    const { text, children } = richTitle(converter.inlineNodes(cleaned));
    const unnumbered = node !== undefined || UNNUMBERED_RE.test(plain(cleaned));
    const section: SectionNode = {
      type: "section",
      title: text,
      level: levelOf(heading),
      ...(children ? { children } : {}),
      ...(unnumbered ? { unnumbered: true } : {}),
    };
    if (bodyNodes.length > 0) bodyNodes.push({ type: "parbreak" });
    bodyNodes.push(section);
    if (node) bodyNodes.push(node);
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (i === referencesAt) {
      pushHeading(block as Extract<MdBlock, { kind: "heading" }>, referenceNode);
      i = referencesEnd - 1;
    } else if (block.kind === "heading") {
      pushHeading(block);
    } else {
      pending.push(block);
    }
  }
  flush();

  /* -------------------------------- assembly -------------------------- */

  const children: Node[] = [
    {
      type: "usepackage",
      names: [style],
      documentClass: true,
      ...(flags.length > 0 ? { options: flags } : {}),
    },
  ];
  if (front.title) {
    const { text, children: rich } = richTitle(converter.inlineNodes(front.title));
    children.push({ type: "parbreak" }, {
      type: "contact",
      field: "title",
      value: text,
      ...(rich ? { children: rich } : {}),
    });
  }
  for (const fields of front.authors) {
    if (!fields.name && Object.keys(fields).length <= 1) continue;
    const author: AuthorNode = { type: "author", fields };
    children.push(author);
  }
  if (front.date) {
    children.push({ type: "parbreak" }, { type: "contact", field: "date", value: front.date });
  }
  if (front.abstract && front.abstract.length > 0) {
    children.push({ type: "abstract", children: converter.blocks(front.abstract) });
  }
  if (front.keywords && front.keywords.length > 0) {
    children.push({ type: "keywords", items: front.keywords });
  }
  if (bodyNodes.length > 0) children.push({ type: "parbreak" }, ...bodyNodes);

  const ast: DocumentNode = { type: "document", children };
  diagnostics.push(...validate(ast));
  return { ast, diagnostics, style };
}
