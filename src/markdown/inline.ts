import { VERBATIM_ENVIRONMENTS, type ImageNode, type MarkType, type Node } from "../types/index.js";
import { sanitizeImageUrl, sanitizeUrl } from "../security/sanitize.js";
import { flattenText } from "../ast/text.js";
import { normalizeLabel, type LinkDefinition } from "./blocks.js";

/** What the inline parser needs to know about the rest of the document. */
export interface InlineContext {
  linkDefs: Map<string, LinkDefinition>;
  /** Keys of the document's reference list: `[1]` is only a citation if listed. */
  citeKeys: Set<string>;
  /** Convert a footnote definition to nodes, if the id is defined. */
  footnote: (id: string) => Node[] | undefined;
  /** A blocked URL, or anything else the author should hear about. */
  warn: (message: string) => void;
}

/** An image's title, available only until it becomes a figure caption. */
export interface TitledImage extends ImageNode {
  title?: string;
}

const MAX_DEPTH = 16;
/** Emphasis nests without recursing here, but every renderer recurses over it. */
const MAX_EMPHASIS_DEPTH = 32;
/** How far to look for a closing bracket, which also keeps `[[[[…` linear. */
const MAX_BRACKET_SCAN = 4000;
const MAX_MATH_LENGTH = 2000;

/** A lookup table with no prototype, since its keys come straight from the document. */
function table<T>(entries: Record<string, T>): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, entries);
}

const ENTITIES = table<string>({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  times: "×",
  divide: "÷",
  deg: "°",
  plusmn: "±",
  le: "≤",
  ge: "≥",
  ne: "≠",
  rarr: "→",
  larr: "←",
  sect: "§",
  para: "¶",
  micro: "µ",
});

/** Tags that map to a mark; their content stays and gets styled. */
const HTML_MARKS = table<MarkType>({
  b: "bold",
  strong: "bold",
  i: "italic",
  em: "italic",
  cite: "italic",
  u: "underline",
  ins: "underline",
  s: "strike",
  del: "strike",
  strike: "strike",
  sub: "sub",
  sup: "sup",
});

/** Dangerous or meaningless on the page: the tag and its content both go. */
const HTML_DROPPED = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "noscript",
  "template",
  "svg",
  "math",
  "head",
  "textarea",
  "select",
  "form",
]);

/** Harmless wrappers: the tag goes, its content stays as plain text. */
const HTML_UNWRAPPED = new Set(
  (
    "a abbr address article aside b bdi bdo big blockquote body br button caption center code col " +
    "colgroup dd details dfn dir div dl dt em figcaption figure font footer h1 h2 h3 h4 h5 h6 " +
    "header hgroup hr html img input kbd label legend li main mark menu nav ol optgroup option p " +
    "picture pre q rp rt ruby samp section small source span summary table tbody td tfoot th " +
    "thead time tr tt ul var video wbr"
  ).split(" "),
);

const TAG_RE =
  /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z_:][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>=`]+))*)\s*(\/?)>/;
const AUTOLINK_RE = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)>/;
const EMAIL_RE = /^<([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>/;
const COMMENT_RE = /^<!--[\s\S]*?-->/;
const BARE_URL_RE = /^https?:\/\/[^\s<>]+/i;
const CITE_LIST_RE = /^\[\s*@?[\w:.-]+(?:\s*[,;]\s*@?[\w:.-]+)*\s*\]/;
const CITE_RANGE_RE = /^\[\s*(\d+)\s*[-–—]\s*(\d+)\s*\]/;

const isSpace = (c: string): boolean => c === "" || /\s/.test(c);
const isPunctuation = (c: string): boolean => c !== "" && /[\p{P}\p{S}]/u.test(c);
const isAsciiPunctuation = (c: string): boolean => /[!-/:-@[-`{-~]/.test(c);

const attribute = (attrs: string, name: string): string | undefined => {
  const re = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'<>=\`]+))`, "i");
  const m = re.exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
};

/**
 * Can this formula be delimited in ReTeX source? It needs balanced braces, and any
 * environment whose body the tokenizer reads verbatim must be closed within it, or
 * that verbatim read would run past the formula's end.
 */
export function bracesBalanced(tex: string): boolean {
  let depth = 0;
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i];
    if (c === "\\") {
      // A final backslash would escape whatever closes the formula.
      if (i === tex.length - 1) return false;
      i++;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth < 0) return false;
  }
  if (depth !== 0) return false;
  for (const name of VERBATIM_ENVIRONMENTS) {
    const lastOpen = tex.lastIndexOf(`\\begin{${name}}`);
    if (lastOpen !== -1 && !tex.includes(`\\end{${name}}`, lastOpen)) return false;
  }
  return true;
}

