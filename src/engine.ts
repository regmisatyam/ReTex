import {
  type DocumentNode,
  type Diagnostic,
  type Token,
  type Theme,
  type PartialTheme,
  type EnvironmentDefinition,
} from "./types/index.js";
import { tokenize, type TokenizeResult } from "./tokenizer/index.js";
import { Parser } from "./parser/parser.js";
import { CommandRegistry } from "./parser/registry.js";
import { createDefaultRegistry } from "./parser/builtins.js";
import { validate } from "./validator/index.js";
import { resolveTheme } from "./theme/themes.js";
import { defaultTheme } from "./theme/default.js";
import { registerIcon, type IconDefinition } from "./icons/icons.js";
import {
  applyLibraries,
  mergeLibraryTheme,
  collectLibraryOverrides,
  libraryDiagnostics,
  getBuiltinLibrary,
  usedLibraryNamesFromTokens,
  usedLibraryNamesFromAst,
  usedDocumentOptions,
  type ReTeXLibrary,
} from "./library/index.js";
import { applyPaperOptions } from "./theme/papers.js";
import {
  parseMarkdown,
  type MarkdownOptions,
  type MarkdownResult,
} from "./markdown/index.js";
import {
  HtmlRenderer,
  renderJson,
  renderPrintHtml,
  renderPdf,
  type HtmlRenderOptions,
  type JsonRenderOptions,
  type PrintOptions,
  type PdfOptions,
} from "./renderers/index.js";
import type { HtmlRenderFn } from "./renderers/context.js";
import {
  ReactRenderer,
  type ReactRenderFn,
  type ReactRenderOptions,
} from "./renderers/react.js";
import type { EngineCommand, ReTeXPlugin, PluginHost } from "./plugin/types.js";

export interface EngineOptions {
  theme?: Theme | PartialTheme;
  plugins?: ReTeXPlugin[];
  /**
   * Libraries to make available to `\usepackage` *without* activating them
   * globally. Built-in libraries (`fonts`, `shapes`, `colors`, `modern`, …) are
   * always available; use this to register your own.
   */
  libraries?: ReTeXLibrary[];
  classPrefix?: string;
  /** Max number of compiled documents to cache. Default 64. */
  cacheSize?: number;
}

export interface CompileResult {
  source: string;
  tokens: Token[];
  ast: DocumentNode;
  diagnostics: Diagnostic[];
}

export interface CompileOptions {
  /** Run semantic validation in addition to parsing. Default `true`. */
  validate?: boolean;
}

/** Per-document render inputs derived from the active engine + used libraries. */
interface RenderBundle {
  ast: DocumentNode;
  theme: Theme;
  htmlOverrides: Map<string, HtmlRenderFn>;
  reactOverrides: Map<string, ReactRenderFn>;
}

/** A theme is "full" (replaces) rather than a patch (merges) when it is named. */
const isFullTheme = (t: Theme | PartialTheme | undefined): t is Theme =>
  typeof t?.name === "string" && t.name.length > 0;

/**
 * The ReTeX engine: the single entry point that wires the tokenizer, parser,
 * validator, renderers, theming, libraries, plugins, and caching together.
 *
 * ReTeX is blank by default. Styling is opt-in via **libraries**, activated
 * either from the document (`\usepackage{colors}`) or from code
 * (`engine.use(colorsLibrary)`).
 *
 * ```ts
 * const engine = new ReTeXEngine();
 * engine.toHtml("\\usepackage{colors}\n\\textcolor{#7c3aed}{Hi}");
 * ```
 */
export class ReTeXEngine implements PluginHost {
  private registry: CommandRegistry;
  private theme: Theme;
  private readonly prefix: string;
  private readonly htmlOverrides = new Map<string, HtmlRenderFn>();
  private readonly reactOverrides = new Map<string, ReactRenderFn>();
  /** Libraries available to `\usepackage` (built-ins are resolved separately). */
  private readonly customLibraries = new Map<string, ReTeXLibrary>();
  private readonly cache = new Map<string, CompileResult>();
  private readonly cacheSize: number;
  private generation = 0;

  constructor(options: EngineOptions = {}) {
    this.registry = createDefaultRegistry();
    // Merge any provided theme over the blank default so sub-objects are defined.
    this.theme = resolveTheme(options.theme);
    this.prefix = options.classPrefix ?? "retex";
    this.cacheSize = options.cacheSize ?? 64;
    for (const lib of options.libraries ?? []) this.provideLibrary(lib);
    for (const plugin of options.plugins ?? []) this.use(plugin);
  }

