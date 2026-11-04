import { escapeAttribute, escapeHtml, isSafeColor } from "../security/sanitize.js";
import {
  ACCENTS,
  BIG_SIZES,
  DELIMITERS,
  ESCAPED_DELIMITERS,
  ESCAPED_LITERALS,
  FONT_COMMANDS,
  FUNCTIONS,
  IDENTIFIERS,
  INTEGRALS,
  LARGE_OPERATORS,
  LIMIT_FUNCTIONS,
  MATRICES,
  OPERATORS,
  SPACES,
  STYLE_SWITCHES,
  UPRIGHT_IDENTIFIERS,
  styleCharacter,
  type MathFont,
} from "./symbols.js";

export interface MathOptions {
  /** Block-level formula: big operators take their limits above and below. */
  display?: boolean;
}

export interface MathResult {
  /** A complete `<math>` element. Always usable, even when `errors` is non-empty. */
  mathml: string;
  /** Anything that could not be translated. The source is shown in its place. */
  errors: string[];
}

/** One parsed term, plus how a following `^` or `_` should attach to it. */
interface Atom {
  xml: string;
  /** Scripts go above and below rather than at the side. */
  limits?: boolean;
  /** Extra elements after the term. A script's base must be a single element. */
  after?: string;
}

/** Far deeper than any real formula, and far shallower than the call stack. */
const MAX_DEPTH = 128;
const NO_BREAK_SPACE = "\u00a0";
/** Named functions like `\log` keep a thin space from what follows, as in TeX. */
const APPLY_FUNCTION = '<mo lspace="0" rspace="0.167em">&#x2061;</mo>';

const mo = (char: string, attrs = ""): string => `<mo${attrs}>${escapeHtml(char)}</mo>`;
/** A delimiter at its natural size. MathML would otherwise stretch it to fit. */
const fence = (char: string): string => mo(char, ' stretchy="false"');
const mrow = (items: string[]): string =>
  items.length === 1 ? items[0]! : `<mrow>${items.join("")}</mrow>`;

const isLetter = (c: string): boolean => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
const isDigit = (c: string): boolean => c >= "0" && c <= "9";

/**
 * Compiles the common subset of TeX math to MathML Core, which every current
 * browser renders natively, with no fonts or scripts to ship. Like the rest of
 * ReTeX it never throws: a command it does not know is shown as its source and
 * reported through {@link MathResult.errors}.
 *
 * All output is built from a fixed set of elements with every piece of user text
 * escaped, so it is safe to place in a page as markup.
 */
/*
 * MathML Core ignores `columnalign` and friends, so cell layout goes through CSS.
 */
const MATRIX_CELL = (): string => "text-align:center;padding:0.25em 0.5em";
const CASES_CELL = (): string => "text-align:left;padding:0.25em 1em 0.25em 0";
/** Pairs of cells butt together around `&`, as in `x &= y`; each pair is set apart. */
const ALIGN_CELL = (column: number): string =>
  column % 2 === 0
    ? `text-align:right;padding:0.25em 0 0.25em ${column === 0 ? "0" : "1.5em"}`
    : "text-align:left;padding:0.25em 0";

function attachScripts(
  base: string,
  sub: string | undefined,
  sup: string | undefined,
  limits: boolean,
): string {
  if (sup === undefined && sub === undefined) return base;
  if (limits) {
    if (sub !== undefined && sup !== undefined) {
      return `<munderover>${base}${sub}${sup}</munderover>`;
    }
    if (sub !== undefined) return `<munder>${base}${sub}</munder>`;
    return `<mover>${base}${sup!}</mover>`;
  }
  if (sub !== undefined && sup !== undefined) {
    return `<msubsup>${base}${sub}${sup}</msubsup>`;
  }
  if (sub !== undefined) return `<msub>${base}${sub}</msub>`;
  return `<msup>${base}${sup!}</msup>`;
}

class MathParser {
  private pos = 0;
  private depth = 0;
  private font: MathFont | undefined;
  /** Where the command being parsed began, for looking at what precedes it. */
  private commandStart = 0;
  readonly errors: string[] = [];