/** One entry in the parser's linked list: finished content, or a delimiter run. */
interface Item {
  node?: Node;
  /** How many marks deep `node` is. */
  depth?: number;
  delimiter?: {
    char: string;
    count: number;
    /** Length of the run as written, which the "rule of 3" depends on. */
    original: number;
    canOpen: boolean;
    canClose: boolean;
  };
  prev?: Item;
  next?: Item;
}

class InlineParser {
  private pos = 0;
  private text = "";
  private head?: Item;
  private tail?: Item;
  /** A backtick run with no closer has none later either, so never rescan. */
  private readonly noCloser = new Set<number>();
  private noDollarCloser = false;
  /** An HTML tag with no closer has none later either. */
  private readonly unclosedTags = new Set<string>();

  constructor(
    private readonly src: string,
    private readonly ctx: InlineContext,
    private readonly depth: number,
  ) {}

  parse(): Node[] {
    const { src } = this;
    while (this.pos < src.length) {
      const c = src[this.pos]!;
      switch (c) {
        case "\\":
          this.backslash();
          break;
        case "`":
          this.codeSpan();
          break;
        case "$":
          this.dollar();
          break;
        case "*":
        case "_":
          this.delimiterRun(c);
          break;
        case "~":
          if (src[this.pos + 1] === "~" && src[this.pos + 2] !== "~") this.delimiterRun("~");
          else this.literal(c);
          break;
        case "[":
          this.bracket();
          break;
        case "!":
          if (src[this.pos + 1] === "[") this.image();
          else this.literal(c);
          break;
        case "<":
          this.angle();
          break;
        case "&":
          this.entity();
          break;
        case "\n":
          this.newline();
          break;
        case "h":
        case "H":
          this.maybeBareUrl(c);
          break;
        default:
          this.literal(c);
      }
    }
    this.flushText();
    this.processEmphasis();
    return this.collect(this.head, undefined);
  }

  /* ----------------------------- output ----------------------------- */

  private literal(c: string): void {
    this.text += c;
    this.pos++;
  }

  private flushText(): void {
    if (this.text === "") return;
    const value = this.text.replace(/[ \t]+/g, " ");
    this.text = "";
    this.append({ node: { type: "text", value } });
  }

  private append(item: Item): void {
    if (this.tail) {
      this.tail.next = item;
      item.prev = this.tail;
    } else {
      this.head = item;
    }
    this.tail = item;
  }

  private pushNode(node: Node): void {
    this.flushText();
    this.append({ node });
  }

  private remove(item: Item): void {
    if (item.prev) item.prev.next = item.next;
    else this.head = item.next;
    if (item.next) item.next.prev = item.prev;
    else this.tail = item.prev;
  }

  /** Items from `from` up to (not including) `to`, as a tidy list of nodes. */
  private collect(from: Item | undefined, to: Item | undefined): Node[] {
    const out: Node[] = [];
    const pushText = (value: string): void => {
      const last = out[out.length - 1];
      if (last?.type === "text") last.value += value;
      else out.push({ type: "text", value });
    };
    for (let item = from; item && item !== to; item = item.next) {
      if (item.delimiter) {
        if (item.delimiter.count > 0) {
          pushText(item.delimiter.char.repeat(item.delimiter.count));
        }
      } else if (item.node?.type === "text") {
        pushText(item.node.value);
      } else if (item.node) {
        out.push(item.node);
      }
    }
    return out;
  }

