import type { ReTeXPlugin } from "../plugin/types.js";

/**
 * A ReTeX **library** — a named, opt-in bundle of styling capability.
 *
 * ReTeX's core is deliberately blank: it ships document structure and basic
 * emphasis only. Libraries add the rest. A library is just a {@link ReTeXPlugin}
 * with a stable `name` so it can be activated two ways:
 *
 *  - declaratively, from the document: `\usepackage{colors}`
 *  - programmatically, from code: `engine.use(colorsLibrary)`
 *
 * Built-in libraries: `fonts`, `shapes`, `colors`, and the theme packs `modern`,
 * `classic`, `compact`. Custom libraries can be registered with
 * `engine.provideLibrary(lib)` (available to `\usepackage`) or installed
 * globally with `engine.use(lib)`.
 */
export interface ReTeXLibrary extends ReTeXPlugin {
  name: string;
  /** One-line description, surfaced in docs and diagnostics. */
  summary?: string;
}
