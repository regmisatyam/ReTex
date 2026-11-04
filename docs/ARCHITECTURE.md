# ReTeX Architecture

This document explains how ReTeX works end to end: the compiler pipeline, the
AST, the registry that drives both parsing and plugins, the theming model, the
rendering layer, the incremental compiler, the security model, and the extension
points. It is aimed at contributors and at anyone integrating ReTeX deeply.

---

## Overview

ReTeX is a small but complete compiler. Source text flows through four pure
stages, each of which threads precise `SourceRange` provenance so diagnostics and
editor features map back to the exact bytes the author typed.

```
  ReTeX source (string)              Markdown (string)
        │                                  │
        ▼                                  │
  ┌───────────────┐                        │
  │  Tokenizer    │  src/tokenizer         │
  └───────────────┘                        │
        │                                  ▼
        ▼                          ┌───────────────┐
  ┌───────────────┐                │  Markdown     │  src/markdown
  │   Parser      │  src/parser    │  front end    │  → DocumentNode
  │  (recursive   │                └───────────────┘
  │   descent)    │                        │
  └───────────────┘                        │
        │                                  │
        ▼                                  ▼
  ┌──────────────────────────────────────────┐
  │  Validator                                │  src/validator  →  Diagnostic[]
  └──────────────────────────────────────────┘
        │
        ▼
  ┌──────────────────────────────────────────┐
  │  Renderers                                │  src/renderers  →  HTML / React / JSON / PDF
  └──────────────────────────────────────────┘
        │  printDocument (src/editor)
        ▼
  ReTeX source again
```

The `ReTeXEngine` (`src/engine.ts`) wires these together, adds an LRU compile
cache, owns the active theme and the per-instance command registry, and applies
plugins. Each subsystem is also exported standalone for fine-grained use.

