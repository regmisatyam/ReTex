import type { Theme } from "../types/theme.js";

/**
 * The default ReTeX theme is **blank** — it defines no colors, fonts, sizes, or
 * section decoration. A document rendered with it is a clean, browser-default
 * page: black text, the user agent's default font, plain section headings, and
 * no accent colors or rules. This is "just simple editing".
 *
 * Visual styling is opt-in. Import a library to populate this theme:
 *
 *  - `\usepackage{fonts}`  / `engine.use(fontsLibrary)`  — fonts & sizes
 *  - `\usepackage{shapes}` / `engine.use(shapesLibrary)` — rules, dividers, spacing
 *  - `\usepackage{colors}` / `engine.use(colorsLibrary)` — text color & palettes
 *  - `\usepackage{modern}` / `engine.use(modernTheme)`   — a full styled look
 *
 * Every renderer treats theme values as optional and substitutes a neutral,
 * unstyled fallback when a field is absent, so the blank theme always produces
 * a readable document.
 */
export const blankTheme: Theme = {
  name: "blank",
};

/** Alias kept for backwards compatibility — the default theme is the blank one. */
export const defaultTheme: Theme = blankTheme;