  /* ----------------------------- plugins ------------------------------ */

  use(plugin: ReTeXPlugin): this {
    for (const cmd of plugin.commands ?? []) this.registerCommand(cmd);
    for (const env of plugin.environments ?? []) this.registerEnvironment(env);
    for (const [name, def] of Object.entries(plugin.icons ?? {})) {
      this.registerIcon(name, def);
    }
    for (const [key, fn] of Object.entries(plugin.htmlRenderers ?? {})) {
      this.registerHtmlRenderer(key, fn);
    }
    for (const [key, fn] of Object.entries(plugin.reactRenderers ?? {})) {
      this.registerReactRenderer(key, fn);
    }
    if (plugin.theme) this.setTheme(plugin.theme);
    // A named plugin is also addressable as a library via \usepackage{name}.
    if (plugin.name) this.customLibraries.set(plugin.name.trim().toLowerCase(), plugin);
    plugin.setup?.(this);
    this.invalidate();
    return this;
  }

  /**
   * Register a library so it can be activated with `\usepackage{name}`, without
   * installing it globally. Built-in libraries are always available; use this
   * for custom ones.
   */
  provideLibrary(library: ReTeXLibrary): this {
    this.customLibraries.set(library.name.trim().toLowerCase(), library);
    this.invalidate();
    return this;
  }

  registerCommand(def: EngineCommand): this {
    const { render, ...spec } = def;
    this.registry.registerCommand(spec);
    if (render?.html) this.htmlOverrides.set(`command:${def.name}`, render.html);
    if (render?.react) this.reactOverrides.set(`command:${def.name}`, render.react);
    this.invalidate();
    return this;
  }

  registerEnvironment(def: EnvironmentDefinition): this {
    this.registry.registerEnvironment(def);
    this.invalidate();
    return this;
  }

  registerHtmlRenderer(key: string, fn: HtmlRenderFn): this {
    this.htmlOverrides.set(key, fn);
    return this;
  }

  registerReactRenderer(key: string, fn: ReactRenderFn): this {
    this.reactOverrides.set(key, fn);
    return this;
  }

  registerIcon(name: string, def: IconDefinition): this {
    registerIcon(name, def);
    return this;
  }

  /* ----------------------------- theming ------------------------------ */

  setTheme(theme: Theme | PartialTheme): this {
    // A named theme replaces (merged over blank); an anonymous patch merges
    // over the current theme.
    this.theme = isFullTheme(theme)
      ? resolveTheme(theme, defaultTheme)
      : resolveTheme(theme, this.theme);
    this.invalidate();
    return this;
  }

  getTheme(): Theme {
    return this.theme;
  }

  getRegistry(): CommandRegistry {
    return this.registry;
  }

  /* --------------------------- compilation ---------------------------- */

  tokenize(source: string): TokenizeResult {
    return tokenize(source);
  }

