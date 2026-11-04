import { DiagnosticSeverity, DiagnosticCode, type Diagnostic } from "../types/index.js";

/** Block structure of a Markdown document, before inline content is parsed. */
export type MdBlock =
  | { kind: "heading"; level: number; text: string; line: number }
  | { kind: "paragraph"; text: string; line: number }
  | { kind: "code"; language: string; value: string; line: number }
  | { kind: "math"; tex: string; line: number }
  | { kind: "quote"; blocks: MdBlock[]; line: number }
  | {
      kind: "list";
      ordered: boolean;
      start: number;
      items: MdBlock[][];
      line: number;
    }
  | {
      kind: "table";
      align: Array<"left" | "center" | "right" | undefined>;
      header: string[];
      rows: string[][];
      line: number;
    }
  | { kind: "rule"; line: number };

export interface LinkDefinition {
  href: string;
}

/** Definitions collected from anywhere in the document, and problems found. */
export interface BlockContext {
  linkDefs: Map<string, LinkDefinition>;
  footnoteDefs: Map<string, MdBlock[]>;
  report: (message: string, line: number) => void;
}

/** A pathological `>>>>…` or deep list must not exhaust the stack. */
const MAX_NESTING = 32;

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/;
const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/;
const RULE_RE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const SETEXT_EQ_RE = /^ {0,3}=+[ \t]*$/;
const SETEXT_DASH_RE = /^ {0,3}-+[ \t]*$/;
const QUOTE_RE = /^ {0,3}> ?/;
const LIST_RE = /^( *)([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const TABLE_DELIMITER_RE = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const LINK_DEF_RE =
  /^ {0,3}\[([^\]^][^\]]*)\]:[ \t]*(\S+)(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/;
const FOOTNOTE_DEF_RE = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/;
const DROPPED_HTML_RE =
  /^ {0,3}<(script|style|iframe|object|embed|noscript|template|svg|math|head|textarea|select|form)\b/i;
const COMMENT_RE = /^ {0,3}<!--/;
const MATH_ENV_RE =
  /^ {0,3}\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|displaymath|aligned)\}/;

const isBlank = (line: string): boolean => /^[ \t]*$/.test(line);

/** How far ahead to look for the end of a bare `\begin{equation}`. */
const MAX_MATH_LINES = 2000;

/** Remove a heading's optional closing run of `#`, as in `## Title ##`. */
function stripClosingHashes(raw: string): string {
  const text = raw.trimEnd();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end--;
  if (end === text.length) return text;
  if (end === 0) return "";
  const before = text[end - 1];
  return before === " " || before === "\t" ? text.slice(0, end).trimEnd() : text;
}

/** Expand tabs in leading whitespace to 4-column stops; the rest is left alone. */
function expandLeadingTabs(line: string): string {
  if (!line.includes("\t")) return line;
  let out = "";
  let i = 0;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === " ") out += " ";
    else if (c === "\t") out += " ".repeat(4 - (out.length % 4));
    else break;
  }
  return out + line.slice(i);
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

interface ListMarker {
  indent: number;
  ordered: boolean;
  start: number;
  /** Column at which the item's content begins. */
  contentIndent: number;
  empty: boolean;
}

function listMarkerAt(line: string): ListMarker | undefined {
  if (RULE_RE.test(line)) return undefined;
  const m = LIST_RE.exec(line);
  if (!m) return undefined;
  const indent = m[1]!.length;
  const marker = m[2]!;
  const spaces = m[3]!;
  const empty = line.length === m[0].length;
  // Five or more spaces mean indented code inside the item, so count just one.
  const gap = empty || spaces.length > 4 || spaces.includes("\t") ? 1 : spaces.length;
  return {
    indent,
    ordered: /^\d/.test(marker),
    start: /^\d/.test(marker) ? Number.parseInt(marker, 10) : 1,
    contentIndent: indent + marker.length + gap,
    empty,
  };
}