  /* ----------------------------- syntax ----------------------------- */

  private backslash(): void {
    const next = this.src[this.pos + 1] ?? "";
    if (next === "(" || next === "[") {
      // ChatGPT's favourite math delimiters, not escaped punctuation.
      const close = next === "(" ? "\\)" : "\\]";
      const end = this.src.indexOf(close, this.pos + 2);
      if (end !== -1 && end - this.pos <= MAX_MATH_LENGTH) {
        const tex = this.src.slice(this.pos + 2, end).trim();
        if (bracesBalanced(tex)) {
          this.pushMath(tex);
          this.pos = end + 2;
          return;
        }
      }
    }
    if (next === "\n") {
      this.pushNode({ type: "linebreak" });
      this.pos += 2;
      this.skipIndent();
      return;
    }
    if (isAsciiPunctuation(next)) {
      this.text += next;
      this.pos += 2;
      return;
    }
    this.literal("\\");
  }

  private codeSpan(): void {
    const start = this.pos;
    let end = start;
    while (this.src[end] === "`") end++;
    const length = end - start;

    if (!this.noCloser.has(length)) {
      let search = end;
      for (;;) {
        const close = this.src.indexOf("`".repeat(length), search);
        if (close === -1) {
          this.noCloser.add(length);
          break;
        }
        let closeEnd = close;
        while (this.src[closeEnd] === "`") closeEnd++;
        if (closeEnd - close !== length) {
          search = closeEnd;
          continue;
        }
        let value = this.src.slice(end, close).replace(/\n/g, " ");
        // CommonMark: one framing space is removed, so `` ` `` can hold a backtick.
        if (value.length > 1 && value.startsWith(" ") && value.endsWith(" ") && value.trim()) {
          value = value.slice(1, -1);
        }
        this.pushNode({ type: "code", value });
        this.pos = closeEnd;
        return;
      }
    }
    this.text += this.src.slice(start, end);
    this.pos = end;
  }

  private dollar(): void {
    const { src, pos } = this;
    if (src[pos + 1] === "$") {
      const close = src.indexOf("$$", pos + 2);
      if (close !== -1 && close - pos <= MAX_MATH_LENGTH) {
        const tex = src.slice(pos + 2, close).trim();
        if (tex && bracesBalanced(tex)) {
          this.pushMath(`\\displaystyle ${tex}`);
          this.pos = close + 2;
          return;
        }
      }
      this.text += "$$";
      this.pos += 2;
      return;
    }

    // The Pandoc rule, which leaves prices like "$5 and $10" alone: the opener
    // hugs what follows it, and the closer hugs what precedes it and no digit follows.
    if (!this.noDollarCloser && /\S/.test(src[pos + 1] ?? " ")) {
      const limit = Math.min(src.length, pos + MAX_MATH_LENGTH);
      let sawDollar = false;
      for (let i = pos + 1; i < limit; i++) {
        const c = src[i];
        if (c === "\\") {
          i++;
          continue;
        }
        if (c !== "$") continue;
        sawDollar = true;
        if (/\s/.test(src[i - 1]!) || /\d/.test(src[i + 1] ?? "")) continue;
        const tex = src.slice(pos + 1, i);
        if (bracesBalanced(tex)) {
          this.pushMath(tex.trim());
          this.pos = i + 1;
          return;
        }
      }
      if (!sawDollar && limit === src.length) this.noDollarCloser = true;
    }
    this.literal("$");
  }

  /** `%%` would start a comment in `\\math{...}` and swallow its closing brace. */
  private pushMath(tex: string): void {
    this.pushNode({ type: "math", tex: tex.replace(/%%/g, "\\%\\%"), display: false });
  }

