import {
  TokenType,
  DiagnosticSeverity,
  DiagnosticCode,
  type Token,
  type Position,
  type SourceRange,
  type Diagnostic,
  type Node,
  type DocumentNode,
  type GroupNode,
  type ArgumentNode,
  type CommandNode,
  type ArgSpec,
  type CommandDefinition,
  type EnvEntry,
  type BuilderUtils,
} from "../types/index.js";
import { CommandRegistry } from "./registry.js";
import { createDefaultRegistry } from "./builtins.js";
import { flattenText } from "../ast/text.js";
import { sanitizeUrl } from "../security/sanitize.js";
import { closestMatch } from "./suggest.js";

export interface ParseResult {
  ast: DocumentNode;
  diagnostics: Diagnostic[];
}

export interface ParserOptions {
  registry?: CommandRegistry;
  /**
   * Maximum structural nesting depth before the parser stops recursing and
   * degrades gracefully (emitting a diagnostic). Guards against stack overflow
   * on adversarial input such as thousands of unclosed braces. Default 300.
   */
  maxDepth?: number;
}

const ZERO: Position = { offset: 0, line: 1, column: 1 };
const ZERO_RANGE: SourceRange = { start: ZERO, end: ZERO };

/**
 * Stage 2 of the pipeline. A recursive-descent parser that turns the token
 * stream into a {@link DocumentNode}. It is fully error-recovering: it never
 * throws, always returns a tree, and records every problem as a
 * {@link Diagnostic} so editors and the validator can surface them.
 */
export class Parser {
  private readonly tokens: Token[];
  private readonly registry: CommandRegistry;
  private readonly diagnostics: Diagnostic[] = [];
  private readonly utils: BuilderUtils;
  private pos = 0;
  private depth = 0;
  private readonly maxDepth: number;
  private reportedMaxDepth = false;
  /** Range of the command currently being built, for builder diagnostics. */
  private currentRange: SourceRange = ZERO_RANGE;

  constructor(tokens: Token[], options: ParserOptions = {}) {
    this.tokens = tokens;
    this.registry = options.registry ?? createDefaultRegistry();
    this.maxDepth = options.maxDepth ?? 300;
    this.utils = {
      textOf: (arg) => {
        if (!arg) return "";
        if (arg.raw !== undefined) return arg.raw;
        return flattenText(arg.children);
      },
      safeUrl: (url) => {
        const res = sanitizeUrl(url);
        if (res.blocked) {
          this.report({
            severity: DiagnosticSeverity.Warning,
            code: DiagnosticCode.UnsafeUrlBlocked,
            message: `Blocked unsafe URL with "${res.scheme ?? "unknown"}" scheme.`,
            range: this.currentRange,
          });
        }
        return res.safe;
      },
    };
  }

  static parse(tokens: Token[], options?: ParserOptions): ParseResult {
    return new Parser(tokens, options).parse();
  }

  parse(): ParseResult {
    const start = this.peek().range.start;
    const children = this.parseContent(() => this.at(TokenType.EOF));
    const ast: DocumentNode = {
      type: "document",
      children,
      range: { start, end: this.previousEnd() },
    };
    return { ast, diagnostics: this.diagnostics };
  }

  /* --------------------------- content loop --------------------------- */

  private parseContent(stop: () => boolean): Node[] {
    if (++this.depth > this.maxDepth) {
      this.depth--;
      return this.skipFlat(stop);
    }
    try {
      return this.parseContentInner(stop);
    } finally {
      this.depth--;
    }
  }

  private parseContentInner(stop: () => boolean): Node[] {
    const nodes: Node[] = [];
    while (!this.at(TokenType.EOF) && !stop()) {
      const tok = this.peek();
      if (tok.type === TokenType.Command) {
        const def = this.registry.getCommand(tok.value);
        if (def?.scoped) {
          const built = this.parseScopedSwitch(def, stop);
          if (Array.isArray(built)) nodes.push(...built);
          else nodes.push(built);
          break; // the switch consumed the remainder of this scope
        }
      }
      const node = this.parseNode();
      if (Array.isArray(node)) nodes.push(...node);
      else if (node) nodes.push(node);
    }
    return nodes;
  }

