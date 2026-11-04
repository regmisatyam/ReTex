import type { ArgumentNode, CommandNode, Node } from "./ast.js";
import type { Diagnostic } from "./diagnostics.js";

/**
 * How a single argument should be consumed by the parser.
 *
 *  - `content`   — recursively parse markup (nested commands, text).
 *  - `string`    — verbatim text; no command expansion (URLs, colors, sizes).
 *  - `keyval`    — `key=value, key=value` map.
 *  - `list`      — comma-separated list of trimmed strings.
 *  - `verbatim`  — exact source text, escapes included; only braces nest (TeX, code).
 */
export type ArgKind = "content" | "string" | "keyval" | "list" | "verbatim";

export interface ArgSpec {
  kind: ArgKind;
  /** When true the argument may be absent (no diagnostic if missing). */
  optional?: boolean;
  /**
   * Delimiter pair. `"brace"` (default) → `{...}`; `"bracket"` → `[...]`.
   * An optional brace argument (e.g. an entry body) is still written with
   * `{...}` but may be omitted.
   */
  delimiter?: "brace" | "bracket";
  /** Consume this spec repeatedly, for as many `{...}` groups as follow. */
  variadic?: boolean;
  /** Human-readable name surfaced in hover docs / diagnostics. */
  name?: string;
  /** Validation hint for `string` args (drives format checks). */
  format?: "color" | "url" | "dimension" | "text";
}

/**
 * Semantic category of a command. Drives default rendering and where the
 * command is legal.
 *
 *  - `inline` — flows within text (`\textbf`).
 *  - `block`  — starts a block (`\section`, `\job`).
 *  - `switch` — a state switch that applies to the rest of its group
 *               (`\large`, `\bfseries`-style).
 *  - `meta`   — document metadata that produces no inline flow on its own.
 */
export type CommandCategory = "inline" | "block" | "switch" | "meta";

/**
 * A factory the parser calls once arguments are consumed, to build the AST
 * node for a command. Returning `null` drops the command from the tree.
 */
export type NodeBuilder = (ctx: BuildContext) => Node | Node[] | null;

export interface BuildContext {
  name: string;
  args: ArgumentNode[];
  /** For switches: the trailing content the switch applies to. */
  scope: Node[];
  /** Emit a diagnostic from within a builder. */
  report: (d: Omit<Diagnostic, "source">) => void;
  /** Utilities exposed to plugin authors. */
  utils: BuilderUtils;
}

export interface BuilderUtils {
  /** Flatten an argument's children into a plain string (best-effort). */
  textOf(arg: ArgumentNode | undefined): string;
  /** Sanitize a URL; returns `"#"` (and reports) when unsafe. */
  safeUrl(url: string): string;
}

/**
 * The contract for a command. Used by the parser (argument signature, scope
 * behavior) and the renderers (when no native node exists, renderers consult
 * the command's per-target `render` map).
 */
export interface CommandDefinition {
  name: string;
  category?: CommandCategory;
  /** Argument signature, in order. */
  args?: ArgSpec[];
  /**
   * `true` for switches that swallow the remainder of their enclosing group
   * as scoped content (`\large`, `\itshape`).
   */
  scoped?: boolean;
  /**
   * Builds the AST node. When omitted, the parser emits a generic
   * {@link CommandNode} carrying the parsed arguments.
   */
  build?: NodeBuilder;
  /** One-line summary for hover docs / completion detail. */
  summary?: string;
  /** Longer documentation (markdown) for hover. */
  documentation?: string;
  /** Example snippet shown in completion / hover. */
  example?: string;
}

/** Environment (`\begin{x} … \end{x}`) contract. */
export interface EnvironmentDefinition {
  name: string;
  /**
   * Command that introduces each entry inside the environment, e.g. `item`
   * for `itemize`, `column` for `columns`. The parser uses this to slice
   * the body into entries.
   */
  itemCommand?: string;
  /** Commands legal as direct children (for validation). `*` allows any. */
  allowedChildren?: string[];
  /** Build the environment node from its parsed body. */
  build?: (ctx: EnvBuildContext) => Node | Node[] | null;
  summary?: string;
  documentation?: string;
  example?: string;
}

/**
 * One entry of an `itemCommand`-delimited environment. For `itemize`, the
 * marker command is `\item`; for `columns`, it is `\column{width}`.
 */
export interface EnvEntry {
  /** The marker command that introduced the entry, with its parsed arguments. */
  marker: CommandNode;
  /** Content nodes belonging to this entry (up to the next marker / `\end`). */
  content: Node[];
}

export interface EnvBuildContext {
  name: string;
  /** Parsed body nodes of the environment (always present). */
  body: Node[];
  /**
   * When the environment declares an `itemCommand`, the body sliced into
   * entries at each marker. `undefined` for plain block environments.
   */
  entries?: EnvEntry[];
  /** Optional `[...]` arguments after `\begin{env}`. */
  options: ArgumentNode[];
  report: (d: Omit<Diagnostic, "source">) => void;
  utils: BuilderUtils;
}
