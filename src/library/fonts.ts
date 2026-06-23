import type {
  CommandDefinition,
  Position,
  SourceRange,
  ThemeFonts,
} from "../types/index.js";
import { DiagnosticSeverity, DiagnosticCode } from "../types/diagnostics.js";
import { isSafeDimension } from "../security/sanitize.js";
import type { ReTeXLibrary } from "./types.js";

const zero: Position = { offset: 0, line: 1, column: 1 };
const ZERO_RANGE: SourceRange = { start: zero, end: zero };

const scaleSwitch = (
  name: string,
  scale: "small" | "large" | "Large" | "Huge",
): CommandDefinition => ({
  name,
  category: "switch",
  scoped: true,
  summary: `Set the font size to "${name}" for the rest of the group.`,
  example: `{\\${name} ...}`,
  build: ({ scope }) => ({ type: "fontscale", scale, children: scope }),
});

/**
 * Commands provided by the `fonts` library: explicit family/size control
 * (`\fontfamily`, `\fontsize`), the relative size switches (`\small`, `\large`,
 * `\Large`, `\Huge`, `\normalsize`), and the monospace switch (`\ttfamily`).
 */
export const fontCommands: CommandDefinition[] = [
  {
    name: "fontsize",
    category: "inline",
    args: [
      { kind: "string", name: "size", format: "dimension" },
      { kind: "content", name: "content" },
    ],
    summary: "Set an explicit font size for the wrapped content.",
    example: "\\fontsize{14pt}{Custom Size}",
    build: ({ args, utils, report }) => {
      const size = utils.textOf(args[0]).trim();
      if (size && !isSafeDimension(size)) {
        report({
          severity: DiagnosticSeverity.Warning,
          code: DiagnosticCode.InvalidDimension,
          message: `"${size}" is not a valid dimension.`,
          range: args[0]?.range ?? ZERO_RANGE,
        });
      }
      return {
        type: "fontsize",
        size: isSafeDimension(size) ? size : "1em",
        children: args[1]?.children ?? [],
      };
    },
  },
  {
    name: "fontfamily",
    category: "inline",
    args: [
      { kind: "string", name: "family" },
      { kind: "content", name: "content" },
    ],
    summary: "Set the font family for the wrapped content.",
    example: "\\fontfamily{Georgia}{Serif text}",
    build: ({ args, utils }) => ({
      type: "fontfamily",
      family: utils.textOf(args[0]).trim() || "inherit",
      children: args[1]?.children ?? [],
    }),
  },
  scaleSwitch("small", "small"),
  scaleSwitch("large", "large"),
  scaleSwitch("Large", "Large"),
  scaleSwitch("Huge", "Huge"),
  {
    name: "normalsize",
    category: "switch",
    scoped: true,
    summary: "Reset the font size to the document base size.",
    build: ({ scope }) => ({ type: "fontscale", scale: "normal", children: scope }),
  },
  {
    name: "ttfamily",
    category: "switch",
    scoped: true,
    summary: "Switch to a monospace font for the rest of the group.",
    build: ({ scope }) => ({
      type: "fontfamily",
      family: "monospace",
      children: scope,
    }),
  },
];

/**
 * A catalog of vetted font stacks. Use a key as a `\fontfamily` argument, or
 * build a `fonts` theme patch with {@link fontTheme}.
 */
export const fontStacks: Record<string, string> = {
  inter: '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  helvetica: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  georgia: 'Georgia, "Times New Roman", Times, serif',
  times: '"Times New Roman", Times, serif',
  garamond: '"EB Garamond", Garamond, Georgia, serif',
  spaceGrotesk: '"Space Grotesk", system-ui, sans-serif',
  sourceSerif: '"Source Serif 4", Georgia, serif',
  jetbrainsMono: '"JetBrains Mono", "SF Mono", "Fira Code", Consolas, monospace',
  firaCode: '"Fira Code", "JetBrains Mono", Consolas, monospace',
  ibmPlexMono: '"IBM Plex Mono", "SF Mono", Consolas, monospace',
};

/**
 * Build a `fonts` theme patch from named {@link fontStacks} (or raw CSS stacks).
 *
 * ```ts
 * new ReTeXEngine({ theme: { fonts: fontTheme({ heading: "spaceGrotesk", body: "inter" }) } });
 * ```
 */
export function fontTheme(spec: Partial<Record<keyof ThemeFonts, string>>): ThemeFonts {
  const resolve = (v?: string): string | undefined =>
    v == null ? undefined : (fontStacks[v] ?? v);
  return {
    heading: resolve(spec.heading),
    body: resolve(spec.body),
    mono: resolve(spec.mono),
  };
}

/**
 * The `fonts` library — font family/size control plus a stack catalog.
 *
 * ```ts
 * engine.use(fontsLibrary);            // or \usepackage{fonts}
 * engine.toHtml("{\\large \\fontfamily{Georgia}{Hi}}");
 * ```
 */
export const fontsLibrary: ReTeXLibrary = {
  name: "fonts",
  summary: "Font family & size control (\\fontfamily, \\fontsize, \\small … \\Huge).",
  commands: fontCommands,
};