  private parseNode(): Node | Node[] | null {
    const tok = this.peek();
    switch (tok.type) {
      case TokenType.Command:
        return this.parseCommandApplication();
      case TokenType.LBrace:
        return this.parseGroup();
      case TokenType.RBrace:
        this.advance();
        this.report({
          severity: DiagnosticSeverity.Warning,
          code: DiagnosticCode.MismatchedBrace,
          message: "Unexpected '}' with no matching '{'.",
          range: tok.range,
        });
        return null;
      case TokenType.Text:
        this.advance();
        return { type: "text", value: tok.value, range: tok.range };
      case TokenType.Whitespace:
        this.advance();
        return { type: "text", value: " ", range: tok.range };
      case TokenType.ParBreak:
        this.advance();
        return { type: "parbreak", range: tok.range };
      case TokenType.LineBreak:
        this.advance();
        return { type: "linebreak", range: tok.range };
      case TokenType.LBracket:
        this.advance();
        return { type: "text", value: "[", range: tok.range };
      case TokenType.RBracket:
        this.advance();
        return { type: "text", value: "]", range: tok.range };
      case TokenType.Verbatim:
        this.advance();
        return { type: "text", value: tok.value, range: tok.range };
      case TokenType.Comment:
      default:
        this.advance();
        return null;
    }
  }

  private parseGroup(): GroupNode {
    const open = this.advance(); // {
    const children = this.parseContent(() => this.at(TokenType.RBrace));
    const end = this.consumeClose(
      TokenType.RBrace,
      open,
      DiagnosticCode.UnterminatedGroup,
    );
    return { type: "group", children, range: { start: open.range.start, end } };
  }

  /* --------------------------- commands ------------------------------- */

  private parseScopedSwitch(def: CommandDefinition, stop: () => boolean): Node | Node[] {
    const start = this.advance(); // switch command
    const args = this.parseArgs(def.args ?? []);
    const scope = this.parseContent(stop);
    return this.buildCommand(def, args, scope, start);
  }

  private parseCommandApplication(): Node | Node[] | null {
    const start = this.advance();
    const name = start.value;

    if (name === "begin") return this.parseEnvironment(start);
    if (name === "end") {
      // A stray `\end` with no open environment.
      this.skipInlineTrivia();
      const got = this.tryReadGroupRaw();
      this.report({
        severity: DiagnosticSeverity.Error,
        code: DiagnosticCode.MismatchedEnvironment,
        message: got
          ? `\\end{${got}} has no matching \\begin{${got}}.`
          : "\\end has no matching \\begin.",
        range: { start: start.range.start, end: this.previousEnd() },
      });
      return null;
    }

    const def = this.registry.getCommand(name);
    if (!def) {
      const args = this.parseGreedyArgs();
      const range = { start: start.range.start, end: this.previousEnd() };
      const suggestion = closestMatch(name, this.registry.commandNames());
      this.report({
        severity: DiagnosticSeverity.Warning,
        code: DiagnosticCode.UnknownCommand,
        message: suggestion
          ? `Unknown command "\\${name}". Did you mean "\\${suggestion}"?`
          : `Unknown command "\\${name}".`,
        range,
        ...(suggestion
          ? {
              fixes: [
                {
                  title: `Replace with \\${suggestion}`,
                  replacement: `\\${suggestion}`,
                  range: start.range,
                },
              ],
            }
          : {}),
      });
      return { type: "command", name, args, range };
    }

    const args = this.parseArgs(def.args ?? []);
    return this.buildCommand(def, args, [], start);
  }

  private buildCommand(
    def: CommandDefinition,
    args: ArgumentNode[],
    scope: Node[],
    start: Token,
  ): Node | Node[] {
    const range: SourceRange = { start: start.range.start, end: this.previousEnd() };
    this.currentRange = range;
    const built = def.build
      ? def.build({
          name: def.name,
          args,
          scope,
          report: (d) => this.report(d),
          utils: this.utils,
        })
      : null;

    if (built == null) {
      return { type: "command", name: def.name, args, range };
    }
    if (Array.isArray(built)) {
      for (const n of built) if (!n.range) n.range = range;
      return built;
    }
    if (!built.range) built.range = range;
    return built;
  }