/** Find where a display formula starts; `$$`, `\[`, and bare `\begin{equation}`. */
function displayMathAt(
  lines: string[],
  i: number,
): { tex: string; next: number } | undefined {
  const line = lines[i]!.trim();

  const env = MATH_ENV_RE.exec(lines[i]!);
  if (env) {
    const closeTag = `\\end{${env[1]}}`;
    for (let j = i; j < Math.min(lines.length, i + MAX_MATH_LINES); j++) {
      if (lines[j]!.includes(closeTag)) {
        const tex = lines.slice(i, j + 1).join("\n").trim();
        // The `equation` wrapper adds nothing; the alignment ones must stay.
        const inner = /^\\begin\{(equation\*?|displaymath)\}/.test(tex)
          ? tex.replace(/^\\begin\{[^}]*\}/, "").replace(/\\end\{[^}]*\}$/, "").trim()
          : tex;
        return { tex: inner, next: j + 1 };
      }
    }
    return undefined;
  }

  const delimiters: Array<[string, string]> = [
    ["$$", "$$"],
    ["\\[", "\\]"],
  ];
  for (const [open, close] of delimiters) {
    if (!line.startsWith(open)) continue;
    const afterOpen = line.slice(open.length);
    const sameLine = afterOpen.indexOf(close);
    if (sameLine !== -1) {
      // Trailing text means this is an inline formula within a paragraph.
      if (afterOpen.slice(sameLine + close.length).trim() !== "") return undefined;
      return { tex: afterOpen.slice(0, sameLine).trim(), next: i + 1 };
    }
    const body = [afterOpen];
    for (let j = i + 1; j < lines.length; j++) {
      const current = lines[j]!;
      const end = current.indexOf(close);
      if (end !== -1) {
        body.push(current.slice(0, end));
        return { tex: body.join("\n").trim(), next: j + 1 };
      }
      body.push(current);
    }
    // Unterminated: AI answers do get cut off, so take the rest as the formula.
    return { tex: body.join("\n").trim(), next: lines.length };
  }
  return undefined;
}

