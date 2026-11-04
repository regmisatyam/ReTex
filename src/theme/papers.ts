import type { Theme, ThemePaper } from "../types/theme.js";

/**
 * Built-in research-paper styles. Each is plain theme data, so a style can be
 * serialized, patched, or used as the starting point for your own.
 *
 * These reproduce the *look* of each family for reading and sharing. They are not
 * the publishers' official templates: a venue that requires its own LaTeX class
 * will still want that class for the final submission.
 *
 * Sizes are in `em` wherever possible, so `\documentclass[12pt]{...}` scales the
 * whole style from one number.
 */

const TIMES = '"Times New Roman", Times, "Liberation Serif", "Nimbus Roman", serif';
const COURIER = '"Courier New", Courier, "Liberation Mono", monospace';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
const LIBERTINE =
  '"Linux Libertine O", "Linux Libertine", "Libertinus Serif", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';
const CHARTER = 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif';
const SANS = '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif';

const INK = {
  text: "#000000",
  muted: "#333333",
  primary: "#000000",
  secondary: "#333333",
  background: "#ffffff",
  border: "#000000",
};

const letter = (margin: string): NonNullable<Theme["page"]> => ({
  size: "Letter",
  margin,
  maxWidth: "8.5in",
});

/** A clean single-column document, unnumbered: what most people mean by "normal". */
export const normalTheme: Theme = {
  name: "normal",
  colors: { ...INK, text: "#1a1a1a", muted: "#555555", border: "#c8c8c8", primary: "#1a1a1a" },
  fonts: { heading: CHARTER, body: CHARTER, mono: MONO },
  fontSizes: {
    base: "11pt",
    small: "0.85em",
    large: "1.2em",
    Large: "1.45em",
    Huge: "2em",
    name: "2em",
    section: "1.4em",
  },
  spacing: { section: "1.5rem", item: "0.3rem" },
  page: letter("1in"),
  paper: {
    variant: "normal",
    columns: 1,
    numbering: "none",
    abstractPlacement: "front",
    abstractLabel: "Abstract",
    keywordsLabel: "Keywords",
    figureLabel: "Figure",
    tableLabel: "Table",
    equationNumbers: false,
    lineHeight: "1.5",
    textAlign: "left",
  },
};

/** IEEE conference look: two columns, Times, roman-numbered small-caps sections. */
export const ieeeTheme: Theme = {
  name: "ieee",
  colors: INK,
  fonts: { heading: TIMES, body: TIMES, mono: COURIER },
  fontSizes: {
    base: "10pt",
    small: "0.8em",
    large: "1.1em",
    Large: "1.3em",
    Huge: "1.8em",
    name: "2.4em",
    section: "1em",
  },
  spacing: { section: "0.9em", item: "0.15em" },
  page: letter("0.75in 0.625in 1in"),
  paper: {
    variant: "ieee",
    columns: 2,
    columnGap: "0.25in",
    numbering: "ieee",
    abstractPlacement: "column",
    abstractLabel: "Abstract",
    keywordsLabel: "Index Terms",
    figureLabel: "Fig.",
    tableLabel: "TABLE",
    equationNumbers: true,
    lineHeight: "1.15",
    textAlign: "justify",
  },
};

/** ACM proceedings look: two columns, Libertine, bold sans headings, wide abstract. */
export const acmTheme: Theme = {
  name: "acm",
  colors: INK,
  fonts: { heading: SANS, body: LIBERTINE, mono: MONO },
  fontSizes: {
    base: "9.5pt",
    small: "0.85em",
    large: "1.1em",
    Large: "1.3em",
    Huge: "1.8em",
    name: "2.2em",
    section: "1.05em",
  },
  spacing: { section: "1em", item: "0.15em" },
  page: letter("0.85in 0.75in 0.9in"),
  paper: {
    variant: "acm",
    columns: 2,
    columnGap: "0.33in",
    numbering: "decimal",
    abstractPlacement: "front",
    abstractLabel: "Abstract",
    keywordsLabel: "Keywords",
    figureLabel: "Figure",
    tableLabel: "Table",
    equationNumbers: true,
    lineHeight: "1.2",
    textAlign: "justify",
  },
};

/** arXiv / NeurIPS preprint look: one column, a title between rules, wide margins. */
export const arxivTheme: Theme = {
  name: "arxiv",
  colors: INK,
  fonts: { heading: TIMES, body: TIMES, mono: COURIER },
  fontSizes: {
    base: "10.5pt",
    small: "0.85em",
    large: "1.15em",
    Large: "1.35em",
    Huge: "1.8em",
    name: "1.65em",
    section: "1.15em",
  },
  spacing: { section: "1.3em", item: "0.2em" },
  page: letter("1in 1.25in"),
  paper: {
    variant: "arxiv",
    columns: 1,
    numbering: "decimal",
    abstractPlacement: "front",
    abstractLabel: "Abstract",
    keywordsLabel: "Keywords",
    figureLabel: "Figure",
    tableLabel: "Table",
    equationNumbers: true,
    lineHeight: "1.3",
    textAlign: "justify",
  },
};

