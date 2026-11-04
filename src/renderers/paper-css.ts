import type { Theme, ThemePaper } from "../types/index.js";
import { isSafeDimension, sanitizeStyleValue } from "../security/sanitize.js";

const tokenSafe = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, "");

/** A CSS margin shorthand (one to four dimensions), or the fallback if unsafe. */
export function safeMargin(value: string | undefined, fallback: string): string {
  const parts = (value ?? "").trim().split(/\s+/);
  const ok = parts.length >= 1 && parts.length <= 4 && parts.every(isSafeDimension);
  return ok ? parts.join(" ") : fallback;
}

/**
 * Quote a label for use as a CSS `content` string. Anything structural becomes a
 * hex escape: inside a `<style>` element even a quoted `</style>` ends the sheet.
 */
function cssString(value: string): string {
  const escaped = value.replace(
    /[^\p{L}\p{N} .,:()-]/gu,
    (c) => `\\${c.codePointAt(0)!.toString(16)} `,
  );
  return `"${escaped}"`;
}

/** The classes that switch a document's root element into a paper layout. */
export function paperRootClasses(paper: ThemePaper, prefix: string): string[] {
  const p = `${prefix}-paper`;
  const classes = [p];
  if (paper.variant) classes.push(`${p}--${tokenSafe(paper.variant)}`);
  if (paper.columns === 2) classes.push(`${p}--2col`);
  if (paper.numbering === "ieee" || paper.numbering === "decimal") {
    classes.push(`${p}--num-${paper.numbering}`);
  }
  if (paper.equationNumbers) classes.push(`${p}--eqno`);
  return classes;
}

/**
 * The stylesheet for a research paper. Layered on top of the ordinary theme CSS,
 * and scoped under `.retex-paper` so it can never affect a resume on the same page.
 *
 * Numbers are CSS counters rather than text in the markup, so the HTML and React
 * renderers can share this file, and a number can never drift from the document.
 */
