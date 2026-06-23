# ReTeX Syntax Reference

This is the complete reference for the ReTeX markup language: every built-in
command and environment, their argument signatures, and examples — plus the
ReTeX-specific lexing rules that distinguish it from LaTeX.

This document is the user-facing companion to the source of truth,
`src/parser/builtins.ts` (the blank core) and `src/library/` (the libraries).

> **ReTeX is blank by default.** The core ships document structure and basic
> text emphasis only. Color, fonts, and shapes (rules/dividers/spacing) live in
> **libraries** you import with `\usepackage{...}` — exactly like LaTeX
> packages. Commands marked **🔌 _Library:_ `name`** below require that
> library. See [Libraries & `\usepackage`](#libraries--usepackage).

---

## Table of contents

- [Lexing rules](#lexing-rules)
- [Libraries & `\usepackage`](#libraries--usepackage)
- [Typography](#typography) — basic emphasis (core) + 🔌 color/fonts
- [Hyperlinks](#hyperlinks)
- [Sections](#sections)
- [Résumé header / contact](#résumé-header--contact)
- [Résumé entries](#résumé-entries)
- [Lists](#lists)
- [Columns / layout](#columns--layout)
- [Icons](#icons)
- [Primitives & shapes](#primitives--shapes) — 🔌 rules/dividers/spacing
- [Theme color](#theme-color) — 🔌 `colors`

---

## Lexing rules

ReTeX uses LaTeX-style braces and backslash commands, but the lexer diverges
from TeX in several ways that matter for résumés. These rules are applied by the
tokenizer (`src/tokenizer/tokenizer.ts`) before any parsing happens.

### `%` is a literal percent sign

Unlike LaTeX, a lone `%` is **literal text**, not a comment. This makes
percentages and column widths just work:

```latex
Reduced p99 latency by 40%.
\column{40%}
```

### Comments are `%%` to end of line

A double percent starts a comment that runs to the end of the line. Comments are
stripped from output but surfaced to editor tooling (e.g. semantic highlighting).

```latex
%% This whole line is a comment and won't be rendered.
\name{Ada Lovelace}   %% trailing comments work too
```

### Escapes

A backslash followed by a non-letter produces that literal character. Use these
to render characters that are otherwise structurally significant:

| Escape | Renders | Escape | Renders            |
| ------ | ------- | ------ | ------------------ |
| `\%`   | `%`     | `\$`   | `$`                |
| `\{`   | `{`     | `\_`   | `_`                |
| `\}`   | `}`     | `\#`   | `#`                |
| `\&`   | `&`     | `\ `   | a literal space    |

```latex
Research \& Development — 100\% remote.
```

### `\\` is a line break

A double backslash inserts an explicit line break (`<br>`). `\newline` and
`\linebreak` are equivalent commands.

```latex
123 Main St \\ Springfield, USA
```

### Blank line = paragraph break

One or more blank lines separate paragraphs. A single newline is treated as
ordinary inline whitespace; two or more newlines become a paragraph break.

```latex
First paragraph.

Second paragraph.
```

### Key=value entry fields and the unquoted-comma rule

Entry commands (`\job`, `\education`, `\project`) take a `key=value, key=value`
field map. Values are unquoted, and there is one important convenience rule:

> A comma-separated segment that contains **no `=`** is merged back into the
> previous value, with the comma kept literal.

This means unquoted values containing commas — like `location=New York, NY` —
work as written, because `NY` (no `=`) merges into the `location` value:

```latex
\job{title=Engineer, company=ACME, location=New York, NY, start=2022}{…}
```

The first `=` in a segment separates key from value; any later `=` characters are
preserved in the value. Commas protected by `{…}`/`[…]` are never treated as
separators. A bare segment with no `=` at the start (no previous value to merge
into) becomes a key with an empty-string value.

### Scoped font switches

Switch commands are **scoped**: they apply to the rest of their enclosing
`{ … }` group, exactly like LaTeX declarations. `\bfseries` and `\itshape` are
core; the size switches `\small`, `\large`, `\Large`, `\Huge`, `\normalsize` and
`\ttfamily` live in the **`fonts`** library. Wrap a switch in a group to bound
its effect:

```latex
\usepackage{fonts}
{\Large Ada Lovelace} — {\small Software Engineer}
```

Outside any group, a switch applies to the rest of the current content scope
(e.g. the rest of an argument or the document).

---

## Libraries & `\usepackage`

ReTeX is **blank by default** — no colors, no fonts beyond the browser default,
no rules. Styling is opt-in via **libraries**. Activate them two ways:

- **From the document** (LaTeX-style), in the preamble:

  ```latex
  \usepackage{colors}
  \usepackage{fonts, shapes}   %% comma-separate to import several
  \textcolor{#2563eb}{Now available}
  ```

  `\use{...}` is an alias for `\usepackage{...}`.

- **From code**, on the engine:

  ```ts
  import { ReTeXEngine, colorsLibrary } from "@regmisatyam/retex";
  const engine = new ReTeXEngine().use(colorsLibrary);
  ```

If you use a gated command without importing its library, ReTeX emits a
diagnostic telling you which `\usepackage{...}` to add (code `RTX4005`). An
unknown library name is flagged too (`RTX4004`).

### Built-in libraries

| Library    | Activate with            | Provides                                                                  |
| ---------- | ------------------------ | ------------------------------------------------------------------------- |
| `fonts`    | `\usepackage{fonts}`     | `\fontfamily`, `\fontsize`, `\small`…`\Huge`, `\normalsize`, `\ttfamily`   |
| `shapes`   | `\usepackage{shapes}`    | `\hrule`, `\divider`, `\dashrule`, `\dotrule`, `\thickrule`, `\doublerule`, `\vspace`, `\hspace` |
| `colors`   | `\usepackage{colors}`    | `\textcolor`, `\themecolor`                                               |
| `modern`   | `\usepackage{modern}`    | A styled look (violet accent, underlined headings) **+ all of the above** |
| `classic`  | `\usepackage{classic}`   | A serif look with ruled headings **+ all of the above**                   |
| `compact`  | `\usepackage{compact}`   | A dense, single-accent look **+ all of the above**                        |

`color`, `font`, and `shape` are accepted as singular aliases for the first
three. The theme packs (`modern`/`classic`/`compact`) bundle the full styling
toolkit, so importing one is the quickest way to get a complete, polished
document.

---

## Typography

Basic emphasis is core. Color and explicit font control are gated behind
libraries (noted per command).

### `\textbf{content}`

Bold text.

```latex
\textbf{Reduced build times by 40\%}
```

### `\textit{content}`

Italic text.

```latex
\textit{ad hoc}
```

### `\emph{content}`

Emphasized (italic) text.

```latex
Coined the term \emph{debugging}.
```

### `\underline{content}`

Underlined text.

```latex
\underline{Key achievement}
```

### `\sout{content}`

Struck-through text.

```latex
\sout{deprecated} replaced
```

### `\textcolor{color}{content}`

> 🔌 _Library:_ `colors` — `\usepackage{colors}`

Color text with a hex or named color. The color is validated (`#rgb`,
`#rrggbb`, `#rrggbbaa`, `rgb()/rgba()/hsl()/hsla()`, or a known CSS name);
invalid colors are ignored and produce a warning.

```latex
\textcolor{#2563eb}{OpenAI}
```

### `\fontsize{size}{content}`

> 🔌 _Library:_ `fonts` — `\usepackage{fonts}`

Set an explicit font size for the wrapped content. The size must be a valid CSS
dimension (e.g. `14pt`, `1.2em`, `18px`); invalid sizes fall back to `1em` with a
warning.

```latex
\fontsize{14pt}{Custom Size}
```

### `\fontfamily{family}{content}`

> 🔌 _Library:_ `fonts` — `\usepackage{fonts}`

Set the font family for the wrapped content. The `fonts` library also exports a
`fontStacks` catalog (Inter, Georgia, JetBrains Mono, …) and a `fontTheme(...)`
helper for building a `fonts` theme patch from named stacks.

```latex
\fontfamily{Georgia}{Serif text}
```

### `\themecolor{token}{content}`

> 🔌 _Library:_ `colors` — `\usepackage{colors}`

Color text using a token from the active theme. See
[Theme color](#theme-color).

```latex
\themecolor{primary}{Highlighted}
```

### Scoped switches

`\bfseries` and `\itshape` are **core**; the size switches and `\ttfamily`
require the **`fonts`** library. All apply to the **rest of their enclosing
group** (see [Scoped font switches](#scoped-font-switches)).

| Command        | Effect                                              | Library | Example                |
| -------------- | --------------------------------------------------- | ------- | ---------------------- |
| `\bfseries`    | Switch to bold                                      | core    | `{\bfseries bold run}` |
| `\itshape`     | Switch to italic                                    | core    | `{\itshape italic run}`|
| `\small`       | Smaller font size                                   | `fonts` | `{\small fine print}`  |
| `\large`       | Larger font size                                    | `fonts` | `{\large heading}`     |
| `\Large`       | Even larger font size                               | `fonts` | `{\Large title}`       |
| `\Huge`        | Largest font size                                   | `fonts` | `{\Huge name}`         |
| `\normalsize`  | Reset to the document base size                     | `fonts` | `{\normalsize body}`   |
| `\ttfamily`    | Switch to a monospace font                          | `fonts` | `{\ttfamily code}`     |

```latex
\usepackage{fonts}
{\Large \bfseries Section Heading}
```

---

## Hyperlinks

URLs are sanitized: only `http`, `https`, `mailto`, `tel`, `ftp`, and `sms`
schemes are allowed; anything else (e.g. `javascript:`) is blocked and replaced
with `#`. External `http(s)` links render with `target="_blank"` and
`rel="noopener noreferrer"`.

### `\href{url}{label}`

A hyperlink with custom label text.

```latex
\href{https://github.com/you}{GitHub}
```

### `\url{url}`

A hyperlink that displays its own URL as the label.

```latex
\url{https://linkedin.com/in/you}
```

---

## Sections

### `\section{title}`

A top-level résumé section. Top-level sections also delimit document *regions*
for rendering.

```latex
\section{Experience}
```

### `\subsection{title}`

A second-level section heading.

```latex
\subsection{Open Source}
```

---

## Résumé header / contact

These single-value commands populate the document header. When they appear
before the first `\section`, the renderer groups `\name`/`\title` and the contact
items into a `<header>`. `\email`, `\phone`, and `\website` render as links with
an icon.

| Command            | Field      | Description                                  |
| ------------------ | ---------- | -------------------------------------------- |
| `\name{...}`       | `name`     | Your full name (document header).            |
| `\title{...}`      | `title`    | Professional headline / role.                |
| `\email{...}`      | `email`    | Contact email (rendered as a `mailto:` link).|
| `\phone{...}`      | `phone`    | Contact phone number (rendered as a `tel:` link). |
| `\location{...}`   | `location` | City / location (rendered with a pin icon).  |
| `\website{...}`    | `website`  | Personal website (rendered as a link).       |

```latex
\name{Grace Hopper}
\title{Distinguished Engineer}
\email{grace@example.com}
\phone{+1 (555) 010-1999}
\location{Arlington, VA}
\website{https://gracehopper.dev}
```

---

## Résumé entries

Entry commands take a `key=value` field map and an **optional** content body.
Renderers normalize the fields into a title row (title + dates) and an optional
subtitle row (organization + location), followed by the body.

Recognized field keys per entry (others are accepted but unused by the default
renderer):

| Entry         | Title fields                | Subtitle             | Dates                        | Other                      |
| ------------- | --------------------------- | -------------------- | ---------------------------- | -------------------------- |
| `\job`        | `title`                     | `company` / `organization` | `start` + `end`, or `date` | `location`, `url` / `link` |
| `\education`  | `degree` / `school`         | `degree` (when both `degree` and `school` are present) | `start` + `end`, or `date` | `location`, `url`          |
| `\project`    | `name`                      | —                    | `start` + `end`, or `date`   | `location`, `url` / `link` |

When a `url` (or `link`) field is present, the entry title becomes a link. The
date display is `start – end` when both are present, otherwise whichever is set,
or the explicit `date` field if given.

### `\job{fields}{body?}`

A work-experience entry. `title` and `company` are recommended (a warning is
emitted if missing).

```latex
\job{title=Senior Engineer, company=OpenAI, start=2023, end=Present}{Built AI systems}
```

### `\education{fields}{body?}`

An education entry. `school` and `degree` are recommended.

```latex
\education{school=MIT, degree=BS Computer Science, start=2018, end=2022}
```

### `\project{fields}{body?}`

A project entry. `name` is recommended.

```latex
\project{name=ReTeX, url=https://github.com/you/retex}{A resume engine}
```

### `\skills{a, b, c}`

A comma-separated list of skills, rendered as pills. Commas protected by
`{…}`/`[…]` are not treated as separators.

```latex
\skills{JavaScript, TypeScript, React, Node.js, AWS}
```

---

## Lists

Lists are environments delimited by `\item` markers.

### `itemize`

A bulleted list.

```latex
\begin{itemize}
  \item Built distributed systems
  \item Mentored five engineers
\end{itemize}
```

### `enumerate`

A numbered list.

```latex
\begin{enumerate}
  \item First
  \item Second
\end{enumerate}
```

### `\item`

A list item. Only valid inside `itemize` or `enumerate`; used outside one of
those environments it produces an error.

```latex
\item Built distributed systems
```

---

## Columns / layout

### `columns`

A multi-column layout. Each column is introduced by `\column{width}`. Widths may
be percentages, lengths, or `auto`; a width of `auto` (or an invalid dimension)
makes the column flex to fill available space.

```latex
\begin{columns}
  \column{40%} Left column content
  \column{60%} Right column content
\end{columns}
```

### `\column{width}`

A column marker. Only valid inside the `columns` environment; used elsewhere it
produces an error.

```latex
\column{40%}
```

### `center`

Center-align the contained block content.

```latex
\begin{center}
  \name{Ada Lovelace}
\end{center}
```

---

## Icons

`\icon{name}` renders an inline SVG that inherits the surrounding text color.
Unknown names produce an informational diagnostic and a graceful empty fallback.

```latex
\icon{github} \href{https://github.com/you}{GitHub}
```

### Built-in icon names

| Name            | Aliases                              |
| --------------- | ------------------------------------ |
| `github`        | —                                    |
| `linkedin`      | —                                    |
| `email`         | `mail`, `envelope`                   |
| `phone`         | `tel`, `telephone`                   |
| `location`      | `map`, `pin`, `marker`, `geo`        |
| `website`       | `globe`, `web`, `link`, `url`        |
| `twitter`       | `x`                                  |
| `gitlab`        | —                                    |
| `stackoverflow` | `stack-overflow`, `so`              |
| `scholar`       | `google-scholar`, `academic`         |
| `orcid`         | —                                    |
| `calendar`      | `date`                               |
| `briefcase`     | `work`, `job`                        |

Icon names are case-insensitive. New icons can be registered at runtime via the
API (`registerIcon`) or a plugin.

---

## Primitives & shapes

`\\` / `\newline` / `\linebreak` are **core**. Rules, dividers, and explicit
spacing are **shapes** — `\usepackage{shapes}`.

### `\\` — line break

An explicit line break. `\newline` and `\linebreak` are equivalent. **Core.**

```latex
123 Main St \\ Springfield, USA
```

### Horizontal rules / dividers

> 🔌 _Library:_ `shapes` — `\usepackage{shapes}`

A family of horizontal rules. `\hrule` and `\divider` are synonyms for a thin
solid line; the others vary the line style.

| Command        | Style          |
| -------------- | -------------- |
| `\hrule`       | thin solid     |
| `\divider`     | thin solid     |
| `\dashrule`    | dashed         |
| `\dotrule`     | dotted         |
| `\thickrule`   | thick solid    |
| `\doublerule`  | double         |

```latex
\usepackage{shapes}
\hrule
\dashrule
```

### `\vspace{size}` / `\hspace{size}` — spacing

> 🔌 _Library:_ `shapes` — `\usepackage{shapes}`

Vertical / horizontal space. The size must be a valid CSS dimension (defaults to
`1em`).

```latex
\vspace{1em}
Left \hspace{2em} Right
```

---

## Theme color

### `\themecolor{token}{content}`

> 🔌 _Library:_ `colors` — `\usepackage{colors}`

Colors text using a named token from the active [theme](API.md#theming). Every
theme color is exposed as the CSS variable `--retex-color-<token>`, so this works
with both built-in tokens (`primary`, `secondary`, `text`, `muted`, `background`,
`border`, plus any custom swatches like `accent`/`success`) and any token you add
to a custom theme. When a theme is supplied to the validator, unknown tokens
produce a warning.

```latex
\themecolor{primary}{Highlighted} and \themecolor{success}{Shipped}
```
