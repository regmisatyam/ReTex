import {
  isParent,
  type Node,
  type ParentNode,
  type ListNode,
  type ColumnsNode,
  type TableNode,
  type TableRowNode,
  type ReferencesNode,
} from "../types/ast.js";

/** Return the child nodes of any node, regardless of where they're stored. */
export function childrenOf(node: Node): Node[] {
  if (node.type === "list") return (node as ListNode).items;
  if (node.type === "columns") return (node as ColumnsNode).columns;
  if (node.type === "row") return (node as TableRowNode).cells;
  if (node.type === "references") return (node as ReferencesNode).items;
  if (node.type === "table") {
    const { caption, rows } = node as TableNode;
    return caption ? [caption, ...rows] : rows;
  }
  if (isParent(node)) return (node as ParentNode).children;
  return [];
}

export interface VisitOptions {
  /** Called before visiting children. Return `false` to skip the subtree. */
  enter?: (node: Node, parent: Node | null) => boolean | void;
  /** Called after visiting children. */
  exit?: (node: Node, parent: Node | null) => void;
}

/** Depth-first traversal of the tree. */
export function walk(root: Node, opts: VisitOptions): void {
  const visit = (node: Node, parent: Node | null): void => {
    const descend = opts.enter ? opts.enter(node, parent) : undefined;
    if (descend !== false) {
      for (const child of childrenOf(node)) visit(child, node);
    }
    opts.exit?.(node, parent);
  };
  visit(root, null);
}

/** Collect every node matching a predicate. */
export function collect(root: Node, pred: (n: Node) => boolean): Node[] {
  const out: Node[] = [];
  walk(root, {
    enter(n) {
      if (pred(n)) out.push(n);
    },
  });
  return out;
}

/** Find the innermost node whose range contains `offset`, plus its ancestors. */
export function nodePathAt(root: Node, offset: number): Node[] {
  const path: Node[] = [];
  const visit = (node: Node): boolean => {
    const r = node.range;
    if (r && (offset < r.start.offset || offset > r.end.offset)) return false;
    path.push(node);
    for (const child of childrenOf(node)) {
      if (visit(child)) break;
    }
    return true;
  };
  visit(root);
  return path;
}
