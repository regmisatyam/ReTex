import type { Node, DocumentNode, FieldMap } from "../types/index.js";
import { isBlockNode } from "../renderers/context.js";

/** Escape characters that are structurally significant in ReTeX text. */
function escapeText(value: string): string {
  return value.replace(/([{}\\])/g, "\\$1");
}

function fieldsToString(fields: FieldMap): string {
  return Object.entries(fields)
    .map(([k, v]) => (v === "" ? k : `${k}=${v}`))
    .join(", ");
}

/**
 * Serialize an AST back into canonical ReTeX source. Used by the formatter and
 * for round-trip testing. Inline content is printed compactly; block content is
 * separated by blank lines and environments are indented.
 */
export function printDocument(ast: DocumentNode): string {
  return printBlocks(ast.children).trimEnd() + "\n";
}

/** Print a list of nodes as block flow (blank-line separated where needed). */
function printBlocks(nodes: Node[]): string {
  const out: string[] = [];
  let inline: Node[] = [];
  const flush = (): void => {
    const s = printInline(inline).trim();
    if (s) out.push(s);
    inline = [];
  };
  for (const node of nodes) {
    if (node.type === "parbreak") {
      flush();
    } else if (
      isBlockNode(node) ||
      node.type === "section" ||
      node.type === "list" ||
      node.type === "columns" ||
      node.type === "usepackage"
    ) {
      flush();
      out.push(printBlock(node));
    } else {
      inline.push(node);
    }
  }
  flush();
  return out.join("\n\n");
}

function printBlock(node: Node, indent = ""): string {
  switch (node.type) {
    case "section":
      return `${indent}\\${node.level === 2 ? "subsection" : "section"}{${node.title}}`;
    case "list": {
      const env = node.kind;
      const items = node.items
        .map((it) => `${indent}  \\item ${printInline(it.children).trim()}`)
        .join("\n");
      return `${indent}\\begin{${env}}\n${items}\n${indent}\\end{${env}}`;
    }
    case "columns": {
      const cols = node.columns
        .map(
          (c) =>
            `${indent}  \\column{${c.width}}\n${indentLines(printBlocks(c.children), indent + "  ")}`,
        )
        .join("\n");
      return `${indent}\\begin{columns}\n${cols}\n${indent}\\end{columns}`;
    }
    case "job":
    case "education":
    case "project": {
      const head = `${indent}\\${node.type}{${fieldsToString(node.fields)}}`;
      if (node.children.length === 0) return head;
      return `${head}{${printInline(node.children).trim()}}`;
    }
    case "skills":
      return `${indent}\\skills{${node.items.join(", ")}}`;
    case "usepackage":
      return `${indent}\\usepackage{${node.names.join(", ")}}`;
    case "rule":
      return indent + ruleCommand(node.style);
    case "space":
      return `${indent}\\${node.axis === "vertical" ? "vspace" : "hspace"}{${node.size}}`;
    case "command":
      if (node.name === "center") {
        const inner = node.args.flatMap((a) => a.children);
        return `${indent}\\begin{center}\n${indentLines(printBlocks(inner), indent + "  ")}\n${indent}\\end{center}`;
      }
      return indent + printInline([node]);
    default:
      return indent + printInline([node]);
  }
}

/** Print nodes as inline content. */
function printInline(nodes: Node[]): string {
  return nodes.map(printNode).join("");
}

function printNode(node: Node): string {
  switch (node.type) {
    case "text":
      return escapeText(node.value);
    case "parbreak":
      return "\n\n";
    case "linebreak":
      return "\\\\";
    case "group":
      return `{${printInline(node.children)}}`;
    case "bold":
      return `\\textbf{${printInline(node.children)}}`;
    case "italic":
      return `\\textit{${printInline(node.children)}}`;
    case "underline":
      return `\\underline{${printInline(node.children)}}`;
    case "strike":
      return `\\sout{${printInline(node.children)}}`;
    case "color":
      return `\\textcolor{${node.color}}{${printInline(node.children)}}`;
    case "themecolor":
      return `\\themecolor{${node.token}}{${printInline(node.children)}}`;
    case "fontsize":
      return `\\fontsize{${node.size}}{${printInline(node.children)}}`;
    case "fontfamily":
      return `\\fontfamily{${node.family}}{${printInline(node.children)}}`;
    case "fontscale":
      return `{\\${node.scale === "normal" ? "normalsize" : node.scale} ${printInline(node.children)}}`;
    case "link":
      return `\\href{${node.rawHref}}{${printInline(node.children)}}`;
    case "url":
      return `\\url{${node.rawHref}}`;
    case "icon":
      return `\\icon{${node.name}}`;
    case "usepackage":
      return `\\usepackage{${node.names.join(", ")}}`;
    case "contact":
      return `\\${node.field}{${node.value}}`;
    case "space":
      return `\\${node.axis === "vertical" ? "vspace" : "hspace"}{${node.size}}`;
    case "command": {
      const args = node.args
        .map((a) => (a.raw !== undefined ? `{${a.raw}}` : `{${printInline(a.children)}}`))
        .join("");
      return `\\${node.name}${args}`;
    }
    // Block nodes appearing in inline context fall back to block printing.
    default:
      return printBlock(node);
  }
}

/** Map a rule's style back to the command that produces it. */
function ruleCommand(style: string | undefined): string {
  switch (style) {
    case "dashed":
      return "\\dashrule";
    case "dotted":
      return "\\dotrule";
    case "thick":
      return "\\thickrule";
    case "double":
      return "\\doublerule";
    default:
      return "\\hrule";
  }
}

function indentLines(text: string, indent: string): string {
  return text
    .split("\n")
    .map((line) => (line ? indent + line : line))
    .join("\n");
}
