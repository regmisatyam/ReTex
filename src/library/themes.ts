import { modernTheme, classicTheme, compactTheme } from "../theme/themes.js";
import { colorCommands } from "./colors.js";
import { fontCommands } from "./fonts.js";
import { shapeCommands } from "./shapes.js";
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
