import type { CommandDefinition, RuleNode } from "../types/index.js";
import type { ReTeXLibrary } from "./types.js";

const rule = (
  name: string,
  style: RuleNode["style"],
  summary: string,
): CommandDefinition => ({
  name,
  category: "block",
  summary,
  example: `\\${name}`,
  build: () => (style ? { type: "rule", style } : { type: "rule" }),
});

/**
 * Commands provided by the `shapes` library: horizontal rules / dividers in a
 * few styles, plus explicit spacing. All produce core AST nodes.
 */
export const shapeCommands: CommandDefinition[] = [
  rule("hrule", "solid", "A horizontal rule / divider."),
  rule("divider", "solid", "A horizontal rule / divider."),
  rule("dashrule", "dashed", "A dashed horizontal rule."),
  rule("dotrule", "dotted", "A dotted horizontal rule."),
  rule("thickrule", "thick", "A thick horizontal rule."),
  rule("doublerule", "double", "A double horizontal rule."),
  {
    name: "vspace",
    category: "block",
    args: [{ kind: "string", name: "size", format: "dimension" }],
    summary: "Vertical space.",
    example: "\\vspace{1em}",
    build: ({ args, utils }) => ({
      type: "space",
      axis: "vertical",
      size: utils.textOf(args[0]).trim() || "1em",
    }),
  },
  {
    name: "hspace",
    category: "inline",
    args: [{ kind: "string", name: "size", format: "dimension" }],
    summary: "Horizontal space.",
    example: "\\hspace{1em}",
    build: ({ args, utils }) => ({
      type: "space",
      axis: "horizontal",
      size: utils.textOf(args[0]).trim() || "1em",
    }),
  },
];

/**
 * The `shapes` library — rules, dividers, and spacing.
 *
 * ```ts
 * engine.use(shapesLibrary);           // or \usepackage{shapes}
 * engine.toHtml("\\hrule \\dashrule \\vspace{1em}");
 * ```
 */
export const shapesLibrary: ReTeXLibrary = {
  name: "shapes",
  summary: "Horizontal rules / dividers (\\hrule, \\dashrule, …) and spacing.",
  commands: shapeCommands,
};
