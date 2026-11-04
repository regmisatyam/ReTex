import {
  DiagnosticSeverity,
  DiagnosticCode,
  type Diagnostic,
  type Node,
  type DocumentNode,
  type Theme,
} from "../types/index.js";
import { walk, collect } from "../ast/walk.js";
import { texToMathML } from "../math/index.js";

export interface ValidateOptions {
  /** When provided, `\themecolor{token}` tokens are checked against it. */
  theme?: Theme;
}

const ZERO_RANGE = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

/**
 * Stage 3 of the pipeline. Semantic validation over the AST, complementing the
 * syntactic diagnostics produced by the parser. Pure and side-effect free.
 */
export function validate(ast: DocumentNode, options: ValidateOptions = {}): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const report = (d: Omit<Diagnostic, "source">): void => {
    diagnostics.push({ ...d, source: "validator" });
  };

  const bibKeys = new Set(
    collect(ast, (n) => n.type === "bibitem").map((n) =>
      n.type === "bibitem" ? n.key : "",
    ),
  );

  walk(ast, {
    enter(node, parent) {
      switch (node.type) {
        case "math":
          for (const problem of texToMathML(node.tex).errors) {
            report({
              severity: DiagnosticSeverity.Warning,
              code: DiagnosticCode.UnsupportedMath,
              message: `Formula "${node.tex.slice(0, 60)}": ${problem}`,
              range: node.range ?? ZERO_RANGE,
            });
          }
          break;
        case "cite":
          for (const key of node.keys) {
            if (bibKeys.has(key)) continue;
            report({
              severity: DiagnosticSeverity.Warning,
              code: DiagnosticCode.UnknownCitation,
              message: `\\cite{${key}} has no matching \\bibitem{${key}}.`,
              range: node.range ?? ZERO_RANGE,
            });
          }
          break;
        case "row":
          if (parent?.type !== "table") {
            report({
              severity: DiagnosticSeverity.Error,
              code: DiagnosticCode.CommandOutsideContext,
              message: "\\row and \\head must appear inside a table environment.",
              range: node.range ?? ZERO_RANGE,
            });
          }
          break;
        case "command":
          checkStrayCommand(node, report);
          break;
        case "section":
          if (node.title.trim() === "") {
            report({
              severity: DiagnosticSeverity.Warning,
              code: DiagnosticCode.EmptyArgument,
              message: "Section heading is empty.",
              range: node.range ?? ZERO_RANGE,
            });
          }
          break;
        case "contact":
          if (node.value.trim() === "") {
            report({
              severity: DiagnosticSeverity.Warning,
              code: DiagnosticCode.EmptyArgument,
              message: `\\${node.field} is empty.`,
              range: node.range ?? ZERO_RANGE,
            });
          }
          break;
        case "themecolor":
          if (options.theme?.colors && !(node.token in options.theme.colors)) {
            report({
              severity: DiagnosticSeverity.Warning,
              code: DiagnosticCode.UnknownThemeColor,
              message: `Theme color "${node.token}" is not defined in theme "${options.theme.name}".`,
              range: node.range ?? ZERO_RANGE,
            });
          }
          break;
        case "skills":
          if (node.items.length === 0) {
            report({
              severity: DiagnosticSeverity.Info,
              code: DiagnosticCode.EmptyArgument,
              message: "\\skills has no entries.",
              range: node.range ?? ZERO_RANGE,
            });
          }
          break;
      }
    },
  });

  return diagnostics;
}

/**
 * `\item` and `\column` only become typed list/column nodes when they appear
 * inside their environment. Any that survive as raw command nodes are
 * therefore out of context.
 */
function checkStrayCommand(
  node: Extract<Node, { type: "command" }>,
  report: (d: Omit<Diagnostic, "source">) => void,
): void {
  if (node.name === "item") {
    report({
      severity: DiagnosticSeverity.Error,
      code: DiagnosticCode.CommandOutsideContext,
      message: "\\item must appear inside an itemize or enumerate environment.",
      range: node.range ?? ZERO_RANGE,
    });
  } else if (node.name === "column") {
    report({
      severity: DiagnosticSeverity.Error,
      code: DiagnosticCode.CommandOutsideContext,
      message: "\\column must appear inside a columns environment.",
      range: node.range ?? ZERO_RANGE,
    });
  } else if (node.name === "bibitem") {
    report({
      severity: DiagnosticSeverity.Error,
      code: DiagnosticCode.CommandOutsideContext,
      message: "\\bibitem must appear inside a references environment.",
      range: node.range ?? ZERO_RANGE,
    });
  }
}
