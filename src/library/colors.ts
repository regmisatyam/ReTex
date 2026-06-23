import type {
  CommandDefinition,
  Position,
  SourceRange,
  ThemeColors,
} from "../types/index.js";
import { DiagnosticSeverity, DiagnosticCode } from "../types/diagnostics.js";
import { isSafeColor } from "../security/sanitize.js";
import type { ReTeXLibrary } from "./types.js";

const zero: Position = { offset: 0, line: 1, column: 1 };
const ZERO_RANGE: SourceRange = { start: zero, end: zero };

/**
 * Commands provided by the `colors` library: `\textcolor` (an explicit
 * hex/named color) and `\themecolor` (a swatch from the active theme). Both
 * produce core AST nodes, so the standard renderers display them once the
 * library is active.
 */
export const colorCommands: CommandDefinition[] = [
  {
    name: "textcolor",
    category: "inline",
    args: [
      { kind: "string", name: "color", format: "color" },
      { kind: "content", name: "content" },
    ],
    summary: "Color text with a hex/named color.",
    example: "\\textcolor{#2563eb}{OpenAI}",
    build: ({ args, utils, report }) => {
      const color = utils.textOf(args[0]).trim();
      if (color && !isSafeColor(color)) {
        report({
          severity: DiagnosticSeverity.Warning,
          code: DiagnosticCode.InvalidColor,
          message: `"${color}" is not a recognized color; it will be ignored.`,
          range: args[0]?.range ?? ZERO_RANGE,
        });
      }
      return {
        type: "color",
        color: isSafeColor(color) ? color : "",
        children: args[1]?.children ?? [],
      };
    },
  },
  {
    name: "themecolor",
    category: "inline",
    args: [
      { kind: "string", name: "token" },
      { kind: "content", name: "content" },
    ],
    summary: "Color text using a token from the active theme.",
    example: "\\themecolor{primary}{Highlighted}",
    build: ({ args, utils }) => ({
      type: "themecolor",
      token: utils.textOf(args[0]).trim() || "primary",
      children: args[1]?.children ?? [],
    }),
  },
];

/**
 * A catalog of ready-made color palettes. Apply one as a theme patch, e.g.
 * `new ReTeXEngine({ theme: { colors: palettes.violet } })`, or reference its
 * swatches from `\themecolor{...}` once `colors` is active.
 */
export const palettes: Record<string, ThemeColors> = {
  slate: {
    primary: "#0f172a",
    secondary: "#475569",
    text: "#1e293b",
    muted: "#64748b",
    border: "#cbd5e1",
    accent: "#0f172a",
  },
  blue: {
    primary: "#2563eb",
    secondary: "#64748b",
    text: "#1e293b",
    muted: "#64748b",
    border: "#e2e8f0",
    accent: "#2563eb",
  },
  violet: {
    primary: "#7c3aed",
    secondary: "#6b7280",
    text: "#111827",
    muted: "#6b7280",
    border: "#e5e7eb",
    accent: "#7c3aed",
  },
  emerald: {
    primary: "#059669",
    secondary: "#6b7280",
    text: "#111827",
    muted: "#6b7280",
    border: "#d1fae5",
    accent: "#059669",
  },
  rose: {
    primary: "#e11d48",
    secondary: "#6b7280",
    text: "#111827",
    muted: "#6b7280",
    border: "#fecdd3",
    accent: "#e11d48",
  },
  amber: {
    primary: "#d97706",
    secondary: "#6b7280",
    text: "#111827",
    muted: "#6b7280",
    border: "#fde68a",
    accent: "#d97706",
  },
};

/**
 * The `colors` library — text color commands plus a palette catalog.
 *
 * ```ts
 * engine.use(colorsLibrary);          // or \usepackage{colors}
 * engine.toHtml("\\textcolor{#7c3aed}{Hi}");
 * ```
 */
export const colorsLibrary: ReTeXLibrary = {
  name: "colors",
  summary: "Text color (\\textcolor, \\themecolor) and named palettes.",
  commands: colorCommands,
};