export function paperToCss(theme: Theme, prefix = "retex"): string {
  const paper = theme.paper;
  if (!paper) return "";
  const p = prefix;
  const root = `.${p}-paper`;
  const gap =
    paper.columnGap && isSafeDimension(paper.columnGap) ? paper.columnGap : "0.3in";
  const lineHeight = sanitizeStyleValue(paper.lineHeight ?? "") || "1.4";
  const align = paper.textAlign === "justify" ? "justify" : "left";
  const figureLabel = cssString(paper.figureLabel ?? "Figure");
  const tableLabel = cssString(paper.tableLabel ?? "Table");
  const margin = safeMargin(theme.page?.margin, "1in");

  return `${root} {
    --${p}-column-gap: ${gap};
    --${p}-figure-label: ${figureLabel};
    --${p}-table-label: ${tableLabel};
    counter-reset: ${p}-sec ${p}-fig ${p}-tab ${p}-eq;
    padding: ${margin};
    line-height: ${lineHeight};
    overflow-wrap: break-word;
}
${root} .${p}-para { text-align: ${align}; hyphens: ${align === "justify" ? "auto" : "manual"}; }
${root} .${p}-link, ${root} .${p}-ref-body { overflow-wrap: anywhere; }
${root} .${p}-para { margin: 0 0 0.55em; orphans: 2; widows: 2; }
${root} .${p}-para:last-child { margin-bottom: 0.55em; }

/* The page: front matter above, then the flowing body. */
.${p}-paper-front { margin-bottom: 1.4em; }
.${p}-paper-title {
    font-family: var(--${p}-font-heading);
    font-size: var(--${p}-fs-name);
    font-weight: 700;
    line-height: 1.15;
    margin: 0 0 0.45em;
    text-wrap: balance;
}
.${p}-paper-date { color: var(--${p}-muted); margin: 0.4em 0 1em; }
.${p}-authors { display: flex; flex-wrap: wrap; gap: 0.5em 2em; margin-bottom: 0.8em; }
.${p}-author { display: flex; flex-direction: column; line-height: 1.25; }
.${p}-author-name { font-weight: 600; }
.${p}-author-detail { font-size: var(--${p}-fs-small); color: var(--${p}-muted); }
.${p}-author-email { font-size: var(--${p}-fs-small); color: var(--${p}-muted); text-decoration: none; }
${root} .${p}-contact { margin-bottom: 0.8em; }

${root}.${p}-paper--2col .${p}-paper-body { column-count: 2; column-gap: var(--${p}-column-gap); }

/* Sections flow across columns and pages, unlike a resume's kept-together blocks. */
${root} .${p}-section { break-inside: auto; margin-bottom: var(--${p}-sp-section); }
${root} .${p}-section-title { margin: 0 0 0.45em; line-height: 1.2; break-after: avoid; }
${root} .${p}-subsection-title { margin: 0.8em 0 0.3em; line-height: 1.2; break-after: avoid; font-size: 1em; font-weight: 700; }
${root} h3.${p}-subsection-title { font-size: 1.05em; }
${root} h4.${p}-subsection-title { font-style: italic; }
${root} h5.${p}-subsection-title { font-weight: 700; font-style: italic; }

/* Abstract and keywords. */
.${p}-abstract { margin: 0 0 0.7em; }
.${p}-abstract-label { font-family: var(--${p}-font-heading); font-size: 1em; font-weight: 700; margin: 0 0 0.25em; }
.${p}-keywords { margin: 0 0 1em; }
.${p}-keywords-label { font-weight: 700; margin-right: 0.35em; }

/* Numbering. */
${root}[class*="--num-"] .${p}-section { counter-reset: ${p}-sub ${p}-subsub; }
${root}[class*="--num-"] .${p}-section h3.${p}-subsection-title { counter-reset: ${p}-subsub; }
${root}.${p}-paper--num-decimal .${p}-section:not(.${p}-section--unnumbered) > .${p}-section-title::before {
    counter-increment: ${p}-sec;
    content: counter(${p}-sec) "\\2002";
}
${root}.${p}-paper--num-decimal .${p}-section:not(.${p}-section--unnumbered) h3.${p}-subsection-title:not(.${p}-subsection-title--unnumbered)::before {
    counter-increment: ${p}-sub;
    content: counter(${p}-sec) "." counter(${p}-sub) "\\2002";
}
${root}.${p}-paper--num-decimal .${p}-section:not(.${p}-section--unnumbered) h4.${p}-subsection-title:not(.${p}-subsection-title--unnumbered)::before {
    counter-increment: ${p}-subsub;
    content: counter(${p}-sec) "." counter(${p}-sub) "." counter(${p}-subsub) "\\2002";
}
${root}.${p}-paper--num-ieee .${p}-section:not(.${p}-section--unnumbered) > .${p}-section-title::before {
    counter-increment: ${p}-sec;
    content: counter(${p}-sec, upper-roman) ".\\2002";
}
${root}.${p}-paper--num-ieee .${p}-section:not(.${p}-section--unnumbered) h3.${p}-subsection-title:not(.${p}-subsection-title--unnumbered)::before {
    counter-increment: ${p}-sub;
    content: counter(${p}-sub, upper-alpha) ".\\2002";
}
${root}.${p}-paper--num-ieee .${p}-section:not(.${p}-section--unnumbered) h4.${p}-subsection-title:not(.${p}-subsection-title--unnumbered)::before {
    counter-increment: ${p}-subsub;
    content: counter(${p}-subsub) ")\\2002";
}

/* Figures, tables, equations. Keep them whole, and let wide ones span the page. */
${root} .${p}-figure { margin: 0.9em 0; text-align: center; break-inside: avoid; }
${root} .${p}-caption { font-size: var(--${p}-fs-small); line-height: 1.25; margin-top: 0.45em; text-align: left; }
${root} .${p}-figure > .${p}-caption::before {
    counter-increment: ${p}-fig;
    content: var(--${p}-figure-label) " " counter(${p}-fig) ".\\2002";
    font-weight: 700;
}
${root} .${p}-table-wrap { margin: 0.9em 0; break-inside: avoid; }
${root} .${p}-table caption { caption-side: top; margin: 0 0 0.45em; }
${root} .${p}-table caption::before {
    counter-increment: ${p}-tab;
    content: var(--${p}-table-label) " " counter(${p}-tab) ".\\2002";
    font-weight: 700;
}
${root} .${p}-table { font-size: 0.9em; line-height: 1.25; border-top: 1.2px solid var(--${p}-border); border-bottom: 1.2px solid var(--${p}-border); background: none; }
${root} .${p}-table caption { background: none; }
${root} .${p}-table th { border-bottom: 0.7px solid var(--${p}-border); background: none; }
${root} .${p}-table th, ${root} .${p}-table td { padding: 0.25em 0.5em; border-left: none; border-right: none; }
${root} .${p}-table td { border-top: none; border-bottom: none; }
.${p}-figure--wide, .${p}-table-wrap--wide, .${p}-equation--wide { column-span: all; }

${root}.${p}-paper--eqno .${p}-equation--numbered { position: relative; padding: 0 2.4em; }
${root}.${p}-paper--eqno .${p}-equation--numbered::after {
    counter-increment: ${p}-eq;
    content: "(" counter(${p}-eq) ")";
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
}

${root} .${p}-list { margin-bottom: 0.55em; }

/* Code, quotations, and notes, sized for a narrow column. */
${root} .${p}-codeblock { font-size: 0.8em; line-height: 1.3; break-inside: avoid; white-space: pre-wrap; overflow-wrap: anywhere; hyphens: manual; text-align: left; }
${root} .${p}-code { font-size: 0.88em; overflow-wrap: anywhere; hyphens: manual; }
${root} .${p}-quote { font-size: 0.97em; }
${root} .${p}-footnotes { break-inside: auto; font-size: var(--${p}-fs-small); line-height: 1.25; }
${root} .${p}-footnotes li > .${p}-para { display: inline; margin: 0; text-indent: 0; }
${root} .${p}-footnotes li > .${p}-para ~ .${p}-para::before { content: " "; }

/* On screen, tall balanced columns mean scrolling back up to read the next one.
   Wrap them into screen-sized rows instead, or failing that balance each section. */
@media screen {
    @supports (column-wrap: wrap) {
        ${root}.${p}-paper--2col .${p}-paper-body { column-wrap: wrap; column-height: min(9.5in, 85vh); row-gap: 2.5em; }
    }
    @supports not (column-wrap: wrap) {
        ${root}.${p}-paper--2col .${p}-paper-body { column-count: auto; }
        ${root}.${p}-paper--2col .${p}-section-body { column-count: 2; column-gap: var(--${p}-column-gap); }
    }
}
@media print {
    ${root} .${p}-footnote-back { display: none; }
    /* Past the margin beats cut off: nothing in a printed page can scroll. */
    ${root} .${p}-equation { overflow: visible; }
}

${VARIANTS(p, root)}`;
}