  /* --------------------------- arguments ------------------------------ */

  private parseArgs(specs: ArgSpec[]): ArgumentNode[] {
    const args: ArgumentNode[] = [];
    for (const spec of specs) {
      if (spec.variadic) {
        let next: ArgumentNode | null;
        while ((next = this.parseArg(spec))) args.push(next);
        continue;
      }
      const arg = this.parseArg(spec);
      if (arg) {
        args.push(arg);
      } else if (!spec.optional) {
        this.report({
          severity: DiagnosticSeverity.Error,
          code: DiagnosticCode.MissingRequiredArgument,
          message: `Missing required argument${spec.name ? ` "${spec.name}"` : ""}.`,
          range: { start: this.previousEnd(), end: this.previousEnd() },
        });
        args.push({ kind: "required", children: [], raw: "", range: ZERO_RANGE });
      }
      // Absent optional arguments contribute nothing (they are always last).
    }
    return args;
  }

  private parseArg(spec: ArgSpec): ArgumentNode | null {
    this.skipInlineTrivia();
    const bracket = spec.delimiter === "bracket";
    const open = bracket ? TokenType.LBracket : TokenType.LBrace;
    const close = bracket ? TokenType.RBracket : TokenType.RBrace;
    if (!this.at(open)) return null;
    const openTok = this.advance();
    const kind = spec.optional ? "optional" : "required";

    if (spec.kind === "content") {
      const children = this.parseContent(() => this.at(close));
      const end = this.consumeClose(close, openTok, DiagnosticCode.UnterminatedArgument);
      return { kind, children, range: { start: openTok.range.start, end } };
    }

    const raw =
      spec.kind === "verbatim" ? this.readVerbatimUntil(close) : this.readRawUntil(close);
    const end = this.consumeClose(close, openTok, DiagnosticCode.UnterminatedArgument);
    return { kind, children: [], raw, range: { start: openTok.range.start, end } };
  }

  private parseGreedyArgs(): ArgumentNode[] {
    const args: ArgumentNode[] = [];
    for (;;) {
      this.skipInlineTrivia();
      if (!this.at(TokenType.LBrace)) break;
      const openTok = this.advance();
      const children = this.parseContent(() => this.at(TokenType.RBrace));
      const end = this.consumeClose(
        TokenType.RBrace,
        openTok,
        DiagnosticCode.UnterminatedArgument,
      );
      args.push({
        kind: "required",
        children,
        range: { start: openTok.range.start, end },
      });
    }
    return args;
  }

  /** Concatenate the raw source of tokens until the matching close at depth 0. */
  private readRawUntil(close: TokenType): string {
    let raw = "";
    let depth = 0;
    while (!this.at(TokenType.EOF)) {
      const t = this.peek();
      if (depth === 0 && t.type === close) break;
      if (t.type === TokenType.Command && t.value === "textbackslash") {
        // The one way to write a literal backslash, in a raw argument as elsewhere.
        raw += "\\";
        this.advance();
        if (this.at(TokenType.LBrace) && this.peek(1).type === TokenType.RBrace) {
          this.advance();
          this.advance();
        }
        continue;
      }
      if (t.type === TokenType.LBrace || t.type === TokenType.LBracket) {
        depth++;
      } else if (t.type === TokenType.RBrace || t.type === TokenType.RBracket) {
        if (depth === 0) break; // unbalanced close of the other kind ends the run
        depth--;
      }
      raw += t.type === TokenType.Command ? `\\${t.value}` : t.value;
      this.advance();
    }
    return raw;
  }