  constructor(
    private readonly src: string,
    private display: boolean,
  ) {}

  parse(): string {
    const items = this.parseUntil(() => false);
    return mrow(items);
  }

  /* --------------------------- sequences ---------------------------- */

  /** Give up on a formula nested too deeply, showing what's left as its source. */
  private bail(): string {
    this.errors.push("Formula is nested too deeply.");
    const rest = this.src.slice(this.pos);
    this.pos = this.src.length;
    return `<mtext>${escapeHtml(rest)}</mtext>`;
  }

  private parseUntil(stop: () => boolean): string[] {
    if (++this.depth > MAX_DEPTH) {
      this.depth--;
      return [this.bail()];
    }
    const items: string[] = [];
    try {
      for (;;) {
        this.skipSpace();
        if (this.atEnd() || stop()) break;
        const style = this.styleSwitch();
        if (style) {
          // `\displaystyle` applies to the rest of the enclosing group.
          const wasDisplay = this.display;
          this.display = style.display;
          const rest = this.parseUntil(stop);
          this.display = wasDisplay;
          items.push(`<mstyle${style.attrs}>${rest.join("")}</mstyle>`);
          break;
        }
        const before = this.pos;
        const atom = this.parseScripted();
        if (atom) items.push(atom);
        if (this.pos === before) this.pos++; // Always make progress.
      }
    } finally {
      this.depth--;
    }
    return items;
  }

  private styleSwitch(): { attrs: string; display: boolean } | undefined {
    const name = this.peekWord();
    const style = name !== undefined ? STYLE_SWITCHES[name] : undefined;
    if (!style) return undefined;
    this.pos += name!.length + 1;
    return style;
  }

  /* ----------------------------- scripts ---------------------------- */

  private parseScripted(): string {
    const atom = this.parseAtom();
    let limits = atom?.limits ?? false;
    let base = atom?.xml ?? "<mrow></mrow>";

    let sup: string | undefined;
    let sub: string | undefined;
    let primes = 0;
    for (;;) {
      this.skipSpace();
      const c = this.peek();
      const word = this.peekWord();
      if (c === "'") {
        this.pos++;
        primes++;
      } else if (c === "^" && sup === undefined) {
        this.pos++;
        sup = this.parseScriptArg();
      } else if (c === "_" && sub === undefined) {
        this.pos++;
        sub = this.parseScriptArg();
      } else if (word === "limits") {
        this.pos += word.length + 1;
        limits = true;
      } else if (word === "nolimits") {
        this.pos += word.length + 1;
        limits = false;
      } else {
        break;
      }
    }

    if (primes > 0) {
      const marks = mo("′".repeat(primes));
      sup = sup === undefined ? marks : `<mrow>${marks}${sup}</mrow>`;
    }
    return attachScripts(base, sub, sup, limits) + (atom?.after ?? "");
  }

  private parseScriptArg(): string {
    return this.parseArgument(false);
  }

  /* ------------------------------ atoms ----------------------------- */

  private parseAtom(): Atom | null {
    if (this.atEnd()) return null;
    // Commands take arguments without braces, so `\sqrt\sqrt\sqrt…` nests too.
    if (++this.depth > MAX_DEPTH) {
      this.depth--;
      return { xml: this.bail() };
    }
    try {
      return this.parseAtomBody();
    } finally {
      this.depth--;
    }
  }

  private parseAtomBody(): Atom | null {
    const c = this.peek();
    if (c === "{") return { xml: this.parseGroup() };
    if (c === "\\") return this.parseCommand();
    if (c === "}" || c === "&") {
      this.pos++;
      return c === "&" ? { xml: fence("&") } : null;
    }
    if (c === "~") {
      this.pos++;
      return { xml: '<mspace width="0.33em"></mspace>' };
    }
    if (c === "^" || c === "_") return null; // Handled by the caller as a script.
    if (isDigit(c) || (c === "." && isDigit(this.peek(1)))) return { xml: this.parseNumber() };
    if (isLetter(c)) {
      this.pos++;
      return { xml: this.identifier(c) };
    }
    return { xml: this.parseCharacter() };
  }