/** The look of each built-in style, beyond what theme tokens can express. */
function VARIANTS(p: string, root: string): string {
  const v = (name: string): string => `${root}--${name}`;
  const firstInline = (scope: string): string => `${scope} .${p}-abstract-body, ${scope} .${p}-abstract-body > .${p}-para:first-child, ${scope} .${p}-abstract-label`;

  return `/* normal */
${v("normal")} .${p}-section-title { font-weight: 700; }
${v("normal")} .${p}-abstract { padding: 0.8em 1em; background: rgba(127,127,127,0.08); border-radius: 4px; }
${v("normal")} .${p}-keywords { font-size: var(--${p}-fs-small); }

/* ieee */
${v("ieee")} .${p}-paper-front { text-align: center; }
${v("ieee")} .${p}-paper-title { font-weight: 400; }
${v("ieee")} .${p}-authors { justify-content: center; gap: 0.6em 3em; }
${v("ieee")} .${p}-author-name { font-weight: 400; font-size: 1.1em; }
${v("ieee")} .${p}-author-detail { font-style: italic; }
${v("ieee")} .${p}-section-title { font-variant: small-caps; font-weight: 400; text-align: center; font-size: 1.1em; }
${v("ieee")} h3.${p}-subsection-title { font-style: italic; font-weight: 400; font-size: 1em; }
${v("ieee")} h4.${p}-subsection-title { font-style: italic; font-weight: 400; }
${v("ieee")} .${p}-section-body > .${p}-para + .${p}-para { text-indent: 1em; }
${v("ieee")} .${p}-abstract, ${v("ieee")} .${p}-keywords { font-size: 0.9em; font-weight: 700; line-height: 1.15; text-align: justify; }
${v("ieee")} .${p}-abstract-label, ${v("ieee")} .${p}-keywords-label { font-style: italic; font-weight: 700; font-family: inherit; }
${firstInline(v("ieee"))} { display: inline; }
${v("ieee")} .${p}-abstract-label::after, ${v("ieee")} .${p}-keywords-label::after { content: "\\2014"; }
${v("ieee")} .${p}-keywords-label { margin-right: 0; }
${v("ieee")} .${p}-abstract .${p}-para { margin: 0; text-align: justify; }
${v("ieee")} .${p}-table caption { text-align: center; font-variant: small-caps; }
${v("ieee")} .${p}-table caption::before { content: var(--${p}-table-label) " " counter(${p}-tab, upper-roman); display: block; font-weight: 400; font-variant: normal; }
${v("ieee")} .${p}-figure > .${p}-caption { text-align: center; }
${v("ieee")} .${p}-references { font-size: 0.8em; line-height: 1.2; }

/* acm */
${v("acm")} .${p}-paper-title { font-weight: 700; }
${v("acm")} .${p}-authors { gap: 0.6em 2.5em; }
${v("acm")} .${p}-author-name { font-family: var(--${p}-font-heading); font-size: 1.05em; }
${v("acm")} .${p}-abstract-label { text-transform: uppercase; }
${v("acm")} .${p}-section-title { text-transform: uppercase; font-weight: 700; letter-spacing: 0.02em; }
${v("acm")} .${p}-subsection-title { font-family: var(--${p}-font-heading); }
${v("acm")} .${p}-section-body > .${p}-para + .${p}-para { text-indent: 1em; }
${v("acm")} .${p}-keywords { padding-bottom: 0.8em; border-bottom: 0.7px solid var(--${p}-border); }
${v("acm")} .${p}-keywords-label { font-family: var(--${p}-font-heading); text-transform: uppercase; display: block; margin-bottom: 0.25em; }
${v("acm")} .${p}-references { font-size: 0.85em; line-height: 1.2; }

/* arxiv */
${v("arxiv")} .${p}-paper-front { text-align: center; }
${v("arxiv")} .${p}-paper-title { border-top: 3px solid #000; border-bottom: 1px solid #000; padding: 0.55em 0.4em; margin-bottom: 1em; }
${v("arxiv")} .${p}-authors { justify-content: center; gap: 0.6em 2.5em; }
${v("arxiv")} .${p}-abstract { margin: 1.2em 2.5em 0.6em; }
${v("arxiv")} .${p}-abstract-label { text-align: center; font-size: 1.1em; }
${v("arxiv")} .${p}-abstract .${p}-para { text-align: justify; }
${v("arxiv")} .${p}-keywords { margin: 0 2.5em 1em; text-align: left; }
${v("arxiv")} .${p}-section-title { font-weight: 700; }
${v("arxiv")} .${p}-references { font-size: 0.95em; }

/* lncs */
${v("lncs")} .${p}-paper-front { text-align: center; }
${v("lncs")} .${p}-paper-title { margin-bottom: 0.9em; }
${v("lncs")} .${p}-authors { justify-content: center; }
${v("lncs")} .${p}-author-name { font-weight: 400; }
${v("lncs")} .${p}-abstract, ${v("lncs")} .${p}-keywords { font-size: 0.9em; margin-left: 2.2em; margin-right: 2.2em; text-align: justify; }
${firstInline(v("lncs"))} { display: inline; }
${v("lncs")} .${p}-abstract-label { font-weight: 700; margin-right: 0.4em; }
${v("lncs")} .${p}-abstract .${p}-para { margin: 0; text-align: justify; }
${v("lncs")} h3.${p}-subsection-title { font-size: 1em; }
${v("lncs")} .${p}-section-body > .${p}-para + .${p}-para { text-indent: 1.2em; }
${v("lncs")} .${p}-references { font-size: 0.9em; }

/* apa */
${v("apa")} .${p}-paper-front { text-align: center; }
${v("apa")} .${p}-paper-title { line-height: 1.5; margin-bottom: 1em; }
${v("apa")} .${p}-authors { justify-content: center; flex-direction: column; align-items: center; gap: 0; }
${v("apa")} .${p}-author { line-height: 2; }
${v("apa")} .${p}-author-name { font-weight: 400; }
${v("apa")} .${p}-author-detail, ${v("apa")} .${p}-author-email { font-size: 1em; color: inherit; }
${v("apa")} .${p}-abstract { text-align: left; margin-top: 1.5em; }
${v("apa")} .${p}-abstract-label, ${v("apa")} .${p}-section-title { text-align: center; }
${v("apa")} .${p}-keywords { text-align: left; text-indent: 0.5in; }
${v("apa")} .${p}-keywords-label { font-style: italic; font-weight: 400; }
${v("apa")} .${p}-para { margin: 0; }
${v("apa")} .${p}-para:last-child { margin: 0; }
${v("apa")} .${p}-section-body > .${p}-para, ${v("apa")} .${p}-paper-body > .${p}-para { text-indent: 0.5in; }
${v("apa")} h3.${p}-subsection-title { text-align: left; font-size: 1em; margin: 0; }
${v("apa")} h4.${p}-subsection-title { text-align: left; font-style: italic; font-weight: 700; margin: 0; }
${v("apa")} .${p}-section { margin-bottom: 0; }
${v("apa")} .${p}-section-title { margin: 0; }
${v("apa")} .${p}-table caption::before { display: block; }
${v("apa")} .${p}-table caption { font-style: italic; }
${v("apa")} .${p}-table caption::before { font-style: normal; }
${v("apa")} .${p}-references { line-height: 2; }
${v("apa")} .${p}-ref-label { display: none; }
${v("apa")} .${p}-references li { display: block; padding-left: 0.5in; text-indent: -0.5in; }
${v("apa")} .${p}-footnotes { line-height: 1.5; }

/* journal */
${v("journal")} .${p}-paper-title { color: var(--${p}-primary); font-weight: 700; }
${v("journal")} .${p}-author-name { font-family: var(--${p}-font-heading); }
${v("journal")} .${p}-abstract { background: rgba(11,83,148,0.06); border-left: 3px solid var(--${p}-primary); padding: 0.8em 1em; margin-bottom: 0; }
${v("journal")} .${p}-abstract-label { color: var(--${p}-primary); text-transform: uppercase; letter-spacing: 0.04em; font-size: 0.95em; }
${v("journal")} .${p}-keywords { background: rgba(11,83,148,0.06); border-left: 3px solid var(--${p}-primary); padding: 0 1em 0.8em; font-size: 0.95em; }
${v("journal")} .${p}-keywords-label { color: var(--${p}-primary); font-family: var(--${p}-font-heading); }
${v("journal")} .${p}-section-title { color: var(--${p}-primary); border-bottom: 0.7px solid var(--${p}-border); padding-bottom: 0.2em; }
${v("journal")} .${p}-subsection-title { font-family: var(--${p}-font-heading); }
${v("journal")} .${p}-references { font-size: 0.9em; }`;
}

/**
 * Page rules for a standalone paper: real page geometry for print, and a sheet
 * of paper on a gray desk on screen. Kept separate from {@link paperToCss} because
 * it targets `body`, which a page embedding a paper fragment must keep control of.
 */
export function paperPageCss(theme: Theme, prefix = "retex"): string {
  const p = prefix;
  const size = sanitizeStyleValue(theme.page?.size ?? "") || "Letter";
  const margin = safeMargin(theme.page?.margin, "1in");
  const numberBox = theme.paper?.variant === "apa" ? "top-right" : "bottom-center";
  return `@page {
    size: ${size};
    margin: ${margin};
    @${numberBox} { content: counter(page); font-family: ${sanitizeStyleValue(theme.fonts?.body ?? "") || "serif"}; font-size: 9pt; }
}
html, body { margin: 0; padding: 0; background: #fff; }
@media print {
    .${p}-paper { padding: 0; background: none; }
}
@media screen {
    body { background: #e7e9ec; padding: 24px; }
    .${p}-paper { box-shadow: 0 1px 8px rgba(0,0,0,.16); }
}`;
}
