import { modernTheme, classicTheme, compactTheme } from "../theme/themes.js";
import { paperThemes, paperStyleSummaries } from "../theme/papers.js";
import { colorCommands } from "./colors.js";
import { fontCommands } from "./fonts.js";
import { shapeCommands } from "./shapes.js";
import type { Theme } from "../types/theme.js";
import type { ReTeXLibrary } from "./types.js";

/**
 * Theme packs bundle a complete styled look *and* the full styling toolkit
 * (color, font, and shape commands), so importing one gives you a polished
 * document plus everything needed to customize it further.
 */
const stylingCommands = [...colorCommands, ...fontCommands, ...shapeCommands];

/** `\usepackage{modern}` — accent-forward look with underlined headings. */
export const modernLibrary: ReTeXLibrary = {
  name: "modern",
  summary: "A modern, accent-forward theme (violet, underlined headings).",
  theme: modernTheme,
  commands: stylingCommands,
};

/** `\usepackage{classic}` — restrained serif look for academic CVs. */
export const classicLibrary: ReTeXLibrary = {
  name: "classic",
  summary: "A classic serif theme with ruled section headings.",
  theme: classicTheme,
  commands: stylingCommands,
};

/** `\usepackage{compact}` — dense, single-accent look. */
export const compactLibrary: ReTeXLibrary = {
  name: "compact",
  summary: "A compact, single-accent theme maximizing content density.",
  theme: compactTheme,
  commands: stylingCommands,
};

/**
 * Build a paper style from a theme. A paper style is an ordinary library, so it
 * can be chosen with `\\documentclass{name}` or `\\usepackage{name}`, and custom
 * ones plug in through `engine.provideLibrary(...)`.
 */
export function createPaperStyle(theme: Theme, summary?: string): ReTeXLibrary {
  return {
    name: theme.name,
    summary: summary ?? `The "${theme.name}" paper style.`,
    theme,
    commands: stylingCommands,
  };
}

/** Every built-in paper style, keyed by name. */
export const paperLibraries: Record<string, ReTeXLibrary> = Object.fromEntries(
  Object.entries(paperThemes).map(([name, theme]) => [
    name,
    createPaperStyle(theme, paperStyleSummaries[name]),
  ]),
);
