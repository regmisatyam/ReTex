import type { Node, Theme } from "../types/index.js";

/** Node types that participate in block (vertical) flow. */
export const BLOCK_TYPES = new Set<string>([
  "section",
  "job",
  "education",
  "project",
  "skills",
  "list",
  "columns",
  "rule",
  "abstract",
  "keywords",
  "author",
  "codeblock",
  "quote",
  "caption",
  "figure",
  "table",
  "references",
]);

export function isBlockNode(node: Node): boolean {
  if (BLOCK_TYPES.has(node.type)) return true;
  if (node.type === "space") return node.axis === "vertical";
  if (node.type === "math") return node.display;
  if (node.type === "command" && node.name === "center") return true;
  return false;
}

/**
 * Plugin HTML renderer. Receives the node, the active context, and a callback
 * to recursively render child nodes to HTML.
 */
export type HtmlRenderFn = (
  node: Node,
  ctx: HtmlRenderContext,
  renderChildren: (nodes: Node[]) => string,
) => string;

export interface HtmlRenderContext {
  theme: Theme;
  classPrefix: string;
  /** Override renderers keyed by node `type` or `command:<name>`. */
  overrides: Map<string, HtmlRenderFn>;
  /** Render arbitrary inline/block nodes to an HTML string. */
  renderNodes: (nodes: Node[]) => string;
  cls: (name: string) => string;
}

/** A target-agnostic, serializable element used by the React renderer. */
export interface ReactElementSpec {
  type: string;
  props: Record<string, unknown>;
  children: Array<ReactElementSpec | string>;
}