  private parseNumber(): string {
    let text = "";
    while (isDigit(this.peek()) || (this.peek() === "." && isDigit(this.peek(1)))) {
      text += this.src[this.pos++];
    }
    if (this.font && this.font !== "normal") {
      text = [...text].map((ch) => styleCharacter(ch, this.font!)).join("");
    }
    return `<mn>${text}</mn>`;
  }

  private identifier(char: string, upright = false): string {
    const font = this.font;
    if (font === "normal" || (upright && !font)) {
      return `<mi mathvariant="normal">${escapeHtml(char)}</mi>`;
    }
    return `<mi>${escapeHtml(font ? styleCharacter(char, font) : char)}</mi>`;
  }

  /** A character typed directly: an operator, a delimiter, or Unicode math. */
  private parseCharacter(): string {
    const char = String.fromCodePoint(this.src.codePointAt(this.pos)!);
    this.pos += char.length;
    switch (char) {
      case "(":
      case ")":
      case "[":
      case "]":
      case "|":
        return fence(char);
      case "-":
        return this.isUnary() ? mo("−", ' lspace="0" rspace="0"') : mo("−");
      case ",":
      case ";":
        return mo(char, ' separator="true"');
      default:
        if (/\p{L}/u.test(char)) return this.identifier(char);
        if (/\p{N}/u.test(char)) return `<mn>${escapeHtml(char)}</mn>`;
        return mo(char);
    }
  }

