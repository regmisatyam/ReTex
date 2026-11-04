import {
  TokenType,
  verbatimEnvironmentAt,
  type Token,
  type Position,
  type Diagnostic,
} from "../types/index.js";

const isLetter = (c: string): boolean => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");

const isInlineSpace = (c: string): boolean => c === " " || c === "\t" || c === "\r";

export interface TokenizeResult {
  tokens: Token[];
  diagnostics: Diagnostic[];
}

/**
 * Stage 1 of the pipeline. Converts raw ReTeX source into a flat token stream
 * with exact source ranges. The tokenizer is deliberately permissive — it
 * never throws — so the parser can perform error recovery downstream.
 *
 * Design notes specific to resumes:
 *  - `%` is a literal percent sign. Comments are `%%` to end-of-line.
 *  - Escapes (`\%`, `\&`, `\{`, `\_`, `\$`, `\#`, `\ `) become literal text.
 *  - `\\` is an explicit line break.
 *  - A whitespace run containing a blank line becomes a single `ParBreak`.
 */
export class Tokenizer {
  private readonly src: string;
  private offset = 0;
  private line = 1;
  private column = 1;
  private readonly tokens: Token[] = [];
  private readonly diagnostics: Diagnostic[] = [];

  constructor(source: string) {
    // Normalize newlines so position math is consistent across platforms.
    this.src = source.replace(/\r\n?/g, "\n");
  }

  static tokenize(source: string): TokenizeResult {
    return new Tokenizer(source).run();
  }

  run(): TokenizeResult {
    while (!this.atEnd()) {
      this.scanToken();
    }
    this.push(TokenType.EOF, "", this.position());
    return { tokens: this.tokens, diagnostics: this.diagnostics };
  }

  /* --------------------------- scanners --------------------------- */

  private scanToken(): void {
    const start = this.position();
    const c = this.peek();

    switch (c) {
      case "\\":
        this.scanBackslash(start);
        return;
      case "{":
        this.read();
        this.push(TokenType.LBrace, "{", start);
        return;
      case "}":
        this.read();
        this.push(TokenType.RBrace, "}", start);
        return;
      case "[":
        this.read();
        this.push(TokenType.LBracket, "[", start);
        return;
      case "]":
        this.read();
        this.push(TokenType.RBracket, "]", start);
        return;
      case "%":
        if (this.peek(1) === "%") {
          this.scanComment(start);
          return;
        }
        // Lone `%` is a literal percent sign in ReTeX.
        this.scanText(start);
        return;
      default:
        if (isInlineSpace(c) || c === "\n") {
          this.scanWhitespace(start);
          return;
        }
        this.scanText(start);
    }
  }

  private scanBackslash(start: Position): void {
    this.read(); // consume '\'
    const next = this.peek();

    // Explicit line break: `\\`
    if (next === "\\") {
      this.read();
      this.push(TokenType.LineBreak, "\\\\", start);
      return;
    }

    // Control word: `\` + letters (+ optional trailing `*`). Internal hyphens
    // are allowed so compound names like `\email-icon` tokenize as a single
    // command; a hyphen only joins the name when it sits between two letter
    // runs, so a trailing `\foo-` keeps the `-` as literal text.
    if (isLetter(next)) {
      let name = "";
      while (isLetter(this.peek())) name += this.read();
      while (this.peek() === "-" && isLetter(this.peek(1))) {
        name += this.read(); // the '-'
        while (isLetter(this.peek())) name += this.read();
      }
      if (this.peek() === "*") name += this.read();
      this.push(TokenType.Command, name, start);
      if (name === "begin") this.scanVerbatimEnvironment();
      return;
    }

    // Escaped literal: `\%`, `\{`, `\_`, `\ `, … → that single character.
    if (next !== "" && next !== "\n") {
      const ch = this.read();
      this.push(TokenType.Text, ch, start, `\\${ch}`);
      return;
    }

    // Trailing backslash (EOF or before newline): emit as literal text.
    this.push(TokenType.Text, "\\", start);
  }

  /**
   * After a `\begin`: if a verbatim environment follows, emit its `{name}` and
   * `[options]` as ordinary tokens and its whole body as one Verbatim token. The
   * closing `\end{name}` is left for the normal scanner, so the parser needs no
   * special handling beyond accepting the new token.
   */
  private scanVerbatimEnvironment(): void {
    const name = verbatimEnvironmentAt(this.src, this.offset);
    if (name === undefined) return;

    this.scanToken(); // {
    this.pushRead(TokenType.Text, name.length);
    this.scanToken(); // }

    if (this.peek() === "[") {
      const close = this.src.indexOf("]", this.offset);
      const newline = this.src.indexOf("\n", this.offset);
      if (close !== -1 && (newline === -1 || close < newline)) {
        this.scanToken(); // [
        if (close > this.offset) this.pushRead(TokenType.Text, close - this.offset);
        this.scanToken(); // ]
      }
    }

    const end = this.src.indexOf(`\\end{${name}}`, this.offset);
    const length = (end === -1 ? this.src.length : end) - this.offset;
    if (length > 0) this.pushRead(TokenType.Verbatim, length);
  }

  /** Read exactly `length` characters as a single token of the given type. */
  private pushRead(type: TokenType, length: number): void {
    const start = this.position();
    let value = "";
    for (let i = 0; i < length; i++) value += this.read();
    this.push(type, value, start);
  }

  private scanComment(start: Position): void {
    let value = "";
    while (!this.atEnd() && this.peek() !== "\n") value += this.read();
    this.push(TokenType.Comment, value, start);
  }

  private scanWhitespace(start: Position): void {
    let value = "";
    let newlines = 0;
    while (!this.atEnd()) {
      const c = this.peek();
      if (c === "\n") {
        newlines++;
        value += this.read();
      } else if (isInlineSpace(c)) {
        value += this.read();
      } else {
        break;
      }
    }
    this.push(newlines >= 2 ? TokenType.ParBreak : TokenType.Whitespace, value, start);
  }

  private scanText(start: Position): void {
    let value = "";
    while (!this.atEnd()) {
      const c = this.peek();
      if (
        c === "\\" ||
        c === "{" ||
        c === "}" ||
        c === "[" ||
        c === "]" ||
        c === "\n" ||
        isInlineSpace(c)
      ) {
        break;
      }
      // `%%` starts a comment; a lone `%` is literal and continues the run.
      if (c === "%" && this.peek(1) === "%") break;
      value += this.read();
    }
    // A run that began on a lone `%` will have consumed it above; guard the
    // pathological empty case so we always make progress.
    if (value === "") value = this.read();
    this.push(TokenType.Text, value, start);
  }

  /* --------------------------- cursor ----------------------------- */

  private atEnd(): boolean {
    return this.offset >= this.src.length;
  }

  private peek(k = 0): string {
    return this.src[this.offset + k] ?? "";
  }

  private read(): string {
    const c = this.src[this.offset] ?? "";
    this.offset++;
    if (c === "\n") {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return c;
  }

  private position(): Position {
    return { offset: this.offset, line: this.line, column: this.column };
  }

  private push(type: TokenType, value: string, start: Position, raw?: string): void {
    const token: Token = { type, value, range: { start, end: this.position() } };
    if (raw !== undefined) token.raw = raw;
    this.tokens.push(token);
  }
}

/** Convenience wrapper. */
export function tokenize(source: string): TokenizeResult {
  return Tokenizer.tokenize(source);
}
