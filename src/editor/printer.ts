import type { Node, DocumentNode, FieldMap } from "../types/index.js";
import { isBlockNode } from "../renderers/context.js";

/** Escape characters that are structurally significant in ReTeX text. */
function escapeText(value: string): string {
  return (
    value
      // `\\\\` would be a line break, so a literal backslash has its own command.
      .replace(/[{}\\]/g, (c) => (c === "\\" ? "\\textbackslash{}" : `\\${c}`))
      // `%%` would start a comment, so each of its percent signs is escaped too.
      .replace(/%%/g, "\\%\\%")
  );
}

/** Escape a value printed inside a verbatim `\code{...}` argument. */
function escapeCode(value: string): string {
  return value.replace(/[{}\\%]/g, "\\$&");
}

/** A `[` straight after `\begin{env}` would otherwise read as its options. */
function protectLeadingBracket(body: string): string {
  return body.startsWith("[") ? `\\${body}` : body;
}

function printEnvironment(name: string, body: string, indent: string, options = ""): string {
  const safe = protectLeadingBracket(body);
  // Indenting would alter any code or equation nested in the body.
  const inner = /\\begin\{(code|verbatim|equation)/.test(safe)
    ? safe
    : indentLines(safe, indent + "  ");
  return `${indent}\\begin{${name}}${options}\n${inner}\n${indent}\\end{${name}}`;
}

/** Verbatim bodies are printed as they are: indenting them would change them. */
function printVerbatim(name: string, value: string, indent: string, options = ""): string {
  return `${indent}\\begin{${name}}${options}\n${value}\n\\end{${name}}`;
}

function fieldsToString(fields: FieldMap): string {
  return Object.entries(fields)
    .map(([k, v]) => (v === "" ? escapeRaw(k) : `${escapeRaw(k)}=${escapeRaw(v)}`))
    .join(", ");
}

/**
 * Escape a value printed inside a raw argument (a URL, a keyword, an author field).
 * Those are read without parsing markup, but still have to find their closing brace.
 */
function escapeRaw(value: string): string {
  return value
    .replace(/[{}[\]\\]/g, (c) => (c === "\\" ? "\\textbackslash{}" : `\\${c}`))
    .replace(/%%/g, "\\%\\%");
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
    case "section": {
      const command =
        ["section", "subsection", "subsubsection", "paragraph"][node.level - 1] ?? "section";
      const star = node.unnumbered ? "*" : "";
      const title = node.children ? printInline(node.children) : escapeText(node.title);
      return `${indent}\\${command}${star}{${title}}`;
    }
    case "list": {
      const env = node.kind;
      const items = node.items
        .map((it) => `${indent}  \\item ${printItemBody(it.children, `${indent}  `)}`)
        .join("\n");
      const options = node.start !== undefined ? `[start=${node.start}]` : "";
      return `${indent}\\begin{${env}}${options}\n${items}\n${indent}\\end{${env}}`;
    }
    case "abstract":
      return printEnvironment("abstract", printBlocks(node.children), indent);
    case "quote":
      return printEnvironment("quote", printBlocks(node.children), indent);
    case "keywords":
      return `${indent}\\keywords{${node.items.map(escapeRaw).join(", ")}}`;
    case "author": {
      const { name, ...rest } = node.fields;
      const nameOnly = Object.keys(rest).length === 0 && !name?.includes(",");
      return `${indent}\\author{${nameOnly ? escapeRaw(name ?? "") : fieldsToString(node.fields)}}`;
    }
    case "codeblock": {
      // Fall back to the other environment if the code quotes this one's end tag.
      const name = node.value.includes("\\end{code}") ? "verbatim" : "code";
      const options = node.language ? `[${escapeRaw(node.language)}]` : "";
      return printVerbatim(name, node.value, indent, options);
    }
    case "math":
      if (node.display) {
        return printVerbatim(
          node.numbered === false ? "equation*" : "equation",
          node.tex,
          indent,
        );
      }
      return `${indent}${printNode(node)}`;
    case "caption":
      return `${indent}\\caption{${printInline(node.children).trim()}}`;
    case "figure": {
      const body = node.children
        .map((child) => printBlock(child))
        .join("\n");
      return printEnvironment(node.wide ? "figure*" : "figure", body, indent);
    }
    case "table": {
      const lines: string[] = [];
      if (node.caption) lines.push(printBlock(node.caption));
      for (const row of node.rows) lines.push(printBlock(row));
      const align = node.align.map((a) => a[0]).join(", ");
      return printEnvironment(
        node.wide ? "table*" : "table",
        lines.join("\n"),
        indent,
        align ? `[${align}]` : "",
      );
    }
    case "row": {
      const cells = node.cells.map((c) => `{${printInline(c.children)}}`).join("");
      return `${indent}\\${node.header ? "head" : "row"}${cells}`;
    }
    case "references": {
      const items = node.items
        .map((it) => `\\bibitem{${escapeRaw(it.key)}} ${printInline(it.children).trim()}`)
        .join("\n");
      return printEnvironment("references", items, indent);
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
      return `${indent}\\skills{${node.items.map(escapeRaw).join(", ")}}`;
    case "usepackage":
      return indent + printUsePackage(node);
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

/** Print a list item: its text inline, with any nested blocks on their own lines. */
function printItemBody(nodes: Node[], indent: string): string {
  let out = "";
  let inline: Node[] = [];
  const flush = (): void => {
    out += printInline(inline).trim();
    inline = [];
  };
  for (const node of nodes) {
    if (isBlockNode(node)) {
      flush();
      out += `\n${printBlock(node, indent)}\n${indent}`;
    } else {
      inline.push(node);
    }
  }
  flush();
  return out.trimEnd();
}

/** Print nodes as inline content. */
function printInline(nodes: Node[]): string {
  // Neighbouring text must be escaped as one: `%` next to `%` would start a comment.
  let out = "";
  let text = "";
  for (const node of nodes) {
    if (node.type === "text") {
      text += node.value;
    } else {
      out += escapeText(text) + printNode(node);
      text = "";
    }
  }
  return out + escapeText(text);
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
    case "sub":
      return `\\textsubscript{${printInline(node.children)}}`;
    case "sup":
      return `\\textsuperscript{${printInline(node.children)}}`;
    case "code":
      return `\\code{${escapeCode(node.value)}}`;
    case "math":
      if (node.display) return printBlock(node);
      return `\\math{${node.tex}}`;
    case "image": {
      const options: string[] = [];
      if (node.width) options.push(`width=${escapeRaw(node.width)}`);
      if (node.alt) options.push(`alt=${escapeRaw(node.alt)}`);
      const bracket = options.length > 0 ? `[${options.join(", ")}]` : "";
      return `\\includegraphics${bracket}{${escapeRaw(node.rawSrc)}}`;
    }
    case "footnote":
      return `\\footnote{${printInline(node.children)}}`;
    case "cite":
      return `\\cite{${node.keys.map(escapeRaw).join(", ")}}`;
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
      return `\\href{${escapeRaw(node.rawHref)}}{${printInline(node.children)}}`;
    case "url":
      return `\\url{${escapeRaw(node.rawHref)}}`;
    case "icon":
      return `\\icon{${node.name}}`;
    case "usepackage":
      return printUsePackage(node);
    case "contact": {
      // `\\title` parses its content; the other contact fields are raw.
      const value = node.children
        ? printInline(node.children)
        : node.field === "title"
          ? escapeText(node.value)
          : escapeRaw(node.value);
      return `\\${node.field}${node.icon ? "-icon" : ""}{${value}}`;
    }
    case "space":
      return `\\${node.axis === "vertical" ? "vspace" : "hspace"}{${node.size}}`;
    case "command": {
      const args = node.args
        .map((a) => (a.raw !== undefined ? `{${a.raw}}` : `{${printInline(a.children)}}`))
        .join("");
      return `\\${node.name}${args}`;
    }
    // Block nodes appearing in inline context fall back to block printing.
    case "section":
    case "list":
    case "columns":
    case "job":
    case "education":
    case "project":
    case "skills":
    case "rule":
    case "abstract":
    case "keywords":
    case "author":
    case "codeblock":
    case "quote":
    case "caption":
    case "figure":
    case "table":
    case "row":
    case "references":
      return printBlock(node);
    // The rest only exist inside a parent, which prints them. Recovery nodes have
    // no source form. Without this, an unknown node would recurse forever.
    default:
      return "";
  }
}

function printUsePackage(node: Extract<Node, { type: "usepackage" }>): string {
  if (!node.documentClass) return `\\usepackage{${node.names.join(", ")}}`;
  const options = node.options?.length ? `[${node.options.join(", ")}]` : "";
  return `\\documentclass${options}{${node.names.join(", ")}}`;
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