  /**
   * Like {@link readRawUntil}, but faithful to the source: escapes keep their
   * backslash, and only the argument's own delimiter nests. A half-open interval
   * such as `\math{[0, 1)}` must not be read as an unclosed bracket.
   */
  private readVerbatimUntil(close: TokenType): string {
    const open = close === TokenType.RBrace ? TokenType.LBrace : TokenType.LBracket;
    let raw = "";
    let depth = 0;
    while (!this.at(TokenType.EOF)) {
      const t = this.peek();
      if (t.type === close) {
        if (depth === 0) break;
        depth--;
      } else if (t.type === open) {
        depth++;
      }
      raw += t.raw ?? (t.type === TokenType.Command ? `\\${t.value}` : t.value);
      this.advance();
    }
    return raw;
  }

  /* -------------------------- environments ---------------------------- */

  private parseEnvironment(beginTok: Token): Node | Node[] {
    const name = this.readGroupName();
    const options: ArgumentNode[] = [];
    let opt: ArgumentNode | null;
    while (
      (opt = this.parseArg({ kind: "string", optional: true, delimiter: "bracket" }))
    ) {
      options.push(opt);
    }

    const def = this.registry.getEnvironment(name);
    if (!def) {
      const body = this.parseEnvBody(name);
      const range = { start: beginTok.range.start, end: this.previousEnd() };
      const suggestion = closestMatch(name, this.registry.environmentNames());
      this.report({
        severity: DiagnosticSeverity.Warning,
        code: DiagnosticCode.UnknownEnvironment,
        message: suggestion
          ? `Unknown environment "${name}". Did you mean "${suggestion}"?`
          : `Unknown environment "${name}".`,
        range,
      });
      return { type: "group", children: body, range };
    }

    let body: Node[];
    let entries: EnvEntry[] | undefined;
    if (def.itemCommand) {
      entries = this.parseEnvEntries(name, def.itemCommand);
      body = entries.flatMap((e) => e.content);
    } else {
      body = this.parseEnvBody(name);
    }

    const range: SourceRange = { start: beginTok.range.start, end: this.previousEnd() };
    this.currentRange = range;
    const node = def.build
      ? def.build({
          name,
          body,
          entries,
          options,
          report: (d) => this.report(d),
          utils: this.utils,
        })
      : null;

    if (node == null) {
      return { type: "group", children: body, range };
    }
    if (Array.isArray(node)) {
      for (const n of node) if (!n.range) n.range = range;
      return node;
    }
    if (!node.range) node.range = range;
    return node;
  }

  private parseEnvBody(name: string): Node[] {
    const body = this.parseContent(() => this.atCommand("end"));
    this.consumeEnd(name);
    return body;
  }

  private parseEnvEntries(name: string, itemCommand: string): EnvEntry[] {
    const entries: EnvEntry[] = [];
    const stop = () => this.atCommand(itemCommand) || this.atCommand("end");

    // Tolerate (and warn about) content before the first marker.
    this.skipTrivia();
    if (!stop() && !this.at(TokenType.EOF)) {
      const stray = this.parseContent(stop);
      if (stray.some((n) => n.type !== "text" || n.value.trim() !== "")) {
        this.report({
          severity: DiagnosticSeverity.Warning,
          code: DiagnosticCode.CommandOutsideContext,
          message: `Content before the first \\${itemCommand} in "${name}" was ignored.`,
          range: stray[0]?.range ?? this.currentRange,
        });
      }
    }

    while (this.atCommand(itemCommand)) {
      const markerTok = this.advance();
      const def = this.registry.getCommand(itemCommand);
      const margs = this.parseArgs(def?.args ?? []);
      const marker: CommandNode = {
        type: "command",
        name: itemCommand,
        args: margs,
        range: { start: markerTok.range.start, end: this.previousEnd() },
      };
      const content = this.parseContent(stop);
      entries.push({ marker, content });
    }

    this.consumeEnd(name);
    return entries;
  }

  private consumeEnd(name: string): void {
    if (!this.atCommand("end")) {
      this.report({
        severity: DiagnosticSeverity.Error,
        code: DiagnosticCode.MissingEnvironmentEnd,
        message: `Missing \\end{${name}}.`,
        range: { start: this.previousEnd(), end: this.previousEnd() },
      });
      return;
    }
    const endTok = this.advance(); // \end
    const got = this.readGroupName();
    if (got !== name) {
      this.report({
        severity: DiagnosticSeverity.Error,
        code: DiagnosticCode.MismatchedEnvironment,
        message: `Expected \\end{${name}} but found \\end{${got}}.`,
        range: { start: endTok.range.start, end: this.previousEnd() },
      });
    }
  }