  /** A minus with nothing to subtract from, as in `= -x`, hugs what follows it. */
  private isUnary(): boolean {
    const before = this.src.slice(Math.max(0, this.pos - 24), this.pos - 1).trimEnd();
    if (before === "" || /[=<>+\-*/(,[{|:;&^_]$/.test(before)) return true;
    const command = /\\([a-zA-Z]+)$/.exec(before);
    return command !== null && command[1]! in OPERATORS;
  }

  private parseGroup(): string {
    this.pos++; // {
    const items = this.parseUntil(() => this.peek() === "}");
    if (this.peek() === "}") this.pos++;
    else this.errors.push("Missing closing brace.");
    return `<mrow>${items.join("")}</mrow>`;
  }

  /**
   * An argument: a `{group}` or a single token. As in TeX, that means one digit
   * rather than a whole number, so `\frac12` is one half and `x^12` is x squared
   * followed by a 2.
   */
  private parseArgument(required = true): string {
    this.skipSpace();
    if (this.atEnd()) {
      if (required) this.errors.push("A command is missing its argument.");
      return "<mrow></mrow>";
    }
    if (isDigit(this.peek())) {
      const digit = this.src[this.pos++]!;
      const styled = this.font ? styleCharacter(digit, this.font) : digit;
      return `<mn>${styled}</mn>`;
    }
    return this.parseAtom()?.xml ?? "<mrow></mrow>";
  }

  /** The source text of a `{...}` group, unparsed. */
  private readRawGroup(): string {
    this.skipSpace();
    if (this.peek() !== "{") {
      const c = this.peek();
      this.pos += c.length;
      return c;
    }
    this.pos++;
    let depth = 1;
    let out = "";
    while (!this.atEnd()) {
      const c = this.src[this.pos++]!;
      if (c === "\\") {
        out += c + (this.src[this.pos++] ?? "");
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return out;
      out += c;
    }
    return out;
  }

  /** A `[...]` optional argument, if present. */
  private readOptional(): string | undefined {
    this.skipSpace();
    if (this.peek() !== "[") return undefined;
    const close = this.src.indexOf("]", this.pos);
    if (close === -1) return undefined;
    const value = this.src.slice(this.pos + 1, close);
    this.pos = close + 1;
    return value;
  }

  private parseSubexpression(source: string): string {
    const sub = new MathParser(source, this.display);
    sub.font = this.font;
    sub.depth = this.depth;
    const xml = sub.parse();
    this.errors.push(...sub.errors);
    return xml;
  }

  /* ---------------------------- commands ---------------------------- */

  private parseCommand(): Atom | null {
    this.commandStart = this.pos;
    this.pos++; // backslash
    const c = this.peek();
    if (this.atEnd()) return { xml: mo("\\") };
    if (!isLetter(c)) return this.parseSymbolCommand(c);

    let name = "";
    while (isLetter(this.peek())) name += this.src[this.pos++];
    if (this.peek() === "*") {
      if (name === "operatorname") {
        this.pos++;
        return this.operatorName(true);
      }
    }
    return this.dispatch(name);
  }

  private parseSymbolCommand(c: string): Atom {
    this.pos += c.length;
    const space = SPACES[c];
    if (space) return { xml: `<mspace width="${space}"></mspace>` };
    if (c in ESCAPED_DELIMITERS) return { xml: fence(ESCAPED_DELIMITERS[c]!) };
    if (ESCAPED_LITERALS.has(c)) return { xml: mo(c) };
    if (c === "\\") return { xml: "" }; // A row break outside any table.
    this.errors.push(`Unsupported command "\\${c}".`);
    return { xml: this.sourceFallback(`\\${c}`) };
  }

  private dispatch(name: string): Atom | null {
    if (name in IDENTIFIERS) return { xml: this.identifier(IDENTIFIERS[name]!) };
    if (name in UPRIGHT_IDENTIFIERS) {
      return { xml: this.identifier(UPRIGHT_IDENTIFIERS[name]!, true) };
    }
    if (name in OPERATORS) return { xml: mo(OPERATORS[name]!) };
    if (name in DELIMITERS) return { xml: fence(DELIMITERS[name]!) };
    if (name in LARGE_OPERATORS) {
      return {
        xml: mo(LARGE_OPERATORS[name]!, ' largeop="true" movablelimits="false"'),
        limits: this.display,
      };
    }
    if (name in INTEGRALS) return { xml: mo(INTEGRALS[name]!, ' largeop="true"') };
    if (FUNCTIONS.has(name)) return this.namedFunction(name, false);
    if (name in LIMIT_FUNCTIONS) return this.namedFunction(LIMIT_FUNCTIONS[name]!, this.display);
    if (name in SPACES) return { xml: `<mspace width="${SPACES[name]}"></mspace>` };
    if (name in ACCENTS) return { xml: this.accent(name) };
    if (name in BIG_SIZES) return { xml: this.bigDelimiter(BIG_SIZES[name]!) };
    if (name in FONT_COMMANDS) return { xml: this.withFont(FONT_COMMANDS[name]!) };

    switch (name) {
      case "frac":
      case "cfrac":
        return { xml: this.fraction("") };
      case "dfrac":
        return { xml: this.fraction(' displaystyle="true"') };
      case "tfrac":
        return { xml: this.fraction(' displaystyle="false"') };
      case "binom":
      case "dbinom":
      case "tbinom": {
        const top = this.parseArgument();
        const bottom = this.parseArgument();
        const stretchy = ' stretchy="true" fence="true"';
        return {
          xml: `<mrow>${mo("(", stretchy)}<mfrac linethickness="0">${top}${bottom}</mfrac>${mo(")", stretchy)}</mrow>`,
        };
      }
      case "sqrt": {
        const index = this.readOptional();
        const body = this.parseArgument();
        return {
          xml:
            index !== undefined
              ? `<mroot>${body}${this.parseSubexpression(index)}</mroot>`
              : `<msqrt>${body}</msqrt>`,
        };
      }
      case "left":
        return { xml: this.leftRight() };
      case "right":
      case "middle":
        // Only meaningful inside `\left`, which consumes them itself.
        this.readDelimiter();
        return null;
      case "begin":
        return { xml: this.environment() };
      case "end":
        this.readRawGroup();
        return null;
      case "text":
      case "textrm":
      case "mbox":
      case "hbox":
      case "textnormal":
      case "textup":
        return { xml: this.textRun("") };
      case "textbf":
        return { xml: this.textRun(' style="font-weight:bold"') };
      case "textit":
      case "emph":
        return { xml: this.textRun(' style="font-style:italic"') };
      case "texttt":
        return { xml: this.textRun(' style="font-family:monospace"') };
      case "mathit":
        return { xml: this.parseArgument() };
      case "operatorname":
        return this.operatorName(false);
      case "overset":
      case "stackrel": {
        const over = this.parseArgument();
        const base = this.parseArgument();
        return { xml: `<mover>${base}${over}</mover>` };
      }
      case "underset": {
        const under = this.parseArgument();
        const base = this.parseArgument();
        return { xml: `<munder>${base}${under}</munder>` };
      }
      case "overbrace":
        return { xml: `<mover>${this.parseArgument()}${mo("⏞")}</mover>`, limits: true };
      case "underbrace":
        return { xml: `<munder>${this.parseArgument()}${mo("⏟")}</munder>`, limits: true };
      case "xrightarrow":
      case "xleftarrow": {
        const under = this.readOptional();
        const over = this.parseArgument();
        const arrow = mo(name === "xrightarrow" ? "→" : "←", ' stretchy="true"');
        return {
          xml:
            under !== undefined
              ? `<munderover>${arrow}${this.parseSubexpression(under)}${over}</munderover>`
              : `<mover>${arrow}${over}</mover>`,
        };
      }
      case "substack":
        return { xml: this.substack() };
      case "not":
        return { xml: this.negated() };
      case "phantom":
        return { xml: `<mphantom>${this.parseArgument()}</mphantom>` };
      case "boxed":
        return {
          xml: `<mrow style="border:1px solid currentColor;padding:0.2em">${this.parseArgument()}</mrow>`,
        };
      case "cancel":
        return {
          xml: `<mrow style="text-decoration:line-through">${this.parseArgument()}</mrow>`,
        };
      case "textcolor":
      case "color": {
        const color = this.readRawGroup().trim();
        const body = this.parseArgument();
        return {
          xml: isSafeColor(color)
            ? `<mrow style="color:${escapeAttribute(color)}">${body}</mrow>`
            : body,
        };
      }
      case "ensuremath":
        return { xml: this.parseArgument() };
      case "hspace":
        return { xml: this.explicitSpace() };
      case "tag":
        return {
          xml: `<mrow><mspace width="1em"></mspace><mtext>(${escapeHtml(this.readRawGroup())})</mtext></mrow>`,
        };
      case "label":
        this.readRawGroup();
        return null;
      case "nonumber":
      case "notag":
      case "limits":
      case "nolimits":
      case "hline":
      case "cline":
      case "toprule":
      case "midrule":
      case "bottomrule":
      case "centering":
      case "nobreak":
      case "allowbreak":
        return null;
      case "bmod":
      case "mod":
        return { xml: `<mo lspace="0.25em" rspace="0.25em">mod</mo>` };
      case "pmod":
        return {
          xml: `<mrow><mspace width="0.5em"></mspace>${fence("(")}<mi>mod</mi><mspace width="0.33em"></mspace>${this.parseArgument()}${fence(")")}</mrow>`,
        };
      default:
        this.errors.push(`Unsupported command "\\${name}".`);
        return { xml: this.sourceFallback(`\\${name}`) };
    }
  }

  /** Show unknown source as-is rather than losing it. */
  private sourceFallback(source: string): string {
    return `<mtext class="retex-math-error">${escapeHtml(source)}</mtext>`;
  }

  private fraction(attrs: string): string {
    const top = this.parseArgument();
    const bottom = this.parseArgument();
    return `<mfrac${attrs}>${top}${bottom}</mfrac>`;
  }

  private withFont(font: MathFont): string {
    const previous = this.font;
    this.font = font;
    const body = this.parseArgument();
    this.font = previous;
    return body;
  }

  private accent(name: string): string {
    const { mark, stretchy, under } = ACCENTS[name]!;
    const op = mo(mark, stretchy ? ' stretchy="true"' : ' stretchy="false"');
    const body = this.parseArgument();
    return under
      ? `<munder accentunder="true">${body}${op}</munder>`
      : `<mover accent="true">${body}${op}</mover>`;
  }

  private operatorName(limits: boolean): Atom {
    const name = this.readRawGroup().replace(/\\,|\\ |\\!/g, "");
    return this.namedFunction(name.replace(/\s+/g, " ").trim(), limits && this.display);
  }

  /**
   * An upright function name. It is set off from a term before it, but not from an
   * opening delimiter: `x \log y` needs the gap, and `(\log y)` does not.
   */
  private namedFunction(name: string, limits: boolean): Atom {
    const before = this.src
      .slice(Math.max(0, this.commandStart - 32), this.commandStart)
      .trimEnd()
      .slice(-1);
    const spaced = /[\p{L}\p{N})\]}]/u.test(before);
    const lead = spaced ? '<mspace width="0.167em"></mspace>' : "";
    const xml = `<mi>${escapeHtml(name)}</mi>`;
    // Lead space must stay outside any script, so it wraps the term as a whole.
    return { xml: lead ? `<mrow>${lead}${xml}</mrow>` : xml, limits, after: APPLY_FUNCTION };
  }

  private textRun(attrs: string): string {
    // Spaces at the edges matter here, and MathML would trim them.
    const text = this.readRawGroup().replace(/\\([%$#&_{}])/g, "$1");
    const body = text.trim();
    const lead = text.length - text.trimStart().length;
    const trail = body === "" ? 0 : text.length - text.trimEnd().length;
    const shown = NO_BREAK_SPACE.repeat(lead) + body + NO_BREAK_SPACE.repeat(trail);
    return `<mtext${attrs}>${escapeHtml(shown)}</mtext>`;
  }

  private explicitSpace(): string {
    const width = this.readRawGroup().trim();
    return /^-?\d*\.?\d+(em|ex|pt|px|mm|cm|in)$/.test(width)
      ? `<mspace width="${width}"></mspace>`
      : "";
  }

  private negated(): string {
    this.skipSpace();
    const atom = this.parseAtom();
    const match = atom ? /^<mo[^>]*>([^<]+)<\/mo>$/.exec(atom.xml) : null;
    return match ? `<mo>${match[1]}̸</mo>` : (atom?.xml ?? "");
  }

  /* --------------------------- delimiters --------------------------- */

  /** Read the delimiter after `\left` or `\big`; `.` means none. */
  private readDelimiter(): string {
    this.skipSpace();
    const c = this.peek();
    if (c === "\\") {
      this.pos++;
      const next = this.peek();
      if (!isLetter(next)) {
        this.pos += next.length;
        return ESCAPED_DELIMITERS[next] ?? next;
      }
      let name = "";
      while (isLetter(this.peek())) name += this.src[this.pos++];
      return DELIMITERS[name] ?? OPERATORS[name] ?? "";
    }
    if (this.atEnd()) return "";
    this.pos += c.length;
    return c === "." ? "" : c;
  }

  private leftRight(): string {
    const open = this.readDelimiter();
    const items: string[] = [];
    if (open) items.push(mo(open, ' stretchy="true" fence="true"'));

    // `\middle` splits the body; everything else is ordinary content.
    for (;;) {
      items.push(
        ...this.parseUntil(() => {
          const word = this.peekWord();
          return word === "right" || word === "middle";
        }),
      );
      const word = this.peekWord();
      if (word === "middle") {
        this.pos += word.length + 1;
        const middle = this.readDelimiter();
        if (middle) items.push(mo(middle, ' stretchy="true"'));
        continue;
      }
      if (word === "right") {
        this.pos += word.length + 1;
        const close = this.readDelimiter();
        if (close) items.push(mo(close, ' stretchy="true" fence="true"'));
      } else {
        this.errors.push("\\left has no matching \\right.");
      }
      break;
    }
    return `<mrow>${items.join("")}</mrow>`;
  }

  private bigDelimiter(size: string): string {
    const delimiter = this.readDelimiter();
    if (!delimiter) return "";
    return mo(delimiter, ` stretchy="true" minsize="${size}" maxsize="${size}"`);
  }

  /* --------------------------- environments ------------------------- */

  private environment(): string {
    const name = this.readRawGroup().trim();
    const base = name.replace(/\*$/, "");

    if (base in MATRICES) {
      const [left, right] = MATRICES[base]!;
      const table = this.table(name, MATRIX_CELL, base === "smallmatrix");
      if (!left) return table;
      return `<mrow>${mo(left, ' stretchy="true" fence="true"')}${table}${mo(right, ' stretchy="true" fence="true"')}</mrow>`;
    }

    switch (base) {
      case "cases":
        return `<mrow>${mo("{", ' stretchy="true" fence="true"')}${this.table(name, CASES_CELL)}</mrow>`;
      case "rcases":
        return `<mrow>${this.table(name, CASES_CELL)}${mo("}", ' stretchy="true" fence="true"')}</mrow>`;
      case "align":
      case "aligned":
      case "alignat":
      case "alignedat":
      case "split":
      case "flalign":
        if (base === "alignat" || base === "alignedat") this.readRawGroup();
        return this.table(name, ALIGN_CELL);
      case "gather":
      case "gathered":
      case "multline":
        return this.table(name, MATRIX_CELL);
      case "array":
      case "subarray": {
        const spec = this.readRawGroup().replace(/[^lcr]/g, "");
        const alignOf: Record<string, string> = { l: "left", c: "center", r: "right" };
        return this.table(
          name,
          (column) => `text-align:${alignOf[spec[column] ?? "c"] ?? "center"};padding:0.25em 0.5em`,
        );
      }
      case "equation":
      case "displaymath":
      case "math": {
        const items = this.parseUntil(() => this.atEndOf(name));
        this.consumeEnd(name);
        return `<mrow>${items.join("")}</mrow>`;
      }
      default: {
        this.errors.push(`Unsupported environment "${name}".`);
        const items = this.parseUntil(() => this.atEndOf(name));
        this.consumeEnd(name);
        return `<mrow>${items.join("")}</mrow>`;
      }
    }
  }

  private table(name: string, cellStyle: (column: number) => string, small = false): string {
    const rows: string[] = [];
    let cells: string[] = [];
    const cellEnd = (): boolean =>
      this.peek() === "&" ||
      (this.peek() === "\\" && this.peek(1) === "\\") ||
      this.atEndOf(name);

    const pushCell = (items: string[]): void => {
      cells.push(`<mtd style="${cellStyle(cells.length)}">${items.join("")}</mtd>`);
    };

    while (!this.atEnd()) {
      pushCell(this.parseUntil(cellEnd));
      if (this.peek() === "&") {
        this.pos++;
        continue;
      }
      if (this.peek() === "\\" && this.peek(1) === "\\") {
        this.pos += 2;
        this.readOptional(); // `\\[2pt]`
        rows.push(`<mtr>${cells.join("")}</mtr>`);
        cells = [];
        continue;
      }
      break;
    }

    // A trailing `\\` leaves one empty cell behind, which is not a real row.
    const trailingEmpty = cells.length === 1 && cells[0]!.endsWith("></mtd>");
    if (cells.length > 0 && !trailingEmpty) rows.push(`<mtr>${cells.join("")}</mtr>`);

    this.consumeEnd(name);
    const attrs = small ? ' displaystyle="false" scriptlevel="1"' : ' displaystyle="true"';
    return `<mtable${attrs}>${rows.join("")}</mtable>`;
  }

  private substack(): string {
    const rows = this.readRawGroup()
      .split(/\\\\/)
      .map((row) => `<mtr><mtd>${this.parseSubexpression(row)}</mtd></mtr>`);
    return `<mtable displaystyle="false" scriptlevel="1">${rows.join("")}</mtable>`;
  }

  private atEndOf(name: string): boolean {
    return this.src.startsWith(`\\end{${name}}`, this.pos);
  }

  private consumeEnd(name: string): void {
    if (this.atEndOf(name)) this.pos += `\\end{${name}}`.length;
    else this.errors.push(`Missing \\end{${name}}.`);
  }

  /* ----------------------------- cursor ----------------------------- */

  private atEnd(): boolean {
    return this.pos >= this.src.length;
  }

  private peek(k = 0): string {
    return this.src[this.pos + k] ?? "";
  }

  /** The control word at the cursor, without consuming it. */
  private peekWord(): string | undefined {
    if (this.peek() !== "\\") return undefined;
    let end = this.pos + 1;
    while (isLetter(this.src[end] ?? "")) end++;
    return end > this.pos + 1 ? this.src.slice(this.pos + 1, end) : undefined;
  }

  private skipSpace(): void {
    while (/\s/.test(this.peek()) && !this.atEnd()) this.pos++;
  }
}

/**
 * Compile a TeX formula to a `<math>` element. The original source is kept in an
 * `<annotation>`, so copying the formula from a page still yields the TeX.
 */
export function texToMathML(tex: string, options: MathOptions = {}): MathResult {
  const display = options.display ?? false;
  const parser = new MathParser(tex, display);
  const body = parser.parse();
  const annotation = `<annotation encoding="application/x-tex">${escapeHtml(tex)}</annotation>`;
  return {
    mathml: `<math display="${display ? "block" : "inline"}"><semantics>${body}${annotation}</semantics></math>`,
    errors: parser.errors,
  };
}

/** Operators that TeX sets with space around them, so they read wider. */
const SPACED_OPERATOR_RE = /^[=<>≤≥≠≈≡∼∝∈∉⊂⊃⊆⊇→←⇒⇔↦+−×±∓⋅∘]$/u;

/**
 * Roughly how wide a formula will be, in em. Good enough to decide whether it fits
 * a column, without a browser to measure it. It reads the MathML this module makes,
 * so it can rely on tags being balanced.
 */
export function estimateMathWidth(mathml: string): number {
  const body = mathml.replace(/<annotation[\s\S]*?<\/annotation>/, "");
  const re = /<(\/?)([a-z]+)((?:\s[^>]*)?)>([^<]*)/g;

  interface Frame {
    name: string;
    children: number[];
  }
  const stack: Frame[] = [{ name: "root", children: [] }];
  const add = (width: number): void => {
    stack[stack.length - 1]!.children.push(width);
  };

  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const [, closing, name, attrs, text] = m as unknown as [string, string, string, string, string];
    if (!closing) {
      stack.push({ name, children: [] });
      if (name === "mspace") {
        const width = /width="(-?[\d.]+)em"/.exec(attrs);
        add(width ? Number(width[1]) : 0);
      } else if (name === "mi" || name === "mn") {
        add([...decodeEntities(text)].length * 0.55);
      } else if (name === "mtext") {
        add([...decodeEntities(text)].length * 0.48);
      } else if (name === "mo") {
        const op = decodeEntities(text);
        add(attrs.includes("largeop") ? 1.2 : SPACED_OPERATOR_RE.test(op) ? 1 : op === "\u2061" ? 0.15 : 0.5);
      }
      continue;
    }
    const frame = stack.pop();
    if (!frame || stack.length === 0) break;
    const [first = 0, second = 0, third = 0] = frame.children;
    const sum = frame.children.reduce((total, w) => total + w, 0);
    switch (frame.name) {
      case "mfrac":
        add(Math.max(first, second) + 0.3);
        break;
      case "msub":
      case "msup":
        add(first + second * 0.7);
        break;
      case "msubsup":
        add(first + Math.max(second, third) * 0.7);
        break;
      case "munder":
      case "mover":
        add(Math.max(first, second * 0.7));
        break;
      case "munderover":
        add(Math.max(first, second * 0.7, third * 0.7));
        break;
      case "mroot":
        add(first + second * 0.7 + 0.6);
        break;
      case "msqrt":
        add(sum + 0.8);
        break;
      case "mtable":
        add(Math.max(0, ...frame.children));
        break;
      default:
        add(sum);
    }
  }
  return Math.max(0, ...(stack[0]?.children ?? []));
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&[a-z]+;|&#\d+;/gi, "x");
}
