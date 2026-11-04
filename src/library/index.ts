/**
 * ReTeX libraries — opt-in bundles of styling capability layered over the blank
 * core. Activate them from a document (`\usepackage{colors}`) or from code
 * (`engine.use(colorsLibrary)`).
 */

export type { ReTeXLibrary } from "./types.js";

export { colorsLibrary, colorCommands, palettes } from "./colors.js";
export {
  fontsLibrary,
  fontCommands,
  fontStacks,
  fontTheme,
} from "./fonts.js";
export { shapesLibrary, shapeCommands } from "./shapes.js";
export {
  modernLibrary,
  classicLibrary,
  compactLibrary,
  paperLibraries,
  createPaperStyle,
} from "./themes.js";

export {
  builtinLibraries,
  builtinLibraryNames,
  getBuiltinLibrary,
  resolveLibraryName,
  GATED_COMMANDS,
  applyLibraries,
  mergeLibraryTheme,
  collectLibraryOverrides,
  libraryDiagnostics,
  usedLibraryNamesFromTokens,
  usedLibraryNamesFromAst,
  usedDocumentOptions,
} from "./registry.js";
export type { LibraryLookup, AppliedLibraries } from "./registry.js";