**Blank core + libraries.** The core is intentionally minimal: document
structure and basic text emphasis only. Color, fonts, and shapes live in
opt-in **libraries** (`src/library/`) activated per-document with
`\usepackage{...}` or globally with `engine.use(...)`. Before parsing, the
engine scans for `\usepackage` directives, clones its base registry, and adds
the requested libraries' commands; before rendering, it folds those libraries'
theme patches into the effective theme. See [The library layer](#the-library-layer).

**One document model.** Markdown is a second *front end*, not a second pipeline. It
produces the same `DocumentNode` as the parser, so every renderer, the validator, and
the printer work on it unchanged, and a converted document can be saved as `.retex`.
See [The Markdown front end](#the-markdown-front-end).

---

## Stage 1 — Tokenizer

**Location:** `src/tokenizer/tokenizer.ts`. **Entry point:** `tokenize(source)`
→ `{ tokens, diagnostics }`.

The tokenizer is a hand-written, single-pass lexer. It is *deliberately
permissive* — it never throws — so all error handling happens downstream in the
parser, which can recover gracefully.

Key design choices (all résumé-driven):

- **`%` is literal.** A lone `%` is text, so `40%` and `\column{40%}` work
  verbatim. Comments are `%%`-to-end-of-line.
- **Escapes** (`\%`, `\&`, `\{`, `\}`, `\_`, `\$`, `\#`, `\ `) become literal
  text tokens.
- **`\\`** is an explicit line break.
- **Whitespace folding.** A run of whitespace containing two or more newlines
  becomes a single `ParBreak`; otherwise it is `Whitespace`.
- **Newline normalization.** `\r\n`/`\r` are normalized to `\n` up front so
  position math is platform-independent.

Token kinds (`src/types/tokens.ts`): `Command`, `LBrace`, `RBrace`, `LBracket`,
`RBracket`, `Text`, `Whitespace`, `ParBreak`, `LineBreak`, `Comment`, `EOF`.
Every token carries its exact `SourceRange` (offset/line/column).

---

## Stage 2 — Parser

**Location:** `src/parser/parser.ts`. **Entry point:** `parse(tokens, options)`
→ `{ ast, diagnostics }`.

A recursive-descent parser that turns the token stream into a `DocumentNode`. It
has four notable responsibilities:

### Registry-driven parsing

The parser does not hard-code command behavior. For each `Command` token it looks
up a `CommandDefinition` in the **`CommandRegistry`** to learn:

- the **argument signature** (`ArgSpec[]`) — how many arguments and of which kind
  (`content`, `string`, `keyval`, `list`), with optional `bracket` delimiters;
- whether the command is a **scoped switch**;
- the **`build`** function that constructs the AST node from the parsed
  arguments.

This is the same registry that plugins extend, which is why a plugin command is a
first-class citizen of parsing (see [The command registry](#the-command-registry)).

### Argument consumption

`ArgSpec.kind` controls how an argument is read:

- `content` — recursively parsed as markup (nested commands + text), yielding
  `ArgumentNode.children`.
- `string` — read **verbatim** (no command expansion), yielding
  `ArgumentNode.raw`. Used for URLs, colors, sizes, and key=value/list bodies.
- `keyval` / `list` — read verbatim like `string`; the builder then parses the
  raw text with `parseKeyValArg` / `parseListArg`.

### Error recovery

The parser never throws and always returns a tree:

- **Unknown commands** are kept as a generic `CommandNode` (greedily absorbing
  any `{…}` arguments) and reported with a "did you mean?" suggestion computed by
  Levenshtein distance (`src/parser/suggest.ts`), including an editor quick-fix.
- **Unknown environments** degrade to a `GroupNode` wrapping their parsed body.
- **Unterminated groups/arguments**, **mismatched braces**, and **mismatched /
  missing `\end`** are each reported with a specific `DiagnosticCode`, while
  parsing continues.

### Scoped switches and environments

- **Scoped switches** (`\large`, `\bfseries`, …) consume the *remainder of the
  current content scope* as their children, then the loop breaks — mirroring
  LaTeX declaration semantics. Wrapping a switch in `{ … }` bounds it.
- **Environments** (`\begin{x} … \end{x}`) are dispatched via
  `EnvironmentDefinition`. When the definition declares an `itemCommand`
  (e.g. `item` for `itemize`, `column` for `columns`), the body is sliced into
  `EnvEntry[]` at each marker before the builder runs; otherwise the whole body
  is passed through. Optional `[…]` arguments after `\begin{x}` are collected as
  `options`.

---

## Stage 3 — Validator

**Location:** `src/validator/validator.ts`. **Entry point:** `validate(ast, { theme? })`
→ `Diagnostic[]`.

A pure, side-effect-free semantic pass over the AST (via the `walk` traversal).
It complements the parser's *syntactic* diagnostics with *semantic* ones:

- empty `\section` headings and empty contact fields;
- stray `\item` / `\column` that survived as raw command nodes (i.e. used outside
  their environment) — these are errors;
- `\themecolor{token}` referencing a token not present in the supplied theme
  (only checked when the theme actually defines colors — a blank theme skips it);
- empty `\skills`.

Library-related diagnostics (a gated command used without its `\usepackage`, or
an unknown library name) are added separately by `libraryDiagnostics`
(`src/library/registry.ts`), which the engine, editor, and incremental compiler
all share.

Validation is optional: `engine.compile(source, { validate: false })` (and
`engine.parse`) skip it.

---

## Stage 4 — Renderers

**Location:** `src/renderers/`. Four targets share the same logical structuring
so they produce identical layouts.

| Target | Module          | Entry points                                           | Output        |
| ------ | --------------- | ------------------------------------------------------ | ------------- |
| HTML   | `html.ts`       | `renderHtml`, `renderHtmlDocument`, `HtmlRenderer`     | `string`      |
| React  | `react.ts`      | `renderReact`, `ReactRenderer`                         | element tree  |
| JSON   | `json.ts`       | `renderJson`, `toJsonTree`                             | `string`      |
| PDF    | `pdf.ts`        | `renderPrintHtml`, `renderPdf`, `pageCss`              | `string` / `Uint8Array` |

### Shared structuring helpers

`src/renderers/structure.ts` and `src/renderers/context.ts` contain the layout
logic both the HTML and React renderers reuse, so the two never drift:

- **`toRegions(children)`** — split a document into regions delimited by
  level-1 `\section`s (a leading region holds the preamble).
- **`splitPreamble(nodes)`** — separate the header pieces (`name`, `title`, and
  "contactish" nodes: `contact`, `icon`, `link`, `url`) from the rest.
- **`entryParts(fields, kind)`** / **`dateRange(...)`** — normalize a job/
  education/project field map into a renderable `{ title, subtitle, dates,
  location, url }`.
- **`isBlockNode(node)`** / **`BLOCK_TYPES`** — decide whether a node breaks the
  inline flow. The renderers' `renderFlow` groups consecutive inline nodes into
  `<p>` paragraphs and emits block nodes between them.

### HTML renderer

Produces clean, semantic, fully-escaped HTML. Class names are prefixed
(default `retex`) and the matching stylesheet comes from `themeToCss`
(`src/renderers/css.ts`), which emits theme values as CSS custom properties.
`renderDocument` wraps the fragment in a complete `<!DOCTYPE html>` page with an
inline `<style>`. Every text node and attribute is escaped, and every URL is
re-sanitized at render time as defense in depth.

#### Source mapping for two-way preview

The `SourceRange` provenance threaded from the tokenizer all the way to the AST
pays off here: with `{ sourceMap: true }`, the HTML renderer stamps each
structural and inline element with `data-rtx-pos="start:end"` (the node's
zero-based UTF-16 source offsets) and `data-rtx-type`. A live editor reads those
to map a preview click back to the source (`closestSourcePos`) and a caret
offset forward to the tightest matching element (`pickElementForOffset`) — the
helpers live in `src/editor/sync.ts` and are pure/DOM-free. The flag defaults to
off so exported HTML is unannotated; the only renderer changes are appended
attributes, never restructured markup. (List items and columns gain their own
ranges in `builtins.ts` so individual entries are addressable, not just the
enclosing environment.)

### React renderer

Mirrors the HTML renderer's structure and class names — so the same theme
stylesheet applies — but emits an element tree. It is **dependency-free**: the
caller supplies the JSX factory (`createElement`) and `Fragment`, so it works
with React, Preact, or any compatible runtime. Icons are injected via the
runtime's `dangerouslySetInnerHTML` escape hatch.

### JSON renderer

A deep clone of the AST, optionally stripping `range`/`hash` metadata
(`stripMeta`) for compact, stable, diff-friendly payloads.

### PDF / print

`renderPrintHtml` produces a standalone, paginated HTML document (theme styles +
`@page` geometry from `pageCss`). That HTML is the portable core of the PDF
strategy and can be printed in the browser (`window.print()`), handed to any
HTML-to-PDF service, or converted headlessly by `renderPdf`, which lazily imports
`puppeteer` (an *optional* dependency) or accepts an injected `launch` adapter
for Playwright/pooled/remote Chromium.

---

## The AST

**Location:** `src/types/ast.ts`. The AST is a discriminated union (`Node`) keyed
on `type`. Unknown and plugin-provided commands are preserved as generic
`CommandNode`s, so the tree is always a loss-less, re-renderable representation
of the source.

| Family            | Node types                                                                 |
| ----------------- | ------------------------------------------------------------------------- |
| **Structural**    | `document`, `text`, `parbreak`, `linebreak`, `rule`, `space`, `group`, `usepackage` |
| **Typography**    | `bold`, `italic`, `underline`, `strike` (`MarkNode`), `color`, `themecolor`, `fontsize`, `fontfamily`, `fontscale` |
| **Links & icons** | `link`, `url`, `icon`                                                      |
| **Sections/lists**| `section`, `list`, `item`                                                  |
| **Layout**        | `columns`, `column`                                                        |
| **Résumé**        | `contact`, `job`, `education`, `project`, `skills`                         |
| **Generic**       | `command` (with `ArgumentNode[]`), `error`                                |

Every node extends `NodeBase` with an optional `range` (source span) and an
optional lazily-populated `hash` (used by the incremental/render caches). Helper
predicates `isParent`, `isNode<T>` and the `NodeMap` type enable typed visitors.

> The styling node types (`color`, `themecolor`, `fontsize`, `fontfamily`,
> `fontscale`, `rule`, `space`) and their renderer handlers stay in the core —
> only the **commands** that produce them moved into libraries. So gating a
> command never touches the rendering path: the node simply isn't produced
> unless its library is active. `rule` carries an optional `style`
> (`dashed`/`dotted`/`thick`/`double`) for the shapes library's variants;
> `usepackage` is a preamble directive that renders to nothing.

### AST utilities

- `walk(root, { enter, exit })` — depth-first traversal; `childrenOf(node)`
  resolves children wherever they live (`children`, `items`, or `columns`).
- `collect(root, pred)` — gather all nodes matching a predicate.
- `nodePathAt(root, offset)` — innermost node containing an offset, plus
  ancestors (for editor features).
- `flattenText(node | nodes)` / `normalizeWhitespace(s)` — best-effort plain-text
  extraction (titles, labels, key=value parsing).

---

## The command registry

**Location:** `src/parser/registry.ts` (the `CommandRegistry` class) and
`src/parser/builtins.ts` (`createDefaultRegistry`, the source of truth for all
built-ins).

The registry is the architectural keystone: a single map of command and
environment definitions that **drives both parsing and extensibility**.

- The **parser** reads it for argument signatures, scope behavior, and node
  builders.
- The **plugin/library system** mutates it to add commands/environments.
- It is **per-engine**: `createDefaultRegistry()` builds a fresh registry for
  each `ReTeXEngine`, and `clone()` copies the maps — so plugins extend a private
  copy and never touch global state.

`createDefaultRegistry()` now holds only the **blank core**: structure, basic
emphasis (`\textbf`/`\textit`/`\underline`/`\sout`/`\bfseries`/`\itshape`),
links, sections, contact, entries, icons, the list/column/center environments,
and the `\usepackage`/`\use` directive. Library commands are layered on per
compile via `applyLibraries(base, names, lookup)`, which **clones** the base and
registers the resolved libraries' commands — the base is never mutated, so two
documents compiled by the same engine with different `\usepackage` sets stay
isolated.

A `CommandDefinition` (`src/types/commands.ts`) carries: `name`, `category`
(`inline` / `block` / `switch` / `meta`), `args` (`ArgSpec[]`), `scoped`,
`build` (a `NodeBuilder`), and documentation fields (`summary`, `documentation`,
`example`) used by editor tooling. An `EnvironmentDefinition` adds `itemCommand`,
`allowedChildren`, and an environment `build`.

Builders receive a `BuildContext` with the parsed `args`, the switch `scope`, a
`report` callback for diagnostics, and `utils` (`textOf`, `safeUrl`). Returning
`null` drops the command; returning a node or array of nodes inserts them.

---

## Theming model

**Location:** `src/types/theme.ts`, `src/theme/`.

Themes are **plain data** (no functions), so they serialize, ship over the wire,
and compose at runtime. A `Theme` has `name` plus the **all-optional** groups
`colors`, `fonts`, `fontSizes`, `spacing`, `page`, the `sectionStyle` hint
(`underline` | `rule` | `plain` | `bar`), and `headings` (decorative
transform/tracking). The `colors` map is open-ended — arbitrary named swatches
are addressable via `\themecolor{name}`.

- **Blank by default.** `blankTheme` (exported as `defaultTheme`) defines *none*
  of these fields — a document rendered with it is a plain, browser-default page.
- `resolveTheme(partial, base?)` deep-merges a `PartialTheme` over a base
  (default `blankTheme`) and always returns defined sub-objects, so consumers can
  read `theme.colors` etc. safely.
- Opt-in presets: `modernTheme`, `classicTheme`, `compactTheme`; plus the
  `themes` map and `getTheme(name)` lookup (`blank`/`default` map to the blank one).
- `themeToCss(theme, prefix)` emits the stylesheet. **Structure** (flex rows,
  list indents, spacing rhythm) is always emitted; **decoration** (accent colors,
  fonts, uppercased headings, skill chips, section rules) is driven by CSS custom
  properties whose fallbacks are neutral — so a blank theme renders cleanly and a
  library/theme simply fills the variables in. Every color is also exposed as
  `--<prefix>-color-<token>`.

The engine accepts either a full `Theme` or a `PartialTheme` in its options or
via `setTheme`. A **named** theme replaces (merged over blank); an anonymous
patch is merged over the current theme.

---

## The library layer

**Location:** `src/library/`.

Libraries are the opt-in styling layer over the blank core. A `ReTeXLibrary`
(`src/library/types.ts`) is simply a `ReTeXPlugin` with a stable `name`, so it
can contribute commands, environments, icons, render overrides, and a theme
patch.

- **Built-ins** (`src/library/registry.ts`): `colors`, `fonts`, `shapes`, and
  the theme packs `modern`/`classic`/`compact` (which bundle a theme **plus** the
  three toolkits). `color`/`font`/`shape` are singular aliases.
- **Activation** is two-way: a `\usepackage{...}` directive in the source, or
  `engine.use(lib)` (global) / `engine.provideLibrary(lib)` (available to
  `\usepackage` only) / `EngineOptions.libraries` in code.
- **Resolution flow** (in `engine.compile`):
  1. `usedLibraryNamesFromTokens(tokens)` scans the token stream for
     `\usepackage`/`\use` directives.
  2. `applyLibraries(this.registry, names, lookup)` clones the base registry and
     adds the resolved libraries' commands; unknown names are flagged.
  3. The parser runs against that per-compile registry, so commands that follow a
     directive parse correctly.
  4. `libraryDiagnostics(ast, …)` rewrites the generic "unknown command"
     diagnostic for a gated command into "add `\usepackage{<lib>}`", and flags
     unknown library names.
- **Rendering** (`engine.bundle`): `usedLibraryNamesFromAst(ast)` recovers the
  used libraries from the `\usepackage` nodes (so it works for a pre-parsed
  `DocumentNode` too), `mergeLibraryTheme` folds their theme patches over the
  engine theme, and `collectLibraryOverrides` merges any render overrides.

Because gated commands produce **core** node types, the renderers need no
changes to support libraries — the per-document override merging exists only for
*custom* libraries that ship their own render functions.

---

## Incremental compilation

**Location:** `src/incremental/incremental.ts`.

`IncrementalCompiler` is a block-level fast path optimized for live editing. It
splits the document into **balanced segments** at blank-line boundaries —
merging neighbors until braces and `\begin`/`\end` are balanced
(`splitBalancedSegments`, `isBalanced`) — and caches each segment's parse keyed
by its **exact text**.

On each `compile`, unchanged blocks are served from the cache and re-positioned
with a cheap range shift (`shiftClone`), so only edited blocks are re-tokenized
and re-parsed. The produced AST is equivalent to a full parse (top-level blocks
separated by `parbreak`), making it a drop-in for preview. `compile` returns
`stats: { segments, cacheHits, cacheMisses }`; `reset()` clears the cache (e.g.
after registering new commands).

The engine itself also keeps an **LRU compile cache** (`cacheSize`, default 64),
keyed by source + validation mode + a generation counter that is bumped whenever
the registry or theme changes, invalidating stale entries.

---

## Security model

**Location:** `src/security/sanitize.ts`. ReTeX renders untrusted markup, so
safety is layered:

- **HTML escaping** — `escapeHtml` / `escapeAttribute` escape every text node and
  attribute value (ampersand first, then `<`, `>`, `"`, `'`).
- **URL sanitization** — `sanitizeUrl` strips ASCII control characters (a classic
  `java\tscript:` bypass), then allow-lists `http`, `https`, `mailto`, `tel`,
  `ftp`, `sms`. Everything else (`javascript:`, `data:`, `vbscript:`, `file:`, …)
  is blocked and replaced with `#`. URLs are vetted at parse time **and** again at
  render time.
- **CSS value vetting** — `isSafeColor` and `isSafeDimension` validate colors and
  lengths before they reach a `style` attribute; `sanitizeStyleValue` rejects
  values containing `<>;{}`, `expression(...)`, `url(...)`, or `javascript:`.
- **No code execution** — there is no `eval`, no `Function`, and no
  template-string interpolation of user input into executable contexts.

---

## The Markdown front end

`src/markdown` converts Markdown to a `DocumentNode` in three steps:

1. **Blocks** (`blocks.ts`) finds structure line by line: headings, lists, tables, code,
   math, quotes. Containers recurse on their stripped lines, with a depth limit so that
   `>>>>…` cannot exhaust the stack. Link and footnote definitions are collected here.
2. **Conversion** (`convert.ts`) infers what the document doesn't state: the title,
   metadata lines, the abstract, the reference list, and heading levels (ranked, so
   skipped levels leave no gaps). The reference list is resolved first, because `[1]`
   in the text is only a citation if a matching entry exists.
3. **Inlines** (`inline.ts`) parses each block's text with the CommonMark delimiter
   algorithm over a linked list, plus math and citations. Backtracking is bounded: a
   missed closer is remembered and bracket scans are capped, so hostile input stays linear.

The style is recorded as a `\documentclass` node at the top of the tree. From there,
the normal library machinery picks it up, so nothing downstream knows the document
began as Markdown.

Heuristics that remove or reinterpret text are deliberately narrow, and anything removed
is reported as a `MarkdownCleanup` diagnostic. A wrong guess must leave the text in place.

## Paper layout

A paper style is a `Theme` with a `paper` block (`src/theme/papers.ts`), wrapped as a
library (`src/library/themes.ts`). `\documentclass` flags go through `applyPaperOptions`
when the engine builds its per-document bundle.

When `theme.paper` is set, both renderers lay out a front matter block and a body, and
`paperToCss` (`src/renderers/paper-css.ts`) adds the stylesheet:

- **Columns** are CSS multi-column, so a browser's print engine paginates them into real
  two-column pages.
- **Numbers** are CSS counters, not text. The HTML and React renderers share them, and a
  number can never drift from the document.
- **Looks** are one block of rules per `variant`, on top of the tokens from the theme.

Wide equations are the one place layout needs to know about content. Browsers cannot
break or scale MathML, so `equationFit` estimates a formula's width from the generated
MathML and spans or shrinks it, rather than letting it be clipped.

Verbatim environments (`code`, `equation`, …) are handled by the tokenizer, which emits
the whole body as one `Verbatim` token. TeX and code contain unbalanced braces, `%%`, and
`\end`-like text that ordinary tokens could not survive. `isBalanced` skips these bodies
too, so the incremental compiler never splits one at a blank line.

`src/math` compiles TeX to MathML Core with a recursive-descent parser. It uses Unicode
math ranges for fonts and inline CSS for table layout, because Core has no `mathvariant`
or `columnalign`. Like the rest of the pipeline it never throws: unknown commands show
their source and appear in `errors`, which the validator reports as `RTX3008`.

---

## Folder structure

```
src/
├── index.ts              # public export surface (re-exports everything below)
├── engine.ts             # ReTeXEngine: wires the pipeline + cache + theme + plugins
│
├── convert.ts            # markdownToHtml, markdownToRetex, markdownToPdf
│
├── cli/
│   ├── main.ts           # the `retex` bin
│   └── run.ts            # argument handling, output formats, browser-based PDF
├── markdown/
│   ├── blocks.ts         # block structure (CommonMark + GFM)
│   ├── inline.ts         # inline parsing: emphasis, links, math, citations, HTML
│   ├── convert.ts        # parseMarkdown: structure inference and AI cleanup
│   ├── frontmatter.ts    # the YAML subset for document metadata
│   └── index.ts
├── math/
│   ├── mathml.ts         # texToMathML, estimateMathWidth
│   ├── symbols.ts        # symbol tables and Unicode math fonts
│   └── index.ts
├── tokenizer/
│   ├── tokenizer.ts      # the lexer (Tokenizer, tokenize)
│   └── index.ts
├── parser/
│   ├── parser.ts         # recursive-descent parser with error recovery
│   ├── registry.ts       # CommandRegistry
│   ├── builtins.ts       # the blank core: structure, emphasis, \usepackage (createDefaultRegistry)
│   ├── args.ts           # parseKeyValArg, parseListArg, splitTopLevel
│   ├── suggest.ts        # levenshtein, closestMatch ("did you mean?")
│   └── index.ts
├── validator/
│   ├── validator.ts      # semantic validation pass
│   └── index.ts
│
├── ast/
│   ├── walk.ts           # walk, collect, childrenOf, nodePathAt
│   └── text.ts           # flattenText, normalizeWhitespace
│
├── renderers/
│   ├── html.ts           # HtmlRenderer, renderHtml, renderHtmlDocument
│   ├── react.ts          # ReactRenderer, renderReact (dependency-free)
│   ├── json.ts           # renderJson, toJsonTree
│   ├── pdf.ts            # renderPrintHtml, renderPdf, pageCss
│   ├── css.ts            # themeToCss
│   ├── paper-css.ts      # paperToCss, paperPageCss: layout, numbering, per-style looks
│   ├── structure.ts      # toRegions, splitPreamble, entryParts, dateRange
│   ├── context.ts        # render contexts, isBlockNode, BLOCK_TYPES
│   └── index.ts
│
├── theme/
│   ├── default.ts        # blankTheme (= defaultTheme)
│   ├── themes.ts         # resolveTheme, opt-in presets, themes map, getTheme
│   ├── papers.ts         # paper style themes, applyPaperOptions
│   └── index.ts
├── library/
│   ├── types.ts          # ReTeXLibrary
│   ├── colors.ts         # colorsLibrary, colorCommands, palettes
│   ├── fonts.ts          # fontsLibrary, fontCommands, fontStacks, fontTheme
│   ├── shapes.ts         # shapesLibrary, shapeCommands
│   ├── themes.ts         # modern/classic/compact library packs
│   ├── registry.ts       # builtins, resolution, applyLibraries, libraryDiagnostics, …
│   └── index.ts
├── plugin/
│   ├── types.ts          # ReTeXPlugin, EngineCommand, PluginHost
│   ├── examples.ts       # badgePlugin, ratingPlugin
│   └── index.ts
├── icons/
│   ├── icons.ts          # icon registry + iconToSvg, registerIcon, iconNames…
│   └── index.ts
├── editor/
│   ├── editor.ts         # EditorService (completion/hover/tokens/diagnostics/…)
│   ├── printer.ts        # printDocument (the formatter)
│   ├── sync.ts           # two-way preview source-map helpers (DOM-free)
│   └── index.ts
├── incremental/
│   ├── incremental.ts    # IncrementalCompiler, splitBalancedSegments, isBalanced
│   └── index.ts
├── security/
│   ├── sanitize.ts       # escapeHtml, sanitizeUrl, isSafeColor, isSafeDimension…
│   └── index.ts
└── types/
    ├── source.ts         # Position, SourceRange + helpers
    ├── tokens.ts         # TokenType, Token
    ├── ast.ts            # the Node union + NodeMap + guards
    ├── diagnostics.ts    # DiagnosticSeverity, DiagnosticCode, Diagnostic
    ├── theme.ts          # Theme, PartialTheme, ThemeHeadings (all fields optional)
    ├── commands.ts       # CommandDefinition, EnvironmentDefinition, ArgSpec…
    └── index.ts
```

---

## Extension points

ReTeX is designed to be extended without forking. There are five:

### 0. Libraries

A `ReTeXLibrary` is a named `ReTeXPlugin` that can be activated from the document
(`\usepackage{name}`) as well as from code. Built-ins (`colors`, `fonts`,
`shapes`, `modern`, `classic`, `compact`) are always available; register your own
with `engine.provideLibrary(lib)` (addressable by `\usepackage`) or
`engine.use(lib)` (installed globally). This is the recommended way to ship a
reusable styling bundle, since it works for document authors *and* code.

### 1. Plugins

A `ReTeXPlugin` (`src/plugin/types.ts`) bundles any combination of commands,
environments, icons, render overrides (`htmlRenderers` / `reactRenderers` keyed
by node `type` or `command:<name>`), a theme patch, and an imperative `setup`
hook. Install with `new ReTeXEngine({ plugins: [...] })` or `engine.use(plugin)`.
`badgePlugin` and `ratingPlugin` are worked examples. A command may carry an
inline `render` map (`EngineCommand`) instead of a custom AST node — the common
case for simple inline commands.

### 2. Custom renderers / render overrides

Register an override with `engine.registerHtmlRenderer(key, fn)` /
`engine.registerReactRenderer(key, fn)`, where `key` is a node `type` or
`command:<name>`. The function receives the node, the render context (theme,
class prefix, `cls()` helper, recursive child renderer), and a `renderChildren`
callback. You can also drive the renderer classes (`HtmlRenderer`,
`ReactRenderer`) directly with your own `overrides` map.

### 3. Custom themes

Supply a full `Theme` or a `PartialTheme` (deep-merged) via engine options,
`setTheme`, or a plugin's `theme` field. Compose presets with `resolveTheme`.

### 4. Custom icons

`engine.registerIcon(name, def)` (or the module-level `registerIcon`, or a
plugin's `icons` map) adds/overrides an icon. An `IconDefinition` is the inner
markup of a `0 0 24 24` SVG using `currentColor`, with optional `stroked` and
`aliases`.
