# Markdown to Research Paper

ReTeX can turn Markdown into a typeset paper. It was built with AI answers in mind,
since those are usually Markdown already, but any Markdown works.

```bash
npx @regmisatyam/retex answer.md --style ieee -o paper.pdf
```

```ts
import { markdownToHtml } from "@regmisatyam/retex";

const html = markdownToHtml(answer, { style: "ieee" });
```

- [Styles](#styles)
- [Adjusting a style](#adjusting-a-style)
- [How a document's structure is found](#how-a-documents-structure-is-found)
- [AI cleanup](#ai-cleanup)
- [What Markdown is supported](#what-markdown-is-supported)
- [Math](#math)
- [Getting a PDF](#getting-a-pdf)
- [Editing the result](#editing-the-result)
- [Your own style](#your-own-style)
- [Limitations](#limitations)

---

## Styles

| Style     | Columns | Sections            | Look                                               |
| --------- | ------- | ------------------- | -------------------------------------------------- |
| `normal`  | 1       | as you wrote them   | A clean document. **The default.**                 |
| `ieee`    | 2       | I., A., 1)          | IEEE conference: Times, small-caps headings.       |
| `acm`     | 2       | 1, 1.1, 1.1.1       | ACM proceedings: Libertine, sans headings.         |
| `journal` | 2       | 1, 1.1, 1.1.1       | A modern journal: sans headings, boxed abstract.   |
| `arxiv`   | 1       | 1, 1.1, 1.1.1       | arXiv/NeurIPS preprint: a title between rules.     |
| `lncs`    | 1       | 1, 1.1, 1.1.1       | Springer LNCS: narrow column, small type.          |
| `apa`     | 1       | as you wrote them   | APA 7: Times 12pt, double spaced, centered heads.  |

`article` and `plain` also mean `normal`, `springer` means `lncs`, and `neurips`
and `preprint` mean `arxiv`.

> These reproduce the **look** of each family for reading and sharing. They are not
> the publishers' official templates. If a venue requires its own LaTeX class for
> submission, use that class for the final version.

## Adjusting a style

Choose the style and any changes to it in whichever place suits you. Options in
code or on the command line win over the document's front matter.

| Change          | Code (`MarkdownOptions`)  | CLI                 | Front matter       |
| --------------- | ------------------------- | ------------------- | ------------------ |
| Style           | `style: "ieee"`           | `--style ieee`      | `style: ieee`      |
| Columns         | `columns: 1`              | `--columns 1`       | `columns: 1`       |
| Page size       | `pageSize: "A4"`          | `--page a4`         | `page: a4`         |
| Font size       | `fontSize: "12pt"`        | `--font-size 12pt`  | `fontsize: 12pt`   |
| Section numbers | `numbering: false`        | `--no-numbers`      | `numbering: false` |
| Title           | `title: "…"`              | `--title "…"`       | `title: …`         |
| Authors         | `authors: ["A", "B"]`     | `--author A`        | `authors: […]`     |

So a two-column version of the plain style, on A4:

```ts
markdownToHtml(answer, { style: "normal", columns: 2, pageSize: "A4" });
```

## How a document's structure is found

AI answers rarely state their structure, so it is inferred. Front matter always
wins, if there is any:

```yaml
---
title: Sparse Attention
authors:
  - name: Ada Lovelace
    affiliation: Analytical Engine Lab
    email: ada@example.org
  - Alan Turing
date: March 2026
abstract: |
  We show that most attention computation can be skipped.
keywords: [attention, sparsity]
style: ieee
---
```

Otherwise:

| You write                                        | It becomes                                      |
| ------------------------------------------------ | ----------------------------------------------- |
| A lone first heading, at any level               | The title                                       |
| `**Authors:** A (MIT), B and C` before section 1 | Authors, with parentheses as affiliations       |
| `**Affiliation:**`, `**Email:**`, `**Date:**`    | Those details, shared by all the authors        |
| `## Abstract`, or `**Abstract:** text`           | The abstract                                    |
| `## Keywords`, or `**Keywords:** a, b`           | Keywords (Index Terms in `ieee`)                |
| Any other heading                                | A section. Levels are ranked, so gaps don't matter |
| `## 1. Introduction`                             | `Introduction`, if the style numbers sections   |
| `## References`, `## Bibliography`, `## Sources` | An unnumbered, linked bibliography              |
| `[1]`, `[1, 2]`, `[1-3]`, `[@key]`               | Links to those references, if they exist        |
| `## Acknowledgments`, `## Funding`, `## Appendix` | An unnumbered section                          |
| `![caption](a.png)` alone in a paragraph         | A numbered figure                               |
| `**Table 1: Results**` beside a table            | That table's caption, numbered automatically    |
| `Figure 1: …` right after an image               | That figure's caption, numbered automatically   |
| A table too wide for one column                  | A table spanning the whole page                 |

Anything that looks like one of these but isn't stays as text. "Abstract art is hard
to define", `arr[1]`, and "see [9]" with no ninth reference are all left alone, and
no title is invented if the first heading is plainly a section like `Introduction`.

## AI cleanup

By default, these are removed, because they would look wrong in a paper:

- An opening line such as "Sure! Here's your paper:"
- A closing line such as "Let me know if you'd like me to expand this!"
- Citation markers such as `【4†source】` and `:contentReference[oaicite:1]{index=1}`
- Emoji at the start of headings
- A `---` divider directly before a heading
- A ```` ```markdown ```` fence around the whole answer

Only the very first and last paragraphs are ever considered, and only when they
match narrow patterns, so "Great apes share a common ancestor" and "If you like
coffee, this study is for you" are safe. **Every removal is reported** in
`diagnostics`, and on the command line. To turn it off, use `stripChatter: false` or
`--keep-chatter`.

## What Markdown is supported

CommonMark and GitHub Flavored Markdown, with a few allowances for how models write:

- **Inline:** bold, italic, strikethrough, code, links, images, reference links,
  autolinks, bare URLs, hard breaks, entities, and `<sub>`, `<sup>`, `<br>`, `<u>`.
- **Blocks:** headings (ATX and setext), paragraphs, fenced and indented code, block
  quotes, GitHub callouts, nested and task lists, tables, rules, and footnotes.
- **Allowances:** a fence that is never closed runs to the end of the answer, a
  sublist may be indented less than its parent's marker, and pipes inside code or
  math don't split table cells.

**HTML is never passed through.** Known tags are mapped or removed with their text
kept, while `<script>`, `<style>`, `<iframe>`, and the like are removed along with
their content. Unsafe link and image targets are blocked.

## Math

Formulas compile to MathML, which every current browser renders natively. There is
nothing to load and no dependency to install.

| Inline              | Display                                                 |
| ------------------- | ------------------------------------------------------- |
| `$x^2$`, `\(x^2\)`  | `$$x^2$$`, `\[x^2\]`, ```` ```math ````, `\begin{equation}` |

`$5 and $10` stays as prices, using the same rule as Pandoc: an opening `$` hugs what
follows it, and a closing `$` hugs what precedes it and isn't followed by a digit.

A display formula too wide for its column spans the whole page, and shrinks if it's
too wide even for that, rather than being cut off.

The common subset of TeX is supported: fractions, roots, scripts, big operators,
Greek, math fonts, accents, `\left`/`\right`, matrices, `cases`, `align`, `array`, and
`\text`. Anything else shows its source and adds a warning to `diagnostics`. For full
KaTeX or MathJax, render the `math` node yourself with
`engine.registerHtmlRenderer("math", fn)`.

## Getting a PDF

**From the command line**, using any installed Chrome, Edge, or Chromium:

```bash
retex answer.md --style acm -o paper.pdf
pbpaste | retex - --style ieee -o paper.pdf
```

Set `RETEX_CHROME` to choose a browser. If none is found, `puppeteer` is used if
installed.

**From a browser:** write `-o paper.html`, open it, and print. Under *More settings*,
turn off "Headers and footers"; the page numbers are the paper's own.

**From code:** `markdownToPdf(answer, { style })` needs `puppeteer` or a `launch`
function, like `engine.toPdf`.

## Editing the result

A converted document is ordinary ReTeX. Save it as source to refine it by hand:

```bash
retex answer.md --style ieee -o paper.retex
```

```latex
\documentclass{ieee}

\title{Sparse Attention}

\author{name=Ada Lovelace, affiliation=Analytical Engine Lab}

\begin{abstract}
  We show that most attention computation can be skipped.
\end{abstract}

\section{Introduction}

Transformers \cite{1} cost \math{O(n^2)} ...
```

It compiles to exactly the same page. See [the syntax reference](SYNTAX.md#research-papers)
for all of these commands.

## Your own style

A paper style is an ordinary theme with a `paper` block, so it can start from a
built-in one:

```ts
import { ReTeXEngine, createPaperStyle, journalTheme } from "@regmisatyam/retex";

const engine = new ReTeXEngine();
engine.provideLibrary(
  createPaperStyle({
    ...journalTheme,
    name: "mylab",
    colors: { ...journalTheme.colors, primary: "#7c2d12" },
    paper: { ...journalTheme.paper, columns: 1, keywordsLabel: "Topics" },
  }),
);

const { ast } = engine.fromMarkdown(answer, { style: "mylab" });
const html = engine.toHtmlDocument(ast);
```

It then also works from a document, as `\documentclass{mylab}`. For more control,
target `.retex-paper--<variant>` in your own CSS.

## Limitations

- **Fonts aren't embedded.** Styles name common system fonts with fallbacks, so a
  machine without Times New Roman or Libertine shows the closest match.
- **Footnotes collect at the end** of the document rather than at the foot of each
  page, because browsers can't do the latter.
- **On screen, two columns wrap into rows** using CSS `column-wrap` where the browser
  supports it, as current Chrome does. Elsewhere each section is balanced on its own.
  Printing always gives real pages.
- **Long formulas don't line-break**, since browsers can't break MathML. They span
  the page and shrink instead, down to 60%, and past that they overflow on screen by
  scrolling and in print into the margin.
- **No syntax highlighting.** Code keeps its `language-*` class for your own CSS or
  highlighter.
- **Figure and table placement is in flow.** Unlike LaTeX, nothing floats to the top
  of a column.
- **No two-way source mapping from Markdown.** Nodes made from Markdown have no source
  offsets, so the playground's click-to-source works only for ReTeX input. Convert to
  `.retex` first if you want it.
