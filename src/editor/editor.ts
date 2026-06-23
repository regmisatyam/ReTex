import {
  TokenType,
  type Token,
  type SourceRange,
  type Diagnostic,
  type DocumentNode,
  type Theme,
  type CommandDefinition,
  type EnvironmentDefinition,
} from "../types/index.js";
import { tokenize } from "../tokenizer/index.js";
import { Parser } from "../parser/parser.js";
import { CommandRegistry } from "../parser/registry.js";
import { createDefaultRegistry } from "../parser/builtins.js";
import { validate } from "../validator/index.js";
import {
  applyLibraries,
  libraryDiagnostics,
  mergeLibraryTheme,
  usedLibraryNamesFromTokens,
  getBuiltinLibrary,
  GATED_COMMANDS,
  type ReTeXLibrary,
} from "../library/index.js";
import { printDocument } from "./printer.js";

export type CompletionKind = "command" | "environment" | "field" | "snippet";

export interface CompletionItem {
  label: string;
  kind: CompletionKind;
  detail?: string;
  documentation?: string;
  /** Plain text to insert. */
  insertText: string;
  /** LSP-style snippet with `${n:placeholder}` tab stops. */
  snippet?: string;
  /** Range the completion replaces (the partial token being typed). */
  range?: SourceRange;
}

export interface HoverInfo {
  /** Markdown documentation. */
  contents: string;
  range: SourceRange;
}

export type SemanticTokenType =
  | "command"
  | "command-unknown"
  | "environment"
  | "brace"
  | "bracket"
  | "text"
  | "comment"
  | "linebreak"
  | "argument";

export interface SemanticToken {
  range: SourceRange;
  type: SemanticTokenType;
  /** e.g. `["section"]`, `["typography"]`, derived from the command category. */
  modifiers: string[];
}

export interface EditorServiceOptions {
  registry?: CommandRegistry;
  theme?: Theme;
  /**
   * Custom libraries addressable via `\usepackage{name}`. Built-in libraries
   * (`fonts`, `shapes`, `colors`, `modern`, …) are always available.
   */
  libraries?: ReTeXLibrary[];
}

/**
 * Editor integration surface: everything a code editor (Monaco, CodeMirror, an
 * LSP server) needs to provide a great ReTeX authoring experience —
 * completion, hover docs, semantic highlighting, diagnostics, formatting, and
 * AST inspection. All methods are pure and synchronous.
 */
export class EditorService {
  private readonly registry: CommandRegistry;
  private readonly theme?: Theme;
  private readonly customLibraries = new Map<string, ReTeXLibrary>();

  constructor(options: EditorServiceOptions = {}) {
    this.registry = options.registry ?? createDefaultRegistry();
    this.theme = options.theme;
    for (const lib of options.libraries ?? []) {
      this.customLibraries.set(lib.name.trim().toLowerCase(), lib);
    }
  }

  private lookupLibrary = (name: string): ReTeXLibrary | undefined =>
    this.customLibraries.get(name.trim().toLowerCase()) ?? getBuiltinLibrary(name);

  /** Build a registry that includes the libraries the source imports. */
  private registryFor(tokens: Token[]): CommandRegistry {
    const names = usedLibraryNamesFromTokens(tokens);
    return applyLibraries(this.registry, names, this.lookupLibrary).registry;
  }

  /* ----------------------------- diagnostics -------------------------- */

  getDiagnostics(source: string): Diagnostic[] {
    const { tokens, diagnostics: lex } = tokenize(source);
    const names = usedLibraryNamesFromTokens(tokens);
    const { registry, libraries } = applyLibraries(this.registry, names, this.lookupLibrary);
    const { ast, diagnostics: parse } = new Parser(tokens, { registry }).parse();
    const diagnostics = libraryDiagnostics(ast, [...lex, ...parse], this.lookupLibrary);
    // Merge any imported libraries' theme so `\themecolor` tokens are validated
    // against the effective palette (mirrors what the engine does).
    const theme = this.theme ? mergeLibraryTheme(this.theme, libraries) : undefined;
    return [...diagnostics, ...validate(ast, theme ? { theme } : {})];
  }

  /* ------------------------------ inspect ----------------------------- */