  private delimiterRun(char: string): void {
    const { src } = this;
    const start = this.pos;
    let end = start;
    while (src[end] === char) end++;
    const count = end - start;

    const before = start > 0 ? src[start - 1]! : "";
    const after = src[end] ?? "";
    const leftFlanking =
      !isSpace(after) && (!isPunctuation(after) || isSpace(before) || isPunctuation(before));
    const rightFlanking =
      !isSpace(before) && (!isPunctuation(before) || isSpace(after) || isPunctuation(after));

    // `_` must not fire inside a word, so snake_case_names stay as they are.
    const canOpen =
      char === "_" ? leftFlanking && (!rightFlanking || isPunctuation(before)) : leftFlanking;
    const canClose =
      char === "_" ? rightFlanking && (!leftFlanking || isPunctuation(after)) : rightFlanking;

    this.flushText();
    this.append({ delimiter: { char, count, original: count, canOpen, canClose } });
    this.pos = end;
  }

  /** The CommonMark delimiter algorithm: pair up runs of `*`, `_`, and `~~`. */
  private processEmphasis(): void {
    // No opener existed below this point, so later closers need not look further.
    const openersBottom = new Map<string, Item | undefined>();
    let closer = this.head;

    while (closer) {
      const cd = closer.delimiter;
      if (!cd || !cd.canClose || cd.count === 0) {
        closer = closer.next;
        continue;
      }
      const key = `${cd.char}${cd.canOpen ? 1 : 0}${cd.original % 3}`;
      const bottom = openersBottom.get(key);

      let opener = closer.prev;
      let found = false;
      while (opener && opener !== bottom) {
        const od = opener.delimiter;
        if (od && od.char === cd.char && od.canOpen && od.count > 0) {
          const oddMatch =
            (cd.canOpen || od.canClose) &&
            cd.original % 3 !== 0 &&
            (od.original + cd.original) % 3 === 0;
          if (!oddMatch) {
            found = true;
            break;
          }
        }
        opener = opener.prev;
      }

      if (!found || !opener) {
        openersBottom.set(key, closer.prev);
        const next: Item | undefined = closer.next;
        if (!cd.canOpen) closer.delimiter = { ...cd, canClose: false };
        closer = next;
        continue;
      }

      const od = opener.delimiter!;
      let type: MarkType;
      let used: number;
      if (cd.char === "~") {
        type = "strike";
        used = 2;
      } else {
        used = od.count >= 2 && cd.count >= 2 ? 2 : 1;
        type = used === 2 ? "bold" : "italic";
      }

      let depth = 1;
      for (let item = opener.next; item && item !== closer; item = item.next) {
        depth = Math.max(depth, (item.depth ?? 0) + 1);
      }
      if (depth > MAX_EMPHASIS_DEPTH) {
        // Absurdly deep: leave these two runs as literal characters.
        od.canOpen = false;
        cd.canClose = false;
        closer = closer.next;
        continue;
      }

      const wrapped: Node = {
        type,
        children: this.collect(opener.next, closer),
      } as Node;
      // Replace everything between the two runs with the new mark.
      const markItem: Item = { node: wrapped, depth, prev: opener, next: closer };
      opener.next = markItem;
      closer.prev = markItem;
      od.count -= used;
      cd.count -= used;

      if (od.count === 0) this.remove(opener);
      if (cd.count === 0) {
        const next: Item | undefined = closer.next;
        this.remove(closer);
        closer = next;
      }
    }
  }

  private newline(): void {
    // Two trailing spaces make a hard break; otherwise a line end is just a space.
    let end = this.text.length;
    while (end > 0 && this.text[end - 1] === " ") end--;
    const hard = this.text.length - end >= 2;
    this.text = this.text.slice(0, end);
    if (hard) {
      this.pushNode({ type: "linebreak" });
    } else {
      this.text += " ";
    }
    this.pos++;
    this.skipIndent();
  }