/** Springer LNCS look: one narrow column, small type, a run-in abstract. */
export const lncsTheme: Theme = {
  name: "lncs",
  colors: INK,
  fonts: { heading: TIMES, body: TIMES, mono: COURIER },
  fontSizes: {
    base: "10pt",
    small: "0.85em",
    large: "1.05em",
    Large: "1.2em",
    Huge: "1.6em",
    name: "1.45em",
    section: "1.2em",
  },
  spacing: { section: "1.3em", item: "0.15em" },
  page: letter("1.5in 1.65in"),
  paper: {
    variant: "lncs",
    columns: 1,
    numbering: "decimal",
    abstractPlacement: "front",
    abstractLabel: "Abstract.",
    keywordsLabel: "Keywords:",
    figureLabel: "Fig.",
    tableLabel: "Table",
    equationNumbers: true,
    lineHeight: "1.25",
    textAlign: "justify",
  },
};

/** APA 7 look: Times 12pt, double spaced, centered headings, no section numbers. */
export const apaTheme: Theme = {
  name: "apa",
  colors: INK,
  fonts: { heading: TIMES, body: TIMES, mono: COURIER },
  fontSizes: {
    base: "12pt",
    small: "0.9em",
    large: "1em",
    Large: "1.1em",
    Huge: "1.3em",
    name: "1.15em",
    section: "1em",
  },
  spacing: { section: "1em", item: "0" },
  page: letter("1in"),
  paper: {
    variant: "apa",
    columns: 1,
    numbering: "none",
    abstractPlacement: "front",
    abstractLabel: "Abstract",
    keywordsLabel: "Keywords:",
    figureLabel: "Figure",
    tableLabel: "Table",
    equationNumbers: false,
    lineHeight: "2",
    textAlign: "left",
  },
};

/** A modern journal look: two columns, sans headings, a boxed wide abstract. */
export const journalTheme: Theme = {
  name: "journal",
  colors: {
    text: "#111111",
    muted: "#4a5568",
    primary: "#0b5394",
    secondary: "#4a5568",
    background: "#ffffff",
    border: "#b8c4d0",
    accent: "#0b5394",
  },
  fonts: { heading: SANS, body: CHARTER, mono: MONO },
  fontSizes: {
    base: "9.5pt",
    small: "0.85em",
    large: "1.15em",
    Large: "1.35em",
    Huge: "1.8em",
    name: "2.5em",
    section: "1.2em",
  },
  spacing: { section: "1.1em", item: "0.15em" },
  page: letter("0.8in 0.7in 0.9in"),
  paper: {
    variant: "journal",
    columns: 2,
    columnGap: "0.3in",
    numbering: "decimal",
    abstractPlacement: "front",
    abstractLabel: "Abstract",
    keywordsLabel: "Keywords",
    figureLabel: "Figure",
    tableLabel: "Table",
    equationNumbers: true,
    lineHeight: "1.3",
    textAlign: "left",
  },
};

/** Built-in paper styles, keyed by name. */
export const paperThemes: Record<string, Theme> = {
  normal: normalTheme,
  ieee: ieeeTheme,
  acm: acmTheme,
  arxiv: arxivTheme,
  lncs: lncsTheme,
  apa: apaTheme,
  journal: journalTheme,
};

/** One-line description of each built-in style, for docs and `--list-styles`. */
export const paperStyleSummaries: Record<string, string> = {
  normal: "Clean single column, no section numbers.",
  ieee: "Two columns, Times, roman-numbered sections (IEEE look).",
  acm: "Two columns, Libertine and sans headings, wide abstract (ACM look).",
  arxiv: "One column, title between rules, numbered sections (arXiv/NeurIPS look).",
  lncs: "One narrow column, small type, run-in abstract (Springer LNCS look).",
  apa: "Times 12pt, double spaced, centered headings (APA 7 look).",
  journal: "Two columns, sans headings, boxed abstract (modern journal look).",
};

/** The built-in paper style names. */
export function paperStyleNames(): string[] {
  return Object.keys(paperThemes);
}

/**
 * Apply `\documentclass[...]` flags to a theme. This is how one style can be
 * adjusted without defining a new one: `\documentclass[onecolumn, a4paper]{ieee}`.
 * Unknown flags are ignored here; the parser has already warned about them.
 */
export function applyPaperOptions(theme: Theme, options: string[]): Theme {
  if (options.length === 0) return theme;
  const paper: ThemePaper = { ...theme.paper };
  const page = { ...theme.page };
  const fontSizes = { ...theme.fontSizes };
  for (const option of options) {
    switch (option.toLowerCase()) {
      case "onecolumn":
        paper.columns = 1;
        break;
      case "twocolumn":
        paper.columns = 2;
        break;
      case "a4paper":
        page.size = "A4";
        page.maxWidth = "210mm";
        break;
      case "letterpaper":
        page.size = "Letter";
        page.maxWidth = "8.5in";
        break;
      case "10pt":
      case "11pt":
      case "12pt":
        fontSizes.base = option.toLowerCase();
        break;
      case "numbered":
        if (!paper.numbering || paper.numbering === "none") paper.numbering = "decimal";
        break;
      case "nonumbers":
        paper.numbering = "none";
        break;
    }
  }
  // Page and font flags alone must not turn an ordinary document into a paper.
  const isPaper = theme.paper !== undefined || Object.keys(paper).length > 0;
  return { ...theme, ...(isPaper ? { paper } : {}), page, fontSizes };
}
