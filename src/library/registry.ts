import {
  TokenType,
  DiagnosticSeverity,
  DiagnosticCode,
  type Token,
  type Node,
  type Theme,
  type Diagnostic,
  type DocumentNode,
  type CommandNode,
  type UsePackageNode,
} from "../types/index.js";
import { CommandRegistry } from "../parser/registry.js";
import { resolveTheme } from "../theme/themes.js";
import { collect } from "../ast/walk.js";
import type { HtmlRenderFn } from "../renderers/context.js";
import type { ReactRenderFn } from "../renderers/react.js";
import type { ReTeXLibrary } from "./types.js";
import { colorsLibrary } from "./colors.js";
import { fontsLibrary } from "./fonts.js";
import { shapesLibrary } from "./shapes.js";
import { modernLibrary, classicLibrary, compactLibrary, paperLibraries } from "./themes.js";

/** Built-in libraries, keyed by their canonical (lowercase) name. */
export const builtinLibraries: Record<string, ReTeXLibrary> = {
  colors: colorsLibrary,
  fonts: fontsLibrary,
  shapes: shapesLibrary,
  modern: modernLibrary,
  classic: classicLibrary,
  compact: compactLibrary,
  ...paperLibraries,
};

/** Convenience aliases (singular forms). */
const ALIASES: Record<string, string> = {
  color: "colors",
  font: "fonts",
  shape: "shapes",
  article: "normal",
  plain: "normal",
  springer: "lncs",
  neurips: "arxiv",
  preprint: "arxiv",
};

/** Resolve a (possibly aliased / differently-cased) library name. */
export function resolveLibraryName(name: string): string | undefined {
  const key = name.trim().toLowerCase();
  // Names come from the document, so `constructor` must not find an inherited key.
  if (Object.prototype.hasOwnProperty.call(builtinLibraries, key)) return key;
  if (Object.prototype.hasOwnProperty.call(ALIASES, key)) return ALIASES[key];
  return undefined;
}

/** Look up a built-in library by name (accepts aliases). */
export function getBuiltinLibrary(name: string): ReTeXLibrary | undefined {
  const key = resolveLibraryName(name);
  return key ? builtinLibraries[key] : undefined;
}

/** All built-in library names, for docs / completion. */
export function builtinLibraryNames(): string[] {
  return Object.keys(builtinLibraries);
}

/**
 * Map of every gated command name → the library that provides it. Powers the
 * "‹\textcolor› requires \usepackage{colors}" diagnostic. Derived from the
 * library command lists so it can never drift out of sync.
 */
export const GATED_COMMANDS: Record<string, string> = (() => {
  // No prototype: this is queried with command names straight from the document.
  const map = Object.create(null) as Record<string, string>;
  const add = (lib: ReTeXLibrary): void => {
    for (const c of lib.commands ?? []) map[c.name] = lib.name;
  };
  add(colorsLibrary);
  add(fontsLibrary);
  add(shapesLibrary);
  return map;
})();

/** A resolver from a library name to a library object. */
export type LibraryLookup = (name: string) => ReTeXLibrary | undefined;

const dedupe = (names: string[]): string[] => [...new Set(names)];

/**
 * Scan a token stream for `\usepackage{...}` / `\use{...}` directives and return
 * the requested library names (in source order, de-duplicated). Used to decide
 * which libraries to activate *before* parsing, since a directive must enable
 * the commands that follow it.
 */
export function usedLibraryNamesFromTokens(tokens: Token[]): string[] {
  const names: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (
      t.type !== TokenType.Command ||
      (t.value !== "usepackage" && t.value !== "use" && t.value !== "documentclass")
    ) {
      continue;
    }
    let j = i + 1;
    const skipTrivia = (): void => {
      while (
        tokens[j] &&
        (tokens[j]!.type === TokenType.Whitespace ||
          tokens[j]!.type === TokenType.Comment)
      ) {
        j++;
      }
    };
    skipTrivia();
    if (t.value === "documentclass" && tokens[j]?.type === TokenType.LBracket) {
      while (tokens[j] && tokens[j]!.type !== TokenType.RBracket) j++;
      j++;
      skipTrivia();
    }
    if (!tokens[j] || tokens[j]!.type !== TokenType.LBrace) continue;
    j++;
    let raw = "";
    let depth = 0;
    while (tokens[j] && !(depth === 0 && tokens[j]!.type === TokenType.RBrace)) {
      const tj = tokens[j]!;
      if (tj.type === TokenType.LBrace) depth++;
      else if (tj.type === TokenType.RBrace) depth--;
      raw += tj.type === TokenType.Command ? `\\${tj.value}` : tj.value;
      j++;
    }
    for (const part of raw.split(",")) {
      const name = part.trim();
      if (name) names.push(name);
    }
    i = j;
  }
  return dedupe(names);
}