  /** Parse and return the AST for inspection / debugging. */
  inspect(source: string): DocumentNode {
    const { tokens } = tokenize(source);
    return new Parser(tokens, { registry: this.registryFor(tokens) }).parse().ast;
  }

  /* ------------------------------ format ------------------------------ */

  format(source: string): string {
    return printDocument(this.inspect(source));
  }

  /* --------------------------- completion ----------------------------- */

  getCompletions(source: string, offset: number): CompletionItem[] {
    const before = source.slice(0, offset);
    const registry = this.registryFor(tokenize(source).tokens);

    const envMatch = /\\(begin|end)\{([a-zA-Z*]*)$/.exec(before);
    if (envMatch) {
      const prefix = envMatch[2]!;
      const start = offset - prefix.length;
      return registry
        .allEnvironments()
        .filter((e) => e.name.startsWith(prefix))
        .map((e) => this.environmentCompletion(e, this.rangeAt(source, start, offset)));
    }

    const fieldKeys = this.fieldContext(before);
    if (fieldKeys) {
      return fieldKeys.map((key) => ({
        label: key,
        kind: "field" as const,
        detail: "entry field",
        insertText: `${key}=`,
      }));
    }

    const cmdMatch = /\\([a-zA-Z*]*)$/.exec(before);
    if (cmdMatch) {
      const prefix = cmdMatch[1]!;
      const start = offset - prefix.length - 1; // include the backslash
      const range = this.rangeAt(source, start, offset);
      const active = registry
        .allCommands()
        .filter((c) => c.name.startsWith(prefix))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => this.commandCompletion(c, range));
      // Surface gated commands that aren't active yet, so they're discoverable.
      const present = new Set(registry.commandNames());
      const gated: CompletionItem[] = Object.entries(GATED_COMMANDS)
        .filter(([name]) => name.startsWith(prefix) && !present.has(name))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, lib]) => ({
          label: `\\${name}`,
          kind: "command" as const,
          detail: `requires \\usepackage{${lib}}`,
          documentation: `\`\\${name}\` is provided by the **${lib}** library. Add \`\\usepackage{${lib}}\` to your preamble to use it.`,
          insertText: name,
          range,
        }));
      return [...active, ...gated];
    }

    return [];
  }

  private commandCompletion(def: CommandDefinition, range: SourceRange): CompletionItem {
    const args = def.args ?? [];
    const snippetArgs = args
      .map((a, i) =>
        a.optional
          ? `[\${${i + 1}:${a.name ?? "opt"}}]`
          : `{\${${i + 1}:${a.name ?? "arg"}}}`,
      )
      .join("");
    const plainArgs = args.map((a) => (a.optional ? "[]" : "{}")).join("");
    return {
      label: `\\${def.name}`,
      kind: "command",
      detail: def.summary,
      documentation: this.commandDoc(def),
      insertText: `${def.name}${plainArgs}`,
      snippet: `${def.name}${snippetArgs}`,
      range,
    };
  }

  private environmentCompletion(
    def: EnvironmentDefinition,
    range: SourceRange,
  ): CompletionItem {
    return {
      label: def.name,
      kind: "environment",
      detail: def.summary,
      documentation: def.documentation ?? def.example,
      insertText: `${def.name}}`,
      snippet: `${def.name}}\n\t$0\n\\end{${def.name}}`,
      range,
    };
  }

  /** Suggest field keys when the cursor is inside a `\job/\education/\project{…}`. */
  private fieldContext(before: string): string[] | null {
    const m = /\\(job|education|project)\{([^{}]*)$/.exec(before);
    if (!m) return null;
    switch (m[1]) {
      case "job":
        return ["title", "company", "location", "start", "end", "url"];
      case "education":
        return ["school", "degree", "location", "start", "end", "gpa"];
      case "project":
        return ["name", "url", "start", "end", "tech"];
      default:
        return null;
    }
  }

  /* ------------------------------ hover ------------------------------- */

  getHover(source: string, offset: number): HoverInfo | null {
    const { tokens } = tokenize(source);
    const registry = this.registryFor(tokens);
    const idx = tokens.findIndex(
      (t) =>
        t.type === TokenType.Command &&
        offset >= t.range.start.offset &&
        offset <= t.range.end.offset,
    );
    if (idx === -1) return null;
    const token = tokens[idx]!;

    if (token.value === "begin" || token.value === "end") {
      const name = this.readNameAfter(tokens, idx);
      const env = name ? registry.getEnvironment(name) : undefined;
      if (env) {
        return {
          contents: this.environmentDoc(env),
          range: token.range,
        };
      }
      return null;
    }

    const def = registry.getCommand(token.value);
    if (!def) {
      const lib = GATED_COMMANDS[token.value];
      const contents = lib
        ? `\`\\${token.value}\` is provided by the **${lib}** library.\n\nAdd \`\\usepackage{${lib}}\` to your preamble to use it.`
        : `Unknown command \`\\${token.value}\``;
      return { contents, range: token.range };
    }
    return { contents: this.commandDoc(def), range: token.range };
  }

  private commandDoc(def: CommandDefinition): string {
    const sig =
      `\\${def.name}` +
      (def.args ?? [])
        .map((a) => (a.optional ? `[${a.name ?? "opt"}]` : `{${a.name ?? "arg"}}`))
        .join("");
    const lines = [`\`\`\`tex\n${sig}\n\`\`\``];
    if (def.summary) lines.push(def.summary);
    if (def.documentation) lines.push(def.documentation);
    if (def.example) lines.push(`**Example:**\n\`\`\`tex\n${def.example}\n\`\`\``);
    return lines.join("\n\n");
  }

  private environmentDoc(def: EnvironmentDefinition): string {
    const lines = [`\`\`\`tex\n\\begin{${def.name}} … \\end{${def.name}}\n\`\`\``];
    if (def.summary) lines.push(def.summary);
    if (def.example) lines.push(`**Example:**\n\`\`\`tex\n${def.example}\n\`\`\``);
    return lines.join("\n\n");
  }

  /* ------------------------ semantic highlighting --------------------- */

  getSemanticTokens(source: string): SemanticToken[] {
    const { tokens } = tokenize(source);
    const registry = this.registryFor(tokens);
    const out: SemanticToken[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      switch (t.type) {
        case TokenType.Command: {
          if (t.value === "begin" || t.value === "end") {
            out.push({ range: t.range, type: "environment", modifiers: [] });
            break;
          }
          const def = registry.getCommand(t.value);
          out.push({
            range: t.range,
            type: def ? "command" : "command-unknown",
            modifiers: def?.category ? [def.category] : [],
          });
          break;
        }
        case TokenType.LBrace:
        case TokenType.RBrace:
          out.push({ range: t.range, type: "brace", modifiers: [] });
          break;
        case TokenType.LBracket:
        case TokenType.RBracket:
          out.push({ range: t.range, type: "bracket", modifiers: [] });
          break;
        case TokenType.Comment:
          out.push({ range: t.range, type: "comment", modifiers: [] });
          break;
        case TokenType.LineBreak:
          out.push({ range: t.range, type: "linebreak", modifiers: [] });
          break;
        case TokenType.Text:
          out.push({ range: t.range, type: "text", modifiers: [] });
          break;
        default:
          break;
      }
    }
    return out;
  }

  /* ------------------------------ helpers ----------------------------- */

  private readNameAfter(tokens: Token[], idx: number): string | undefined {
    // Expect: Command(begin/end) [Whitespace] LBrace Text RBrace
    let j = idx + 1;
    while (tokens[j] && tokens[j]!.type === TokenType.Whitespace) j++;
    if (!tokens[j] || tokens[j]!.type !== TokenType.LBrace) return undefined;
    j++;
    let name = "";
    while (tokens[j] && tokens[j]!.type !== TokenType.RBrace) {
      name += tokens[j]!.value;
      j++;
    }
    return name.trim();
  }

  private rangeAt(source: string, start: number, end: number): SourceRange {
    return {
      start: this.positionAt(source, start),
      end: this.positionAt(source, end),
    };
  }

  private positionAt(
    source: string,
    offset: number,
  ): {
    offset: number;
    line: number;
    column: number;
  } {
    let line = 1;
    let column = 1;
    for (let i = 0; i < offset && i < source.length; i++) {
      if (source[i] === "\n") {
        line++;
        column = 1;
      } else {
        column++;
      }
    }
    return { offset, line, column };
  }
}
