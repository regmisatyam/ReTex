import type { Node } from "../types/ast.js";
import { childrenOf } from "./walk.js";

/**
 * Best-effort extraction of the plain-text content of a node or node list.
 * Used to derive section titles, contact values, and accessible labels, and
 * by `keyval`/`list` argument parsing.
 */
export function flattenText(input: Node | Node[]): string {
  const nodes = Array.isArray(input) ? input : [input];
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out += node.value;
        break;
      case "linebreak":
        out += " ";
        break;
      case "parbreak":
        out += "\n\n";
        break;
      case "url":
        out += node.href;
        break;
      case "icon":
        out += "";
        break;
      case "code":
      case "codeblock":
        out += node.value;
        break;
      case "math":
        out += node.tex;
        break;
      case "image":
        out += node.alt;
        break;
      case "cite":
        out += `[${node.keys.join(", ")}]`;
        break;
      case "footnote":
        break;
      default:
        out += flattenText(childrenOf(node));
    }
  }
  return out;
}

/** Collapse internal runs of whitespace and trim — useful for titles/labels. */
export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