  /** Read a `{name}` group's raw contents, reporting if it is missing. */
  private readGroupName(): string {
    this.skipInlineTrivia();
    if (!this.at(TokenType.LBrace)) {
      this.report({
        severity: DiagnosticSeverity.Error,
        code: DiagnosticCode.MissingRequiredArgument,
        message: "Expected '{name}'.",
        range: { start: this.previousEnd(), end: this.previousEnd() },
      });
      return "";
    }
    const open = this.advance();
    const raw = this.readRawUntil(TokenType.RBrace);
    this.consumeClose(TokenType.RBrace, open, DiagnosticCode.UnterminatedArgument);
    return raw.trim();
  }

  /** Like {@link readGroupName} but returns "" silently when absent. */
  private tryReadGroupRaw(): string {
    this.skipInlineTrivia();
    if (!this.at(TokenType.LBrace)) return "";
    const open = this.advance();
    const raw = this.readRawUntil(TokenType.RBrace);
    this.consumeClose(TokenType.RBrace, open, DiagnosticCode.UnterminatedArgument);
    return raw.trim();
  }

  /**
   * Recursion-limit fallback: consume the current scope's tokens flatly
   * (tracking nested braces) without descending, so adversarial deep nesting
   * cannot overflow the stack. Emits one diagnostic per parse.
   */
  private skipFlat(stop: () => boolean): Node[] {
    if (!this.reportedMaxDepth) {
      this.reportedMaxDepth = true;
      this.report({
        severity: DiagnosticSeverity.Warning,
        code: DiagnosticCode.UnexpectedToken,
        message: `Maximum nesting depth (${this.maxDepth}) exceeded; deeply nested content was skipped.`,
        range: this.peek().range,
      });
    }
    let bdepth = 0;
    while (!this.at(TokenType.EOF)) {
      if (bdepth === 0 && stop()) break;
      const t = this.peek();
      if (t.type === TokenType.LBrace || t.type === TokenType.LBracket) bdepth++;
      else if (t.type === TokenType.RBrace || t.type === TokenType.RBracket) {
        if (bdepth === 0) break;
        bdepth--;
      }
      this.advance();
    }
    return [];
  }

  /* ----------------------------- cursor ------------------------------- */

  private consumeClose(close: TokenType, open: Token, code: DiagnosticCode): Position {
    if (this.at(close)) {
      const end = this.peek().range.end;
      this.advance();
      return end;
    }
    this.report({
      severity: DiagnosticSeverity.Error,
      code,
      message: `Unterminated "${open.value}" — expected a matching close.`,
      range: open.range,
    });
    return this.previousEnd();
  }

  private at(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private atCommand(name: string): boolean {
    const t = this.peek();
    return t.type === TokenType.Command && t.value === name;
  }

  private skipInlineTrivia(): void {
    while (this.at(TokenType.Whitespace) || this.at(TokenType.Comment)) {
      this.advance();
    }
  }

  private skipTrivia(): void {
    while (
      this.at(TokenType.Whitespace) ||
      this.at(TokenType.Comment) ||
      this.at(TokenType.ParBreak)
    ) {
      this.advance();
    }
  }

  private peek(k = 0): Token {
    return this.tokens[this.pos + k] ?? this.tokens[this.tokens.length - 1]!;
  }

  private advance(): Token {
    const t = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }

  private previousEnd(): Position {
    return this.tokens[this.pos - 1]?.range.end ?? this.peek().range.start;
  }

  private report(d: Omit<Diagnostic, "source">): void {
    this.diagnostics.push({ ...d, source: "parser" });
  }
}

/** Convenience wrapper. */
export function parse(tokens: Token[], options?: ParserOptions): ParseResult {
  return Parser.parse(tokens, options);
}
