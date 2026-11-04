# ReTeX API Reference

The public API of ReTeX, grouped by area. Everything documented here is exported
from the package root (`retex`), except the React renderer which is *also*
available from the dedicated `retex/react` subpath.

```ts
import { ReTeXEngine /* … */ } from "retex";
import { renderReact } from "retex/react";
```

- [Markdown](#markdown)
- [Engine](#engine)
- [Pipeline functions](#pipeline-functions)
- [AST utilities](#ast-utilities)
- [Renderers](#renderers)
- [Theming](#theming)
- [Libraries](#libraries)
- [Plugins](#plugins)
- [Editor](#editor)
- [Incremental](#incremental)
- [Security](#security)
- [Icons](#icons)
- [Key interfaces](#key-interfaces)

> **ReTeX is blank by default.** The core ships structure + basic emphasis;
> color, fonts, and shapes come from **[libraries](#libraries)** you activate
> with `\usepackage{...}` in a document or `engine.use(...)` in code. The
> `library` exports are also available from the `retex/library` subpath.

---

## Markdown

Turn Markdown into a paper. See [the guide](MARKDOWN.md) for what each option does
and how a document's structure is inferred.

```ts
// Quick conversions.
function markdownToHtml(markdown: string, options?: PaperOptions): string;
function markdownToRetex(markdown: string, options?: PaperOptions): string;
function markdownToPdf(markdown: string, options?: PaperOptions & PdfOptions): Promise<Uint8Array>;

// The AST, for any renderer. `engine.fromMarkdown` also resolves its custom styles.
function parseMarkdown(markdown: string, options?: MarkdownOptions): MarkdownResult;

interface MarkdownOptions {
  style?: string;                     // default "normal"
  columns?: 1 | 2;
  pageSize?: "Letter" | "A4";
  fontSize?: "10pt" | "11pt" | "12pt";
  numbering?: boolean;
  title?: string;
  authors?: Array<string | FieldMap>;
  abstract?: string;                  // Markdown
  keywords?: string[];
  date?: string;
  stripChatter?: boolean;             // default true
  lookupStyle?: (name: string) => PartialTheme | undefined;
}

interface MarkdownResult {
  ast: DocumentNode;
  diagnostics: Diagnostic[];          // cleanup, blocked URLs, unsupported math, …
  style: string;                      // the style that was applied
}

interface PaperOptions extends MarkdownOptions {
  engine?: ReTeXEngine;               // for custom styles and plugins
  pageTitle?: string;                 // <title>; defaults to the paper's title
}

// Paper styles.
const paperThemes: Record<string, Theme>;
const paperLibraries: Record<string, ReTeXLibrary>;
const paperStyleSummaries: Record<string, string>;
const normalTheme, ieeeTheme, acmTheme, arxivTheme, lncsTheme, apaTheme, journalTheme: Theme;
function paperStyleNames(): string[];
function createPaperStyle(theme: Theme, summary?: string): ReTeXLibrary;
function applyPaperOptions(theme: Theme, options: string[]): Theme;  // \documentclass flags

// Math.
function texToMathML(tex: string, options?: { display?: boolean }): { mathml: string; errors: string[] };
function estimateMathWidth(mathml: string): number;  // in em
```

A theme becomes a paper style through its `paper` block:

```ts
interface ThemePaper {
  columns?: 1 | 2;
  columnGap?: string;
  variant?: string;                         // built-in look, and .retex-paper--<variant>
  numbering?: "none" | "decimal" | "ieee";
  abstractPlacement?: "front" | "column";
  abstractLabel?: string;
  keywordsLabel?: string;
  figureLabel?: string;
  tableLabel?: string;
  equationNumbers?: boolean;
  lineHeight?: string;
  textAlign?: "left" | "justify";
}
```

---

## Engine

The high-level entry point. Wires the pipeline, caching, theming, and plugins.

```ts
class ReTeXEngine implements PluginHost {
  constructor(options?: EngineOptions);

  // Compilation
  tokenize(source: string): TokenizeResult;
  compile(source: string, options?: CompileOptions): CompileResult;
  parse(source: string): DocumentNode;
  validate(input: string | DocumentNode): Diagnostic[];

  // Rendering
  toHtml(input: string | DocumentNode, options?: HtmlRenderOptions): string;
  toHtmlDocument(input: string | DocumentNode, options?: HtmlRenderOptions & { title?: string }): string;
  toReact(input: string | DocumentNode, options: Omit<ReactRenderOptions, "theme" | "classPrefix" | "overrides">): unknown;
  toJson(input: string | DocumentNode, options?: JsonRenderOptions): string;
  toPrintHtml(input: string | DocumentNode, options?: PrintOptions): string;
  toPdf(input: string | DocumentNode, options?: PdfOptions): Promise<Uint8Array>;
  styles(input?: string | DocumentNode): string;

  // Plugins, libraries & extension
  use(plugin: ReTeXPlugin): this;
  provideLibrary(library: ReTeXLibrary): this;
  registerCommand(def: EngineCommand): this;
  registerEnvironment(def: EnvironmentDefinition): this;
  registerHtmlRenderer(key: string, fn: HtmlRenderFn): this;
  registerReactRenderer(key: string, fn: ReactRenderFn): this;
  registerIcon(name: string, def: IconDefinition): this;

  // Theming & introspection
  setTheme(theme: Theme | PartialTheme): this;
  getTheme(): Theme;
  getRegistry(): CommandRegistry;
}

function createEngine(options?: EngineOptions): ReTeXEngine;
```

| Member                  | Description                                                                |
| ----------------------- | -------------------------------------------------------------------------- |
| `tokenize`              | Run only the lexer; returns tokens + lex diagnostics.                      |
| `compile`               | Tokenize → parse → (optionally) validate. **Cached** (LRU).               |
| `parse`                 | Parse to a `DocumentNode` without validation.                             |
| `validate`              | Diagnostics for a source string (full compile) or an existing AST.        |
| `fromMarkdown`          | Convert Markdown to a `DocumentNode`, resolving this engine's custom styles. |
| `toHtml`                | Render to an HTML fragment.                                               |
| `toHtmlDocument`        | Render to a complete standalone HTML page (includes `<style>`).          |
| `toReact`               | Render to a framework element tree; pass `createElement`/`Fragment`.      |
| `toJson`                | Render the AST to a JSON string.                                          |
| `toPrintHtml`           | Render print-ready, paginated standalone HTML.                           |
| `toPdf`                 | Render to a PDF byte buffer (needs Puppeteer or a `launch` adapter).      |
| `styles`                | The CSS stylesheet for the active theme. Pass the document to fold in libraries it `\usepackage`s. |
| `use`                   | Install a plugin/library globally (commands, envs, icons, renderers, theme, `setup`). |
| `provideLibrary`        | Make a library available to `\usepackage{name}` without activating it globally. Built-ins are always available. |
| `registerCommand`       | Add/override a command, optionally with inline `render` functions.        |
| `registerEnvironment`   | Add/override an environment.                                              |
| `registerHtmlRenderer`  | Add an HTML override keyed by node `type` or `command:<name>`.            |
| `registerReactRenderer` | Add a React override keyed by node `type` or `command:<name>`.            |
| `registerIcon`          | Add/override an icon.                                                     |
| `setTheme` / `getTheme` | Set / read the active theme. A **named** theme replaces; an anonymous patch is deep-merged over the current theme. |
| `getRegistry`           | Access the engine's `CommandRegistry`.                                   |

> Mutating the engine (`use`, `register*`, `setTheme`) invalidates the compile
> cache. `toHtml`/`toReact`/etc. accept either a source string or a parsed
> `DocumentNode`, so you can parse once and render to multiple targets.

---

## Pipeline functions

The four stages, exported standalone for fine-grained pipelines.

```ts
function tokenize(source: string): TokenizeResult;
class  Tokenizer { static tokenize(source: string): TokenizeResult; run(): TokenizeResult; }

function parse(tokens: Token[], options?: ParserOptions): ParseResult;
class  Parser  { static parse(tokens: Token[], options?: ParserOptions): ParseResult; parse(): ParseResult; }

function validate(ast: DocumentNode, options?: ValidateOptions): Diagnostic[];

// Registry & helpers
class  CommandRegistry { /* registerCommand, getCommand, allCommands, clone, … */ }
function createDefaultRegistry(): CommandRegistry;
function parseKeyValArg(raw: string): FieldMap;
function parseListArg(raw: string): string[];
function splitTopLevel(raw: string, sep?: string): string[];
function closestMatch(name: string, candidates: Iterable<string>): string | undefined;
function levenshtein(a: string, b: string): number;
```

| Function / class        | Description                                                            |
| ----------------------- | --------------------------------------------------------------------- |
| `tokenize` / `Tokenizer`| Lex source into `Token[]` (+ diagnostics). Never throws.              |
| `parse` / `Parser`      | Recursive-descent parse to `DocumentNode` (+ diagnostics).            |
| `validate`              | Semantic validation pass over an AST.                                 |
| `CommandRegistry`       | Map of command/environment definitions; drives parsing + plugins.    |
| `createDefaultRegistry` | A fresh registry preloaded with all built-ins.                       |
| `parseKeyValArg`        | Parse `key=value, …` into a `FieldMap` (unquoted-comma rule applies). |
| `parseListArg`          | Parse a comma list into trimmed, non-empty strings.                  |
| `splitTopLevel`         | Split on a separator, respecting `{…}`/`[…]` nesting.                |
| `closestMatch` / `levenshtein` | "Did you mean?" suggestion utilities.                         |

Related types: `TokenizeResult`, `ParseResult`, `ParserOptions`,
`ValidateOptions`.

---

## AST utilities

```ts
function walk(root: Node, opts: VisitOptions): void;
function collect(root: Node, pred: (n: Node) => boolean): Node[];
function childrenOf(node: Node): Node[];
function nodePathAt(root: Node, offset: number): Node[];
function flattenText(input: Node | Node[]): string;
function normalizeWhitespace(s: string): string;
```

| Function             | Description                                                               |
| -------------------- | ----------------------------------------------------------------------- |
| `walk`               | Depth-first traversal with `enter`/`exit` callbacks (`VisitOptions`).    |
| `collect`            | All nodes matching a predicate.                                         |
| `childrenOf`         | Children of a node wherever they live (`children`/`items`/`columns`).    |
| `nodePathAt`         | Innermost node at an offset plus its ancestors.                         |
| `flattenText`        | Best-effort plain-text extraction.                                      |
| `normalizeWhitespace`| Collapse whitespace runs and trim.                                     |

The AST node types themselves (`Node`, `DocumentNode`, `TextNode`, `MarkNode`,
`JobNode`, …), the `NodeMap`/`NodeType` types, and guards `isNode<T>` / `isParent`
are exported from `retex` (via `src/types`).

---

## Renderers

```ts
// HTML
class HtmlRenderer { constructor(options?: HtmlRenderOptions); render(ast): string; renderDocument(ast, title?): string; styles(): string; }
function renderHtml(ast: DocumentNode, options?: HtmlRenderOptions): string;
function renderHtmlDocument(ast: DocumentNode, options?: HtmlRenderOptions & { title?: string }): string;

// React (also via `retex/react`)
class ReactRenderer { constructor(options: ReactRenderOptions); render(ast): unknown; styles(): string; }
function renderReact(ast: DocumentNode, options: ReactRenderOptions): unknown;

// JSON
function renderJson(ast: DocumentNode, opts?: JsonRenderOptions): string;
function toJsonTree(ast: Node, opts?: JsonRenderOptions): unknown;

// PDF / print
function renderPrintHtml(ast: DocumentNode, options?: PrintOptions): string;
function renderPdf(ast: DocumentNode, options?: PdfOptions): Promise<Uint8Array>;
function pageCss(theme: Theme): string;
function themeToCss(theme: Theme, prefix?: string): string;

// Structuring helpers (shared by HTML & React renderers)
function toRegions(children: Node[]): Region[];
function splitPreamble(nodes: Node[]): PreambleParts;
function entryParts(fields: FieldMap, kind: string): EntryParts;
function dateRange(start?: string, end?: string, date?: string): string;
function isBlockNode(node: Node): boolean;
const   BLOCK_TYPES: Set<string>;
```

| Function / class      | Description                                                              |
| --------------------- | ---------------------------------------------------------------------- |
| `renderHtml`          | AST → HTML fragment.                                                   |
| `renderHtmlDocument`  | AST → complete standalone HTML page.                                   |
| `renderReact`         | AST → element tree (requires `createElement`).                         |
| `renderJson`          | AST → JSON string.                                                     |
| `toJsonTree`          | AST → plain object (optionally without `range`/`hash`).               |
| `renderPrintHtml`     | AST → paginated, print-ready standalone HTML.                          |
| `renderPdf`           | AST → PDF bytes via a headless browser.                                |
| `pageCss`             | The `@page` geometry CSS for a theme.                                  |
| `themeToCss`          | The full theme stylesheet (CSS custom properties).                    |
| `toRegions` / `splitPreamble` / `entryParts` / `dateRange` | Layout normalization helpers. |
| `isBlockNode` / `BLOCK_TYPES` | Whether a node breaks inline flow.                            |

Related types: `HtmlRenderOptions`, `JsonRenderOptions`, `PrintOptions`,
`PdfOptions`, `HeadlessBrowser`, `HeadlessPage`, `HtmlRenderFn`,
`HtmlRenderContext`, `Region`, `PreambleParts`, `EntryParts`; and for React:
`ReactRenderFn`, `ReactRenderContext`, `ReactRenderOptions`, `JsxFactory`.

> **PDF note.** `renderPdf` lazily imports `puppeteer` (optional). Supply
> `options.launch` to use Playwright/your own Chromium, or use `renderPrintHtml`
> and print to PDF in the browser.

---

## Theming

```ts
const blankTheme:   Theme;  // the default — no styling at all
const defaultTheme: Theme;  // alias of blankTheme
const modernTheme:  Theme;
const classicTheme: Theme;
const compactTheme: Theme;
const themes: Record<string, Theme>;

function resolveTheme(partial?: PartialTheme, base?: Theme): Theme;
function getTheme(name: string): Theme;
```

| Export         | Description                                                       |
| -------------- | ---------------------------------------------------------------- |
| `blankTheme`   | The **default**: no colors, fonts, sizes, or section decoration. |
| `defaultTheme` | Alias of `blankTheme`.                                            |
| `modernTheme`  | Accent-forward, underlined section headings (opt-in).            |
| `classicTheme` | Restrained serif theme for academic CVs (opt-in).               |
| `compactTheme` | High-density, single-accent theme (opt-in).                     |
| `themes`       | Map of presets keyed by name (`blank`, `default`, `modern`, …). |
| `resolveTheme` | Deep-merge a partial over a base (default: `blankTheme`); result always has defined sub-objects. |
| `getTheme`     | Look up a preset by name (falls back to the blank default).     |

Every `Theme` field is **optional** — the blank theme defines none of them, and
renderers substitute neutral, unstyled fallbacks. Importing a library or theme
pack fills the fields in.

Related types: `Theme`, `PartialTheme`, `ThemeColors`, `ThemeFonts`,
`ThemeFontSizes`, `ThemeSpacing`, `ThemePage`, `ThemeHeadings`.

---

## Libraries

Libraries are opt-in bundles of styling capability. Built-ins are always
available to `\usepackage`; you can also install them in code or register your
own.

```ts
// Built-in library objects (each is a ReTeXLibrary, i.e. a named ReTeXPlugin)
const colorsLibrary:  ReTeXLibrary;  // \textcolor, \themecolor
const fontsLibrary:   ReTeXLibrary;  // \fontfamily, \fontsize, \small…\Huge, \ttfamily
const shapesLibrary:  ReTeXLibrary;  // \hrule, \dashrule, …, \vspace, \hspace
const modernLibrary:  ReTeXLibrary;  // modern theme + the three toolkits
const classicLibrary: ReTeXLibrary;
const compactLibrary: ReTeXLibrary;

// Command lists & catalogs
const colorCommands: CommandDefinition[];
const fontCommands:  CommandDefinition[];
const shapeCommands: CommandDefinition[];
const palettes:   Record<string, ThemeColors>;  // named color palettes
const fontStacks: Record<string, string>;        // named CSS font stacks
function fontTheme(spec: Partial<Record<keyof ThemeFonts, string>>): ThemeFonts;

// Registry & resolution
const builtinLibraries: Record<string, ReTeXLibrary>;
function builtinLibraryNames(): string[];
function getBuiltinLibrary(name: string): ReTeXLibrary | undefined;
function resolveLibraryName(name: string): string | undefined;
const GATED_COMMANDS: Record<string, string>;     // command → library name

// Lower-level helpers (used by the engine/editor; exported for advanced use)
function usedLibraryNamesFromTokens(tokens: Token[]): string[];
function usedLibraryNamesFromAst(root: Node): string[];
function applyLibraries(base: CommandRegistry, names: string[], lookup?: LibraryLookup): AppliedLibraries;
function mergeLibraryTheme(base: Theme, libraries: ReTeXLibrary[]): Theme;
function collectLibraryOverrides(libraries: ReTeXLibrary[]): { html: Map<string, HtmlRenderFn>; react: Map<string, ReactRenderFn> };
function libraryDiagnostics(ast: DocumentNode, diagnostics: Diagnostic[], lookup?: LibraryLookup): Diagnostic[];
```

| Export                     | Description                                                          |
| -------------------------- | ------------------------------------------------------------------- |
| `colorsLibrary` / `fontsLibrary` / `shapesLibrary` | The three toolkits.                         |
| `modernLibrary` / `classicLibrary` / `compactLibrary` | Theme packs: a styled look **plus** all three toolkits. |
| `palettes` / `fontStacks`  | Catalogs of named color palettes / font stacks.                     |
| `fontTheme`                | Build a `fonts` theme patch from named stacks.                      |
| `builtinLibraries` / `getBuiltinLibrary` / `resolveLibraryName` | Look libraries up by name (aliases included). |
| `GATED_COMMANDS`           | Map of every library command → the library that provides it.        |
| `applyLibraries`           | Clone a registry and add the named libraries' commands (never mutates the base). |
| `mergeLibraryTheme`        | Fold libraries' theme patches over a base theme.                    |
| `libraryDiagnostics`       | Add "needs `\usepackage{...}`" / "unknown library" diagnostics.     |

A `ReTeXLibrary` is a `ReTeXPlugin` with a stable `name` (plus optional
`summary`). Install one globally with `engine.use(lib)`, make it available to
`\usepackage` with `engine.provideLibrary(lib)`, or pass either via
`EngineOptions`. The library exports are also published at the `retex/library`
subpath.

```ts
import { ReTeXEngine } from "retex";
import { colorsLibrary, palettes } from "retex/library";

const engine = new ReTeXEngine({
  plugins: [colorsLibrary],                 // \textcolor now always available
  theme: { colors: palettes.violet },       // and a violet palette
});
```

Related types: `ReTeXLibrary`, `LibraryLookup`, `AppliedLibraries`.

---

## Plugins

```ts
const badgePlugin:  ReTeXPlugin;  // \badge{New} — inline pill (HTML + React)
const ratingPlugin: ReTeXPlugin;  // \rating{4}  — 0–5 dots (HTML override)

interface ReTeXPlugin {
  name: string;
  commands?: EngineCommand[];
  environments?: EnvironmentDefinition[];
  icons?: Record<string, IconDefinition>;
  htmlRenderers?: Record<string, HtmlRenderFn>;   // keyed by `type` or `command:<name>`
  reactRenderers?: Record<string, ReactRenderFn>; // keyed by `type` or `command:<name>`
  theme?: PartialTheme;
  setup?: (engine: PluginHost) => void;
}

interface EngineCommand extends CommandDefinition {
  render?: { html?: HtmlRenderFn; react?: ReactRenderFn };
}

interface PluginHost {
  registerCommand(def: EngineCommand): PluginHost;
  registerEnvironment(def: EnvironmentDefinition): PluginHost;
  registerHtmlRenderer(key: string, fn: HtmlRenderFn): PluginHost;
  registerReactRenderer(key: string, fn: ReactRenderFn): PluginHost;
  registerIcon(name: string, def: IconDefinition): PluginHost;
}
```

Install via `new ReTeXEngine({ plugins: [...] })` or `engine.use(plugin)`. Every
field of a plugin is optional. An `EngineCommand` with an inline `render` map is
the simplest way to add a command without a custom AST node — `render.html` is
shorthand for an HTML override keyed `command:<name>`.

Command/environment authoring types (from `src/types/commands.ts`):
`CommandDefinition`, `EnvironmentDefinition`, `ArgSpec`, `ArgKind`,
`CommandCategory`, `NodeBuilder`, `BuildContext`, `BuilderUtils`, `EnvEntry`,
`EnvBuildContext`.

---

## Editor

```ts
class EditorService {
  constructor(options?: EditorServiceOptions);
  getCompletions(source: string, offset: number): CompletionItem[];
  getHover(source: string, offset: number): HoverInfo | null;
  getSemanticTokens(source: string): SemanticToken[];
  getDiagnostics(source: string): Diagnostic[];
  format(source: string): string;
  inspect(source: string): DocumentNode;
}

function printDocument(ast: DocumentNode): string;
```

| Member              | Description                                                              |
| ------------------- | ---------------------------------------------------------------------- |
| `getCompletions`    | Context-aware completions: commands, environments, entry field keys.   |
| `getHover`          | Markdown hover docs (signature, summary, example) for the symbol at the offset. |
| `getSemanticTokens` | Tokens for syntax highlighting, with category modifiers.               |
| `getDiagnostics`    | Lex + parse + validate diagnostics for the source.                     |
| `format`            | Re-print the source in canonical form.                                |
| `inspect`           | Parse to a `DocumentNode` for debugging.                              |
| `printDocument`     | Serialize an AST back to canonical ReTeX source (used by `format`).    |

All methods are pure and synchronous. The editor is **library-aware**: it reads
`\usepackage{...}` directives in the source so completions, hover, diagnostics,
and highlighting recognize the imported libraries' commands. Gated commands you
haven't imported still appear in completions (labelled with the library to
import). Pass custom libraries via `EditorServiceOptions.libraries`.

Related types: `EditorServiceOptions`, `CompletionItem`, `CompletionKind`,
`HoverInfo`, `SemanticToken`, `SemanticTokenType`.

---

## Two-way preview (source map)

Render with `{ sourceMap: true }` (see [`HtmlRenderOptions`](#htmlrenderoptions))
to stamp each element with `data-rtx-pos="start:end"` (zero-based UTF-16 source
offsets) and `data-rtx-type` (the originating node type). These editor-agnostic
helpers turn those attributes into Overleaf-style sync. They only require an
object with `getAttribute`, so they run anywhere — no `document` dependency.

```ts
const SOURCE_POS_ATTR: "data-rtx-pos";
const SOURCE_TYPE_ATTR: "data-rtx-type";

interface SourceSpan { start: number; end: number; }

function parseSourcePos(value: string | null | undefined): SourceSpan | null;
function readSourcePos(el: AttrElement | null | undefined): SourceSpan | null;
function readSourceType(el: AttrElement | null | undefined): string | null;
function closestSourcePos(el: ClosestElement | null | undefined): SourceSpan | null;
function pickElementForOffset<T extends AttrElement>(els: Iterable<T>, offset: number): T | null;
function spanContains(span: SourceSpan, offset: number): boolean;
function spanLength(span: SourceSpan): number;
```

| Function              | Direction        | Description                                                          |
| --------------------- | ---------------- | ------------------------------------------------------------------- |
| `closestSourcePos`    | preview → code   | Span of the nearest annotated ancestor of a clicked element.        |
| `pickElementForOffset`| code → preview   | The tightest (most specific) element whose span contains an offset. |
| `readSourcePos`       | —                | Parse one element's `data-rtx-pos` into a `SourceSpan`.             |
| `readSourceType`      | —                | Read one element's `data-rtx-type`.                                 |
| `parseSourcePos`      | —                | Parse a raw `"start:end"` string.                                   |
| `spanContains` / `spanLength` | —        | Span predicates used by the pickers.                                |

Related types: `SourceSpan`, `AttrElement`, `ClosestElement`. A runnable
end-to-end demo lives in `examples/playground.html` (`npm run playground`).

---

## Incremental

```ts
class IncrementalCompiler {
  constructor(options?: { registry?: CommandRegistry });
  compile(source: string): IncrementalResult;
  reset(): void;
}

function splitBalancedSegments(source: string): Segment[];
function isBalanced(text: string): boolean;
```

| Member                   | Description                                                          |
| ------------------------ | ------------------------------------------------------------------ |
| `IncrementalCompiler`    | Block-level, cache-backed compiler for live preview. Library-aware (scans the whole document for `\usepackage`). |
| `compile`                | Parse with per-block caching; returns `{ ast, diagnostics, stats }`. |
| `reset`                  | Clear the block cache.                                             |
| `splitBalancedSegments`  | Split source into brace/env-balanced blocks at blank lines.        |
| `isBalanced`             | Whether braces and `\begin`/`\end` are balanced in a string.       |

Related types: `IncrementalResult`, `IncrementalStats`.

---

## Security

```ts
function escapeHtml(input: string): string;
function escapeAttribute(input: string): string;
function sanitizeUrl(input: string): UrlSanitizeResult;
function isSafeColor(value: string): boolean;
function isSafeDimension(value: string): boolean;
function sanitizeStyleValue(value: string): string | undefined;
```

| Function             | Description                                                              |
| -------------------- | ---------------------------------------------------------------------- |
| `escapeHtml`         | Escape text content for HTML.                                          |
| `escapeAttribute`    | Escape a value for a double-quoted HTML attribute.                    |
| `sanitizeUrl`        | Vet a URL; returns `{ safe, blocked, scheme? }` (`"#"` if rejected).   |
| `isSafeColor`        | Validate a CSS color token.                                           |
| `isSafeDimension`    | Validate a CSS length/percentage.                                     |
| `sanitizeStyleValue` | Return a safe CSS value, or `undefined` to omit the declaration.      |

Related type: `UrlSanitizeResult`.

---

## Icons

```ts
function iconToSvg(name: string, opts?: { size?: number | string; className?: string }): string | null;
function getIcon(name: string): IconDefinition | undefined;
function hasIcon(name: string): boolean;
function registerIcon(name: string, def: IconDefinition): void;
function iconNames(): string[];
function resolveIconName(name: string): string | undefined;
```

| Function          | Description                                                       |
| ----------------- | --------------------------------------------------------------- |
| `iconToSvg`       | Render an icon to an inline SVG string (`null` if unknown).      |
| `getIcon`         | Look up an icon definition (resolving aliases).                 |
| `hasIcon`         | Whether an icon (or alias) is registered.                      |
| `registerIcon`    | Add/override an icon at runtime.                               |
| `iconNames`       | All canonical icon names (for completion/docs).               |
| `resolveIconName` | Resolve a possibly-aliased name to its canonical key.         |

Related type: `IconDefinition`. See [SYNTAX.md](SYNTAX.md#icons) for the built-in
icon set.

---

## Key interfaces

The main option and result objects, reproduced from the source for convenience.

### `EngineOptions`

```ts
interface EngineOptions {
  theme?: Theme | PartialTheme;
  plugins?: ReTeXPlugin[];
  /**
   * Libraries made available to `\usepackage{name}` **without** activating them
   * globally (unlike `plugins`, which install commands for every document).
   * Built-ins (`fonts`, `shapes`, `colors`, `modern`, …) are always available.
   */
  libraries?: ReTeXLibrary[];
  classPrefix?: string;
  /** Max number of compiled documents to cache. Default 64. */
  cacheSize?: number;
}
```

### `CompileResult` / `CompileOptions`

```ts
interface CompileResult {
  source: string;
  tokens: Token[];
  ast: DocumentNode;
  diagnostics: Diagnostic[];
}

interface CompileOptions {
  /** Run semantic validation in addition to parsing. Default `true`. */
  validate?: boolean;
}
```

### `HtmlRenderOptions`

```ts
interface HtmlRenderOptions {
  theme?: Theme;
  /** CSS class prefix. Default "retex". */
  classPrefix?: string;
  /** Plugin render overrides keyed by node `type` or `command:<name>`. */
  overrides?: Map<string, HtmlRenderFn>;
  /** Group leading contact commands into a <header>. Default true. */
  header?: boolean;
  /**
   * Emit `data-rtx-pos="start:end"` / `data-rtx-type` source-position
   * attributes for two-way live preview. Default false — exported HTML stays
   * clean. See [Two-way preview](#two-way-preview-source-map).
   */
  sourceMap?: boolean;
}
```

### `ReactRenderOptions`

```ts
interface ReactRenderOptions {
  /** JSX factory. Required. Pass React.createElement. */
  createElement: JsxFactory;
  /** Fragment component. Pass React.Fragment. Falls back to a <div>. */
  Fragment?: unknown;
  theme?: Theme;
  classPrefix?: string;
  overrides?: Map<string, ReactRenderFn>;
  header?: boolean;
}
```

### `Diagnostic`

```ts
enum DiagnosticSeverity { Error = "error", Warning = "warning", Info = "info", Hint = "hint" }

interface Diagnostic {
  severity: DiagnosticSeverity;
  code: DiagnosticCode;           // stable, e.g. "RTX2001" (unknown command)
  message: string;
  range: SourceRange;
  source: "tokenizer" | "parser" | "validator" | "security";
  fixes?: QuickFix[];             // optional editor quick-fixes
}
```

`DiagnosticCode` is an enum of stable string codes (`RTX1001`–`RTX5001`) editors
can key quick-fixes and doc links off. `QuickFix` is `{ title, replacement,
range? }`.

### `Theme`

Every field is optional — the blank default defines none of them.

```ts
interface Theme {
  name: string;
  colors?: ThemeColors;       // primary, secondary, text, muted, background, border, + custom tokens
  fonts?: ThemeFonts;         // heading, body, mono
  fontSizes?: ThemeFontSizes; // base, small, large, Large, Huge, name, section
  spacing?: ThemeSpacing;     // unit, section, item, page
  page?: ThemePage;           // size, margin, maxWidth
  sectionStyle?: "underline" | "rule" | "plain" | "bar";
  headings?: ThemeHeadings;   // transform, tracking, nameTracking (decorative)
}
```

`PartialTheme` mirrors `Theme` with `name` optional too; it is deep-merged over a
base by `resolveTheme`. A blank theme (all fields absent) renders a plain,
browser-default document; libraries and theme packs populate these fields.
