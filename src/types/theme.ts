/**
 * Theme model. Themes are plain data so they can be serialized, shipped over
 * the wire, edited in a GUI, or composed at runtime. {@link resolveTheme}
 * (see `src/theme`) deep-merges a partial theme over the default.
 *
 * ReTeX is **blank by default**: the built-in theme defines no colors, fonts,
 * sizes, or section decoration — every field is optional and may be left
 * `undefined`, yielding a plain, browser-default document. Visual styling is
 * opt-in: importing a library (`fonts`, `shapes`, `colors`, or a theme pack
 * like `modern`) populates these fields. Renderers therefore treat every theme
 * value as optional and fall back to a neutral, unstyled default when absent.
 */

export interface ThemeColors {
  /** Brand / accent color used for links, section rules, highlights. */
  primary?: string;
  /** Muted secondary color for meta text (dates, locations). */
  secondary?: string;
  /** Default body text color. */
  text?: string;
  /** De-emphasized text color. */
  muted?: string;
  /** Page background. */
  background?: string;
  /** Hairline / border color. */
  border?: string;
  /** Arbitrary named swatches usable via `\themecolor{name}`. */
  [token: string]: string | undefined;
}

export interface ThemeFonts {
  /** Font stack for headings (`\name`, `\section`). */
  heading?: string;
  /** Font stack for body text. */
  body?: string;
  /** Monospace stack (code, technical skills). */
  mono?: string;
}

export interface ThemeFontSizes {
  /** Base body size, e.g. `"11pt"`. */
  base?: string;
  small?: string;
  large?: string;
  Large?: string;
  Huge?: string;
  /** `\name` size. */
  name?: string;
  /** `\section` heading size. */
  section?: string;
}

export interface ThemeSpacing {
  /** Vertical rhythm unit. */
  unit?: string;
  section?: string;
  item?: string;
  /** Page padding when rendering a full document. */
  page?: string;
}

export interface ThemePage {
  /** CSS page size keyword or dimensions, e.g. `"A4"` or `"8.5in 11in"`. */
  size?: string;
  /** A CSS margin: one to four dimensions, e.g. `"1in"` or `"0.75in 0.625in 1in"`. */
  margin?: string;
  /** Max content width for screen preview. */
  maxWidth?: string;
}

/**
 * Section / name heading decoration. Drives the few decorative properties that
 * are otherwise neutral in a blank document (uppercasing, letter-spacing). All
 * optional — when absent, headings render plainly.
 */
export interface ThemeHeadings {
  /** `text-transform` for `\section` titles (e.g. `"uppercase"`). */
  transform?: string;
  /** `letter-spacing` for `\section` titles. */
  tracking?: string;
  /** `letter-spacing` for the `\name` heading. */
  nameTracking?: string;
}

/**
 * How a theme lays out a research paper. Its presence is what switches a document
 * into paper layout: a front matter block above a column-flowing body, automatic
 * numbering, and figure and table labels. Everything here is plain data, vetted
 * before it reaches the stylesheet.
 */
export interface ThemePaper {
  /** Text columns per page. Default 1. */
  columns?: 1 | 2;
  /** Gap between columns. */
  columnGap?: string;
  /**
   * Built-in look to build on: `normal`, `ieee`, `acm`, `arxiv`, `lncs`, `apa`,
   * `journal`. Also emitted as the class `retex-paper--<variant>` for custom CSS.
   */
  variant?: string;
  /** `ieee` numbers sections I., A., 1); `decimal` numbers them 1, 1.1, 1.1.1. */
  numbering?: "none" | "decimal" | "ieee";
  /** Put the abstract above the columns (`front`) or inside them (`column`). */
  abstractPlacement?: "front" | "column";
  abstractLabel?: string;
  keywordsLabel?: string;
  figureLabel?: string;
  tableLabel?: string;
  /** Number display equations (1), (2), … at the right margin. */
  equationNumbers?: boolean;
  lineHeight?: string;
  /** Text alignment of body paragraphs. */
  textAlign?: "left" | "justify";
}

export interface Theme {
  name: string;
  colors?: ThemeColors;
  fonts?: ThemeFonts;
  fontSizes?: ThemeFontSizes;
  spacing?: ThemeSpacing;
  page?: ThemePage;
  /** Section heading style hint consumed by renderers. */
  sectionStyle?: "underline" | "rule" | "plain" | "bar";
  /** Optional decorative heading tweaks (uppercasing, tracking). */
  headings?: ThemeHeadings;
  /** Research-paper layout. Absent for ordinary documents. */
  paper?: ThemePaper;
}

/** A user-supplied theme override; everything is optional and deep-merged. */
export type PartialTheme = {
  name?: string;
  colors?: ThemeColors;
  fonts?: ThemeFonts;
  fontSizes?: ThemeFontSizes;
  spacing?: ThemeSpacing;
  page?: ThemePage;
  sectionStyle?: Theme["sectionStyle"];
  headings?: ThemeHeadings;
  paper?: ThemePaper;
};