/** Split a table row on its pipes, leaving those in code and math spans alone. */
export function splitTableRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  const cells: string[] = [];
  let current = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "\\" && i + 1 < text.length) {
      // `\|` is a literal pipe; other escapes stay for the inline parser.
      current += text[i + 1] === "|" ? "|" : c + text[i + 1];
      i += 2;
      continue;
    }
    if (c === "`") {
      const run = /^`+/.exec(text.slice(i))![0];
      const close = text.indexOf(run, i + run.length);
      if (close !== -1) {
        current += text.slice(i, close + run.length);
        i = close + run.length;
        continue;
      }
    }
    if (c === "$" && /\S/.test(text[i + 1] ?? " ")) {
      // Same rule as inline math, so `$5 | $10` still splits into two cells.
      let close = -1;
      for (let j = i + 1; j < text.length; j++) {
        if (text[j] !== "$") continue;
        if (text[j - 1] !== " " && text[j - 1] !== "\\" && !/\d/.test(text[j + 1] ?? "")) {
          close = j;
          break;
        }
      }
      if (close !== -1) {
        current += text.slice(i, close + 1);
        i = close + 1;
        continue;
      }
    }
    if (c === "|") {
      cells.push(current.trim());
      current = "";
      i++;
      continue;
    }
    current += c;
    i++;
  }
  if (current.trim() !== "" || !text.endsWith("|")) cells.push(current.trim());
  return cells;
}

function tableAt(
  lines: string[],
  i: number,
): Omit<Extract<MdBlock, { kind: "table" }>, "kind" | "line"> & { next: number } | undefined {
  if (!isTableStart(lines, i)) return undefined;
  const header = splitTableRow(lines[i]!);
  const delimiters = splitTableRow(lines[i + 1]!);

  const align = delimiters.map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center" as const;
    if (right) return "right" as const;
    if (left) return "left" as const;
    return undefined;
  });

  const rows: string[][] = [];
  let next = i + 2;
  while (next < lines.length) {
    const line = lines[next]!;
    if (isBlank(line) || !line.includes("|") || startsBlock(lines, next)) break;
    const cells = splitTableRow(line).slice(0, header.length);
    while (cells.length < header.length) cells.push("");
    rows.push(cells);
    next++;
  }
  return { align, header, rows, next };
}

/** Does a table start here? Checks only its first two lines, so it can't recurse. */
function isTableStart(lines: string[], i: number): boolean {
  const delimiterLine = lines[i + 1];
  if (delimiterLine === undefined || !lines[i]!.includes("|")) return false;
  if (!delimiterLine.includes("-") || !TABLE_DELIMITER_RE.test(delimiterLine)) return false;
  return splitTableRow(lines[i]!).length === splitTableRow(delimiterLine).length;
}

/** Can this line interrupt a running paragraph? */
function startsBlock(lines: string[], i: number): boolean {
  const line = lines[i]!;
  if (ATX_RE.test(line) || FENCE_RE.test(line) || RULE_RE.test(line) || QUOTE_RE.test(line)) {
    return true;
  }
  if (DROPPED_HTML_RE.test(line) || COMMENT_RE.test(line)) return true;
  const marker = listMarkerAt(line);
  // Like CommonMark: `2. ` mid-paragraph is more likely prose than a new list.
  if (marker && marker.indent < 4 && !marker.empty && (!marker.ordered || marker.start === 1)) {
    return true;
  }
  if (displayMathAt(lines, i)) return true;
  return isTableStart(lines, i);
}

/**
 * Parse Markdown into its block structure. This follows CommonMark and GitHub
 * Flavored Markdown, with a few deliberate allowances for how AI models write:
 * unterminated fences run to the end of the answer, sublists may be under-indented,
 * and math may use `$$`, `\[`, or a bare `\begin{equation}`.
 */
export function parseBlocks(
  rawLines: string[],
  ctx: BlockContext,
  baseLine = 1,
  depth = 0,
): MdBlock[] {
  const lines = rawLines.map(expandLeadingTabs);
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const lineNo = baseLine + i;

    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    // A backtick fence's info string cannot contain backticks: that is inline code.
    if (fence && !(fence[1]![0] === "`" && fence[2]!.includes("`"))) {
      const mark = fence[1]!;
      const indent = indentOf(line);
      const closeRe = new RegExp(`^ {0,3}${mark[0]}{${mark.length},}[ \\t]*$`);
      const body: string[] = [];
      i++;
      while (i < lines.length && !closeRe.test(lines[i]!)) {
        const current = lines[i]!;
        body.push(current.slice(Math.min(indent, indentOf(current))));
        i++;
      }
      i++; // Past the closing fence, or past the end if it was never closed.
      const language = (fence[2]!.trim().split(/\s+/)[0] ?? "").toLowerCase();
      if (language === "math") {
        blocks.push({ kind: "math", tex: body.join("\n").trim(), line: lineNo });
      } else {
        blocks.push({ kind: "code", language, value: body.join("\n"), line: lineNo });
      }
      continue;
    }

    if (COMMENT_RE.test(line)) {
      while (i < lines.length && !lines[i]!.includes("-->")) i++;
      i++;
      continue;
    }

    const dropped = DROPPED_HTML_RE.exec(line);
    if (dropped) {
      const closeTag = `</${dropped[1]!.toLowerCase()}`;
      while (i < lines.length && !lines[i]!.toLowerCase().includes(closeTag)) i++;
      i++;
      ctx.report(`Removed a <${dropped[1]!.toLowerCase()}> block.`, lineNo);
      continue;
    }

    const math = displayMathAt(lines, i);
    if (math) {
      blocks.push({ kind: "math", tex: math.tex, line: lineNo });
      i = math.next;
      continue;
    }

    const atx = ATX_RE.exec(line);
    if (atx) {
      const text = stripClosingHashes(atx[2] ?? "");
      blocks.push({ kind: "heading", level: atx[1]!.length, text: text.trim(), line: lineNo });
      i++;
      continue;
    }

    if (RULE_RE.test(line)) {
      blocks.push({ kind: "rule", line: lineNo });
      i++;
      continue;
    }

    if (QUOTE_RE.test(line) && depth < MAX_NESTING) {
      const inner: string[] = [];
      while (i < lines.length) {
        const current = lines[i]!;
        const prefix = QUOTE_RE.exec(current);
        if (prefix) {
          inner.push(current.slice(prefix[0].length));
        } else if (isBlank(current) || startsBlock(lines, i)) {
          break;
        } else {
          inner.push(current); // A lazy continuation line.
        }
        i++;
      }
      blocks.push({
        kind: "quote",
        blocks: parseBlocks(inner, ctx, lineNo, depth + 1),
        line: lineNo,
      });
      continue;
    }

    const marker = listMarkerAt(line);
    if (marker && marker.indent < 4 && depth < MAX_NESTING) {
      const list = parseList(lines, i, marker, ctx, baseLine, depth);
      blocks.push({
        kind: "list",
        ordered: marker.ordered,
        start: marker.start,
        items: list.items,
        line: lineNo,
      });
      i = list.next;
      continue;
    }

    const footnote = FOOTNOTE_DEF_RE.exec(line);
    if (footnote) {
      const inner = [footnote[2]!];
      i++;
      while (i < lines.length) {
        const current = lines[i]!;
        if (isBlank(current)) {
          // A blank line only continues the note if indented text follows it.
          const after = lines.slice(i + 1).find((l) => !isBlank(l));
          if (after === undefined || indentOf(after) < 4) break;
          inner.push("");
        } else if (indentOf(current) >= 4) {
          inner.push(current.slice(4));
        } else if (startsBlock(lines, i) || FOOTNOTE_DEF_RE.test(current)) {
          break;
        } else {
          inner.push(current.trimStart());
        }
        i++;
      }
      if (!ctx.footnoteDefs.has(footnote[1]!) && depth < MAX_NESTING) {
        ctx.footnoteDefs.set(footnote[1]!, parseBlocks(inner, ctx, lineNo, depth + 1));
      }
      continue;
    }

    const linkDef = LINK_DEF_RE.exec(line);
    if (linkDef) {
      const label = normalizeLabel(linkDef[1]!);
      if (!ctx.linkDefs.has(label)) {
        const href = linkDef[2]!.replace(/^<|>$/g, "");
        ctx.linkDefs.set(label, { href });
      }
      i++;
      continue;
    }

    const table = tableAt(lines, i);
    if (table) {
      blocks.push({
        kind: "table",
        align: table.align,
        header: table.header,
        rows: table.rows,
        line: lineNo,
      });
      i = table.next;
      continue;
    }

    if (indentOf(line) >= 4) {
      const body: string[] = [];
      while (i < lines.length && (isBlank(lines[i]!) || indentOf(lines[i]!) >= 4)) {
        body.push(lines[i]!.slice(4));
        i++;
      }
      while (body.length > 0 && isBlank(body[body.length - 1]!)) body.pop();
      blocks.push({ kind: "code", language: "", value: body.join("\n"), line: lineNo });
      continue;
    }

    // Everything else is a paragraph, which may turn out to be a setext heading.
    const para: string[] = [line.trimStart()];
    i++;
    let setext = 0;
    while (i < lines.length) {
      const current = lines[i]!;
      if (isBlank(current)) break;
      if (SETEXT_EQ_RE.test(current)) {
        setext = 1;
        i++;
        break;
      }
      // `---` under a long paragraph is a divider, not an underlined heading.
      if (SETEXT_DASH_RE.test(current) && para.length === 1 && para[0]!.length <= 120) {
        setext = 2;
        i++;
        break;
      }
      if (startsBlock(lines, i)) break;
      para.push(current.trimStart());
      i++;
    }
    if (setext > 0) {
      blocks.push({ kind: "heading", level: setext, text: para.join(" ").trim(), line: lineNo });
    } else {
      blocks.push({ kind: "paragraph", text: para.join("\n"), line: lineNo });
    }
  }

  return blocks;
}

function parseList(
  lines: string[],
  startAt: number,
  first: ListMarker,
  ctx: BlockContext,
  baseLine: number,
  depth: number,
): { items: MdBlock[][]; next: number } {
  const items: MdBlock[][] = [];
  let i = startAt;

  while (i < lines.length) {
    const marker = listMarkerAt(lines[i]!);
    // Bullet and numbered lists never merge, and a shallower marker ends this one.
    if (!marker || marker.ordered !== first.ordered || marker.indent >= first.contentIndent) {
      break;
    }

    const itemStart = i;
    const itemLines = [lines[i]!.slice(marker.contentIndent)];
    i++;
    let sawBlank = false;

    while (i < lines.length) {
      const current = lines[i]!;
      if (isBlank(current)) {
        itemLines.push("");
        sawBlank = true;
        i++;
        continue;
      }
      const indent = indentOf(current);
      if (indent >= marker.contentIndent) {
        itemLines.push(current.slice(marker.contentIndent));
        sawBlank = false;
        i++;
        continue;
      }
      // AI models often indent a sublist by less than the parent's marker width.
      if (listMarkerAt(current) && indent > marker.indent) {
        itemLines.push(current.slice(indent));
        sawBlank = false;
        i++;
        continue;
      }
      if (sawBlank || listMarkerAt(current) || startsBlock(lines, i)) break;
      itemLines.push(current.trimStart()); // A lazy continuation line.
      i++;
    }

    while (itemLines.length > 0 && isBlank(itemLines[itemLines.length - 1]!)) {
      itemLines.pop();
    }
    items.push(parseBlocks(itemLines, ctx, baseLine + itemStart, depth + 1));
  }

  return { items, next: i };
}

/** Link labels match case-insensitively, with whitespace collapsed. */
export function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/** A Markdown diagnostic for a whole line. */
export function lineDiagnostic(
  message: string,
  line: number,
  severity: DiagnosticSeverity = DiagnosticSeverity.Info,
  code: DiagnosticCode = DiagnosticCode.MarkdownCleanup,
): Diagnostic {
  const position = { offset: 0, line, column: 1 };
  return {
    severity,
    code,
    message,
    range: { start: position, end: position },
    source: "markdown",
  };
}
