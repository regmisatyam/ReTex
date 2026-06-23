import {
  DiagnosticSeverity,
  DiagnosticCode,
  type Diagnostic,
  type Node,
  type DocumentNode,
  type Theme,
} from "../types/index.js";
import { walk } from "../ast/walk.js";

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

  walk(ast, {
    enter(node) {
      switch (node.type) {
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
  }
}