/** Collect `\documentclass[...]` flags from a parsed document, in source order. */
export function usedDocumentOptions(root: Node): string[] {
  return collect(root, (n) => n.type === "usepackage").flatMap(
    (n) => (n as UsePackageNode).options ?? [],
  );
}

/** Collect library names from `\usepackage` nodes in a parsed document. */
export function usedLibraryNamesFromAst(root: Node): string[] {
  const names: string[] = [];
  for (const node of collect(root, (n) => n.type === "usepackage")) {
    for (const name of (node as UsePackageNode).names) {
      const trimmed = name.trim();
      if (trimmed) names.push(trimmed);
    }
  }
  return dedupe(names);
}

export interface AppliedLibraries {
  /** A clone of the base registry with the resolved libraries' commands added. */
  registry: CommandRegistry;
  /** The libraries that resolved successfully, in order. */
  libraries: ReTeXLibrary[];
  /** Requested names that did not resolve to any library. */
  missing: string[];
}

/**
 * Clone `base` and register the commands/environments of every requested
 * library that resolves via `lookup` (built-ins by default). Never mutates the
 * base registry.
 */
export function applyLibraries(
  base: CommandRegistry,
  names: string[],
  lookup: LibraryLookup = getBuiltinLibrary,
): AppliedLibraries {
  const registry = base.clone();
  const libraries: ReTeXLibrary[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const lib = lookup(name);
    if (!lib) {
      missing.push(name);
      continue;
    }
    libraries.push(lib);
    for (const cmd of lib.commands ?? []) registry.registerCommand(cmd);
    for (const env of lib.environments ?? []) registry.registerEnvironment(env);
  }
  return { registry, libraries, missing };
}

/** Fold each library's theme patch over a base theme, in order. */
export function mergeLibraryTheme(base: Theme, libraries: ReTeXLibrary[]): Theme {
  let theme = base;
  for (const lib of libraries) {
    if (lib.theme) theme = resolveTheme(lib.theme, theme);
  }
  return theme;
}

const ZERO_RANGE = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

/**
 * Refine a diagnostic list with library-awareness:
 *
 *  1. Replace the generic "unknown command" diagnostic for a *gated* command
 *     (one that lives in a library) with a clear "import the library" message.
 *  2. Flag unknown library names in `\usepackage{...}` directives.
 *
 * Shared by the engine and the editor so both give identical guidance.
 */
export function libraryDiagnostics(
  ast: DocumentNode,
  diagnostics: Diagnostic[],
  lookup: LibraryLookup = getBuiltinLibrary,
): Diagnostic[] {
  const gated = collect(
    ast,
    (n) => n.type === "command" && (n as CommandNode).name in GATED_COMMANDS,
  ) as CommandNode[];
  const gatedOffsets = new Set(
    gated.map((n) => n.range?.start.offset).filter((o): o is number => o != null),
  );
  const out = diagnostics.filter(
    (d) =>
      !(
        d.code === DiagnosticCode.UnknownCommand &&
        gatedOffsets.has(d.range.start.offset)
      ),
  );
  for (const node of gated) {
    const lib = GATED_COMMANDS[node.name]!;
    out.push({
      source: "parser",
      severity: DiagnosticSeverity.Warning,
      code: DiagnosticCode.LibraryRequired,
      message: `\\${node.name} requires the "${lib}" library. Add \\usepackage{${lib}} to the preamble (or engine.use(${lib}Library)).`,
      range: node.range ?? ZERO_RANGE,
    });
  }
  for (const node of collect(ast, (n) => n.type === "usepackage")) {
    for (const name of (node as UsePackageNode).names) {
      if (lookup(name)) continue;
      out.push({
        source: "parser",
        severity: DiagnosticSeverity.Warning,
        code: DiagnosticCode.UnknownLibrary,
        message: `Unknown library "${name}". Available: ${builtinLibraryNames().join(", ")}.`,
        range: node.range ?? ZERO_RANGE,
      });
    }
  }
  return out;
}

/** Collect HTML/React render overrides contributed by a set of libraries. */
export function collectLibraryOverrides(libraries: ReTeXLibrary[]): {
  html: Map<string, HtmlRenderFn>;
  react: Map<string, ReactRenderFn>;
} {
  const html = new Map<string, HtmlRenderFn>();
  const react = new Map<string, ReactRenderFn>();
  for (const lib of libraries) {
    for (const cmd of lib.commands ?? []) {
      if (cmd.render?.html) html.set(`command:${cmd.name}`, cmd.render.html);
      if (cmd.render?.react) react.set(`command:${cmd.name}`, cmd.render.react);
    }
    for (const [k, fn] of Object.entries(lib.htmlRenderers ?? {})) html.set(k, fn);
    for (const [k, fn] of Object.entries(lib.reactRenderers ?? {})) react.set(k, fn);
  }
  return { html, react };
}