  /** Tokenize, parse, and (by default) validate a source string. Cached. */
  compile(source: string, options: CompileOptions = {}): CompileResult {
    const runValidate = options.validate ?? true;
    const key = `${this.generation}:${runValidate ? "v" : "p"}:${source}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const { tokens, diagnostics: lexDiags } = tokenize(source);

    // Determine which libraries the document imports, then parse with a registry
    // that includes their commands (so `\usepackage{colors}` enables \textcolor).
    const usedNames = usedLibraryNamesFromTokens(tokens);
    const { registry, libraries } = applyLibraries(
      this.registry,
      usedNames,
      (n) => this.lookupLibrary(n),
    );

    const { ast, diagnostics: parseDiags } = new Parser(tokens, { registry }).parse();
    let diagnostics = libraryDiagnostics(ast, [...lexDiags, ...parseDiags], (n) =>
      this.lookupLibrary(n),
    );

    if (runValidate) {
      const theme = mergeLibraryTheme(this.theme, libraries);
      diagnostics.push(...validate(ast, { theme }));
    }

    const result: CompileResult = { source, tokens, ast, diagnostics };
    this.remember(key, result);
    return result;
  }

  parse(source: string): DocumentNode {
    return this.compile(source, { validate: false }).ast;
  }

  validate(input: string | DocumentNode): Diagnostic[] {
    if (typeof input === "string") return this.compile(input).diagnostics;
    return validate(input, { theme: this.bundle(input).theme });
  }

  /**
   * Convert Markdown to a ReTeX document in a paper style. The resulting AST goes
   * to any renderer on this engine, and custom styles registered with
   * {@link provideLibrary} can be chosen by name.
   *
   * ```ts
   * const { ast, diagnostics } = engine.fromMarkdown(answer, { style: "ieee" });
   * const html = engine.toHtmlDocument(ast);
   * ```
   */
  fromMarkdown(markdown: string, options: MarkdownOptions = {}): MarkdownResult {
    return parseMarkdown(markdown, {
      lookupStyle: (name) => this.lookupLibrary(name)?.theme,
      ...options,
    });
  }

  /* ----------------------------- renderers ---------------------------- */

  toHtml(input: string | DocumentNode, options: HtmlRenderOptions = {}): string {
    const b = this.bundle(input);
    return new HtmlRenderer({
      theme: b.theme,
      classPrefix: this.prefix,
      overrides: b.htmlOverrides,
      ...options,
    }).render(b.ast);
  }

  toHtmlDocument(
    input: string | DocumentNode,
    options: HtmlRenderOptions & { title?: string } = {},
  ): string {
    const b = this.bundle(input);
    return new HtmlRenderer({
      theme: b.theme,
      classPrefix: this.prefix,
      overrides: b.htmlOverrides,
      ...options,
    }).renderDocument(b.ast, options.title);
  }

  toReact(
    input: string | DocumentNode,
    options: Omit<ReactRenderOptions, "theme" | "classPrefix" | "overrides">,
  ): unknown {
    const b = this.bundle(input);
    return new ReactRenderer({
      ...options,
      theme: b.theme,
      classPrefix: this.prefix,
      overrides: b.reactOverrides,
    }).render(b.ast);
  }

  toJson(input: string | DocumentNode, options?: JsonRenderOptions): string {
    return renderJson(this.astOf(input), options);
  }

  toPrintHtml(input: string | DocumentNode, options: PrintOptions = {}): string {
    const b = this.bundle(input);
    return renderPrintHtml(b.ast, {
      theme: b.theme,
      classPrefix: this.prefix,
      overrides: b.htmlOverrides,
      ...options,
    });
  }

  toPdf(input: string | DocumentNode, options: PdfOptions = {}): Promise<Uint8Array> {
    const b = this.bundle(input);
    return renderPdf(b.ast, {
      theme: b.theme,
      classPrefix: this.prefix,
      overrides: b.htmlOverrides,
      ...options,
    });
  }

  /**
   * The CSS stylesheet for the active theme. Pass the document (source or AST)
   * to fold in any libraries it imports via `\usepackage` (so the styles match
   * `toHtml(input)`); omit it to get the engine theme's stylesheet.
   */
  styles(input?: string | DocumentNode): string {
    const theme = input === undefined ? this.theme : this.bundle(input).theme;
    return new HtmlRenderer({ theme, classPrefix: this.prefix }).styles();
  }

  /* ------------------------------ internals --------------------------- */

  /** Resolve a library name against custom libraries first, then built-ins. */
  private lookupLibrary(name: string): ReTeXLibrary | undefined {
    return this.customLibraries.get(name.trim().toLowerCase()) ?? getBuiltinLibrary(name);
  }

  private astOf(input: string | DocumentNode): DocumentNode {
    return typeof input === "string"
      ? this.compile(input, { validate: false }).ast
      : input;
  }

  /**
   * Build the per-document render inputs: the AST, the effective theme (engine
   * theme + any libraries the document imports), and the merged render
   * overrides. Library use is recovered from `\usepackage` nodes in the AST, so
   * this works whether the input was a source string or a pre-parsed document.
   */
  private bundle(input: string | DocumentNode): RenderBundle {
    const ast = this.astOf(input);
    const libraries = usedLibraryNamesFromAst(ast)
      .map((n) => this.lookupLibrary(n))
      .filter((l): l is ReTeXLibrary => !!l);
    if (libraries.length === 0) {
      return {
        ast,
        theme: this.theme,
        htmlOverrides: this.htmlOverrides,
        reactOverrides: this.reactOverrides,
      };
    }
    const { html, react } = collectLibraryOverrides(libraries);
    return {
      ast,
      theme: applyPaperOptions(
        mergeLibraryTheme(this.theme, libraries),
        usedDocumentOptions(ast),
      ),
      htmlOverrides: new Map([...this.htmlOverrides, ...html]),
      reactOverrides: new Map([...this.reactOverrides, ...react]),
    };
  }

  private invalidate(): void {
    this.generation++;
    this.cache.clear();
  }

  private remember(key: string, result: CompileResult): void {
    if (this.cache.size >= this.cacheSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, result);
  }
}

/** Create an engine with the default configuration. */
export function createEngine(options?: EngineOptions): ReTeXEngine {
  return new ReTeXEngine(options);
}