  private skipIndent(): void {
    while (this.src[this.pos] === " " || this.src[this.pos] === "\t") this.pos++;
  }

  private entity(): void {
    const m = /^&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,31}));/.exec(
      this.src.slice(this.pos, this.pos + 40),
    );
    if (m) {
      let value: string | undefined;
      if (m[1] || m[2]) {
        const code = m[1] ? Number.parseInt(m[1], 10) : Number.parseInt(m[2]!, 16);
        const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
        value = valid ? String.fromCodePoint(code) : "�";
      } else {
        value = ENTITIES[m[3]!];
      }
      if (value !== undefined) {
        this.text += value;
        this.pos += m[0].length;
        return;
      }
    }
    this.literal("&");
  }

  private maybeBareUrl(c: string): void {
    const before = this.pos > 0 ? this.src[this.pos - 1]! : "";
    if (!/[\s(*_~]|^$/.test(before)) {
      this.literal(c);
      return;
    }
    const m = BARE_URL_RE.exec(this.src.slice(this.pos, this.pos + 2048));
    if (!m) {
      this.literal(c);
      return;
    }
    let url = m[0];
    // Sentence punctuation after a URL is not part of it.
    for (;;) {
      const last = url[url.length - 1]!;
      const unmatchedParen =
        last === ")" && url.split(")").length > url.split("(").length;
      if (/[.,;:!?'"*_~]/.test(last) || unmatchedParen) url = url.slice(0, -1);
      else break;
    }
    this.pushNode({ type: "url", href: this.safeHref(url), rawHref: url });
    this.pos += url.length;
  }

  private safeHref(url: string): string {
    const { safe, blocked, scheme } = sanitizeUrl(url);
    if (blocked) this.ctx.warn(`Blocked link with "${scheme ?? "unknown"}" scheme.`);
    return safe;
  }

  /* ------------------------- links and images ----------------------- */

  private bracket(): void {
    const rest = this.src.slice(this.pos, this.pos + MAX_BRACKET_SCAN);

    const footnote = /^\[\^([^\]\s]+)\]/.exec(rest);
    if (footnote) {
      const children = this.ctx.footnote(footnote[1]!);
      if (children) {
        this.pushNode({ type: "footnote", children });
        this.pos += footnote[0].length;
        return;
      }
    }

    if (this.citation(rest)) return;

    const parsed = this.depth < MAX_DEPTH ? this.linkAt(this.pos) : undefined;
    if (!parsed) {
      this.literal("[");
      return;
    }
    this.pushNode({
      type: "link",
      href: this.safeHref(parsed.href),
      rawHref: parsed.href,
      children: this.nested(parsed.label),
    });
    this.pos = parsed.end;
  }

  /** `[1]`, `[1, 2]`, `[1-3]`, and `[@key]`, if they name real references. */
  private citation(rest: string): boolean {
    const before = this.pos > 0 ? this.src[this.pos - 1]! : "";
    // `arr[1]` is indexing, and `]` or `(` next would make it a link.
    if (/[\w\]]/.test(before)) return false;

    const accept = (keys: string[], length: number): boolean => {
      const next = rest[length];
      if (next === "(" || next === "[" || next === ":") return false;
      if (keys.length === 0 || !keys.every((k) => this.ctx.citeKeys.has(k))) return false;
      this.pushNode({ type: "cite", keys });
      this.pos += length;
      return true;
    };

    const range = CITE_RANGE_RE.exec(rest);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to >= from && to - from < 64) {
        const keys: string[] = [];
        for (let n = from; n <= to; n++) keys.push(String(n));
        return accept(keys, range[0].length);
      }
      return false;
    }

    const list = CITE_LIST_RE.exec(rest);
    if (!list) return false;
    const keys = list[0]
      .slice(1, -1)
      .split(/[,;]/)
      .map((k) => k.trim().replace(/^@/, ""));
    return accept(keys, list[0].length);
  }

  private image(): void {
    const parsed = this.depth < MAX_DEPTH ? this.linkAt(this.pos + 1) : undefined;
    if (!parsed) {
      this.literal("!");
      return;
    }
    const { safe, blocked, scheme } = sanitizeImageUrl(parsed.href);
    if (blocked) this.ctx.warn(`Blocked image with "${scheme ?? "unknown"}" scheme.`);
    const image: TitledImage = {
      type: "image",
      src: safe,
      rawSrc: parsed.href,
      alt: flattenText(this.nested(parsed.label)).trim(),
    };
    if (parsed.title) image.title = parsed.title;
    this.pushNode(image);
    this.pos = parsed.end;
  }

  private nested(source: string): Node[] {
    return new InlineParser(source, this.ctx, this.depth + 1).parse();
  }

  /** Parse `[label](target)`, `[label][ref]`, or `[label]` starting at `open`. */
  private linkAt(
    open: number,
  ): { label: string; href: string; title?: string; end: number } | undefined {
    const close = this.closingBracket(open);
    if (close === undefined) return undefined;
    const label = this.src.slice(open + 1, close);
    const next = this.src[close + 1];

    if (next === "(") {
      const target = this.linkTarget(close + 2);
      if (target) return { label, ...target };
    }
    if (next === "[") {
      const refClose = this.src.indexOf("]", close + 2);
      if (refClose !== -1) {
        const name = this.src.slice(close + 2, refClose) || label;
        const def = this.ctx.linkDefs.get(normalizeLabel(name));
        if (def) return { label, href: def.href, end: refClose + 1 };
      }
    }
    const def = this.ctx.linkDefs.get(normalizeLabel(label));
    return def ? { label, href: def.href, end: close + 1 } : undefined;
  }

  private closingBracket(open: number): number | undefined {
    const limit = Math.min(this.src.length, open + MAX_BRACKET_SCAN);
    let depth = 0;
    for (let i = open; i < limit; i++) {
      const c = this.src[i];
      if (c === "\\") {
        i++;
      } else if (c === "`") {
        // A bracket inside a code span does not count.
        let end = i;
        while (this.src[end] === "`") end++;
        const close = this.src.indexOf(this.src.slice(i, end), end);
        i = close === -1 || close >= limit ? end - 1 : close + (end - i) - 1;
      } else if (c === "[") {
        depth++;
      } else if (c === "]" && --depth === 0) {
        return i;
      }
    }
    return undefined;
  }

  private linkTarget(start: number): { href: string; title?: string; end: number } | undefined {
    const { src } = this;
    let i = start;
    const skipSpace = (): void => {
      while (/[ \t\n]/.test(src[i] ?? "x")) i++;
    };
    skipSpace();

    let href = "";
    if (src[i] === "<") {
      const close = src.indexOf(">", i);
      if (close === -1) return undefined;
      href = src.slice(i + 1, close);
      i = close + 1;
    } else {
      let parens = 0;
      const begin = i;
      for (; i < src.length; i++) {
        const c = src[i]!;
        if (c === "\\" && isAsciiPunctuation(src[i + 1] ?? "")) {
          i++;
        } else if (c === "(") {
          parens++;
        } else if (c === ")") {
          if (parens === 0) break;
          parens--;
        } else if (/\s/.test(c)) {
          break;
        }
      }
      href = src.slice(begin, i).replace(/\\([!-/:-@[-`{-~])/g, "$1");
    }

    skipSpace();
    let title: string | undefined;
    const quote = src[i];
    if (quote === '"' || quote === "'" || quote === "(") {
      const closeQuote = quote === "(" ? ")" : quote;
      const close = src.indexOf(closeQuote, i + 1);
      if (close === -1) return undefined;
      title = src.slice(i + 1, close);
      i = close + 1;
      skipSpace();
    }
    if (src[i] !== ")") return undefined;
    return { href, ...(title !== undefined ? { title } : {}), end: i + 1 };
  }

  /* ------------------------------- HTML ----------------------------- */

  private angle(): void {
    const rest = this.src.slice(this.pos);

    const auto = AUTOLINK_RE.exec(rest);
    if (auto) {
      this.pushNode({ type: "url", href: this.safeHref(auto[1]!), rawHref: auto[1]! });
      this.pos += auto[0].length;
      return;
    }
    const email = EMAIL_RE.exec(rest);
    if (email) {
      const href = `mailto:${email[1]}`;
      this.pushNode({
        type: "link",
        href: this.safeHref(href),
        rawHref: href,
        children: [{ type: "text", value: email[1]! }],
      });
      this.pos += email[0].length;
      return;
    }
    const comment = COMMENT_RE.exec(rest);
    if (comment) {
      this.pos += comment[0].length;
      return;
    }

    const tag = TAG_RE.exec(rest);
    const name = tag?.[2]?.toLowerCase();
    if (!tag || !name || !this.knownTag(name)) {
      // `a < b` and `List<String>` are text, so nothing is lost by guessing wrong.
      this.literal("<");
      return;
    }
    this.pos += tag[0].length;
    if (tag[1] || name === "wbr") return; // A closing tag on its own has no effect.

    if (name === "br") {
      this.pushNode({ type: "linebreak" });
      return;
    }
    if (name === "img") {
      this.htmlImage(tag[3] ?? "");
      return;
    }
    if (HTML_DROPPED.has(name)) {
      const inner = this.takeUntilClosing(name);
      if (inner !== undefined) this.ctx.warn(`Removed a <${name}> element.`);
      return;
    }

    const mark = HTML_MARKS[name];
    if (mark || name === "a" || name === "code" || name === "kbd" || name === "tt") {
      const inner = this.takeUntilClosing(name);
      if (inner === undefined) return;
      if (this.depth >= MAX_DEPTH) {
        this.text += inner;
        return;
      }
      if (name === "code" || name === "kbd" || name === "tt") {
        this.pushNode({ type: "code", value: inner });
      } else if (name === "a") {
        const href = attribute(tag[3] ?? "", "href");
        const children = this.nested(inner);
        if (href) {
          this.pushNode({ type: "link", href: this.safeHref(href), rawHref: href, children });
        } else {
          for (const child of children) this.pushNode(child);
        }
      } else {
        this.pushNode({ type: mark!, children: this.nested(inner) } as Node);
      }
    }
    // Any other known tag just disappears, leaving its content in the flow.
  }

  private knownTag(name: string): boolean {
    return name in HTML_MARKS || HTML_DROPPED.has(name) || HTML_UNWRAPPED.has(name);
  }

  /** The text up to `</name>`, consuming the closing tag; undefined if there is none. */
  private takeUntilClosing(name: string): string | undefined {
    if (this.unclosedTags.has(name)) return undefined;
    const re = new RegExp(`</${name}\\s*>`, "i");
    const m = re.exec(this.src.slice(this.pos));
    if (!m) {
      this.unclosedTags.add(name);
      return undefined;
    }
    const inner = this.src.slice(this.pos, this.pos + m.index);
    this.pos += m.index + m[0].length;
    return inner;
  }

  private htmlImage(attrs: string): void {
    const src = attribute(attrs, "src");
    if (!src) return;
    const { safe, blocked, scheme } = sanitizeImageUrl(src);
    if (blocked) this.ctx.warn(`Blocked image with "${scheme ?? "unknown"}" scheme.`);
    const width = attribute(attrs, "width");
    const image: ImageNode = {
      type: "image",
      src: safe,
      rawSrc: src,
      alt: attribute(attrs, "alt") ?? "",
    };
    // A bare number in HTML means pixels.
    if (width) image.width = /^\d+$/.test(width) ? `${width}px` : width;
    this.pushNode(image);
  }
}

/** Parse a block's raw text into inline ReTeX nodes. */
export function parseInline(source: string, ctx: InlineContext, depth = 0): Node[] {
  return new InlineParser(source.trim(), ctx, depth).parse();
}
