# ReTeX API Reference

The public API of ReTeX, grouped by area. Everything documented here is exported
from the package root (`retex`), except the React renderer which is *also*
available from the dedicated `retex/react` subpath.

```ts
import { ReTeXEngine /* … */ } from "retex";
import { renderReact } from "retex/react";
```

- [Engine](#engine)
- [Pipeline functions](#pipeline-functions)
- [AST utilities](#ast-utilities)
- [Renderers](#renderers)
- [Theming](#theming)
- [Plugins](#plugins)
- [Editor](#editor)
- [Incremental](#incremental)
- [Security](#security)
- [Icons](#icons)
- [Key interfaces](#key-interfaces)

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
  styles(): string;

  // Plugins & extension
  use(plugin: ReTeXPlugin): this;
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
| `toHtml`                | Render to an HTML fragment.                                               |
| `toHtmlDocument`        | Render to a complete standalone HTML page (includes `<style>`).          |
| `toReact`               | Render to a framework element tree; pass `createElement`/`Fragment`.      |
| `toJson`                | Render the AST to a JSON string.                                          |
| `toPrintHtml`           | Render print-ready, paginated standalone HTML.                           |
| `toPdf`                 | Render to a PDF byte buffer (needs Puppeteer or a `launch` adapter).      |
| `styles`                | The CSS stylesheet for the active theme.                                  |
| `use`                   | Install a plugin (commands, envs, icons, renderers, theme, `setup`).      |
| `registerCommand`       | Add/override a command, optionally with inline `render` functions.        |
| `registerEnvironment`   | Add/override an environment.                                              |
| `registerHtmlRenderer`  | Add an HTML override keyed by node `type` or `command:<name>`.            |
| `registerReactRenderer` | Add a React override keyed by node `type` or `command:<name>`.            |
| `registerIcon`          | Add/override an icon.                                                     |
| `setTheme` / `getTheme` | Replace (partials are deep-merged) / read the active theme.               |
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
const defaultTheme: Theme;
const modernTheme:  Theme;
const classicTheme: Theme;
const compactTheme: Theme;
const themes: Record<string, Theme>;

function resolveTheme(partial?: PartialTheme, base?: Theme): Theme;
function getTheme(name: string): Theme;
```

| Export         | Description                                                  |
| -------------- | ----------------------------------------------------------- |
| `defaultTheme` | The canonical base theme; all presets override it.         |
| `modernTheme`  | Accent-forward, underlined section headings.               |
| `classicTheme` | Restrained serif theme for academic CVs.                   |
| `compactTheme` | High-density, single-accent theme.                        |
| `themes`       | Map of presets keyed by name.                             |
| `resolveTheme` | Deep-merge a partial over a base (default: `defaultTheme`).|
| `getTheme`     | Look up a preset by name (falls back to default).         |

Related types: `Theme`, `PartialTheme`, `ThemeColors`, `ThemeFonts`,
`ThemeFontSizes`, `ThemeSpacing`, `ThemePage`.

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

All methods are pure and synchronous. Related types: `EditorServiceOptions`,
`CompletionItem`, `CompletionKind`, `HoverInfo`, `SemanticToken`,
`SemanticTokenType`.

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
| `IncrementalCompiler`    | Block-level, cache-backed compiler for live preview.               |
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

```ts
interface Theme {
  name: string;
  colors: ThemeColors;       // primary, secondary, text, muted, background, border, + custom tokens
  fonts: ThemeFonts;         // heading, body, mono
  fontSizes: ThemeFontSizes; // base, small, large, Large, Huge, name, section
  spacing: ThemeSpacing;     // unit, section, item, page
  page: ThemePage;           // size, margin, maxWidth
  sectionStyle: "underline" | "rule" | "plain" | "bar";
}
```

`PartialTheme` mirrors `Theme` with every field (and sub-field) optional; it is
deep-merged over a base by `resolveTheme`.
