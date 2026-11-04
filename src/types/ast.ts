import type { SourceRange } from "./source.js";

/**
 * The ReTeX Abstract Syntax Tree.
 *
 * Every node is a member of the {@link Node} discriminated union keyed on
 * `type`. Nodes fall into three broad families:
 *
 *  - **Structural** — {@link DocumentNode}, {@link GroupNode}, {@link ParBreakNode}.
 *  - **Inline / typography** — text, marks (bold/italic/…), links, icons.
 *  - **Resume semantics** — sections, jobs, education, skills, contact fields.
 *
 * Unknown or plugin-provided commands are preserved as {@link CommandNode} so
 * the tree is always a faithful, loss-less representation of the source and can
 * be re-rendered by custom renderers.
 */

export interface NodeBase {
  type: string;
  /** Source span this node was produced from. Synthetic nodes may omit it. */
  range?: SourceRange;
  /**
   * Stable structural hash used by the incremental compiler / render cache.
   * Populated lazily; never authored by hand.
   */
  hash?: string;
}

/* ------------------------------------------------------------------ */
/* Structural nodes                                                    */
/* ------------------------------------------------------------------ */

export interface DocumentNode extends NodeBase {
  type: "document";
  children: Node[];
}

/** A literal run of text. */
export interface TextNode extends NodeBase {
  type: "text";
  value: string;
}

/** A paragraph break (one or more blank lines). */
export interface ParBreakNode extends NodeBase {
  type: "parbreak";
}

/** An explicit line break (`\\` or `\newline`). */
export interface LineBreakNode extends NodeBase {
  type: "linebreak";
}

/** A horizontal rule / divider (`\hrule`, `\divider`, and the `shapes` library's
 * styled variants like `\dashrule`). */
export interface RuleNode extends NodeBase {
  type: "rule";
  /** Visual style. Defaults to a thin solid line when omitted. */
  style?: "solid" | "dashed" | "dotted" | "thick" | "double";
}

/** Spacing primitive (`\vspace{1em}` / `\hspace{...}`). */
export interface SpaceNode extends NodeBase {
  type: "space";
  axis: "horizontal" | "vertical";
  size: string;
}

/** A bare `{ ... }` group. Mostly used to scope font switches. */
export interface GroupNode extends NodeBase {
  type: "group";
  children: Node[];
}

/**
 * `\usepackage{shapes, colors}` — a preamble directive that imports one or more
 * styling libraries for the document. Produces no visible output; the engine
 * reads these to register the libraries' commands and merge their theme.
 */
export interface UsePackageNode extends NodeBase {
  type: "usepackage";
  names: string[];
  /** Written as `\documentclass{...}` rather than `\usepackage{...}`. */
  documentClass?: boolean;
  /** `\documentclass[twocolumn, a4paper]{...}` flags, in source order. */
  options?: string[];
}

/* ------------------------------------------------------------------ */
/* Typography / inline marks                                           */
/* ------------------------------------------------------------------ */

export type MarkType = "bold" | "italic" | "underline" | "strike" | "sub" | "sup";

/** Simple wrapping mark such as `\textbf{...}`. */
export interface MarkNode extends NodeBase {
  type: MarkType;
  children: Node[];
}

/** `\textcolor{#hex|name}{...}` */
export interface ColorNode extends NodeBase {
  type: "color";
  color: string;
  children: Node[];
}

/** `\themecolor{primary}{...}` — color resolved from the active theme. */
export interface ThemeColorNode extends NodeBase {
  type: "themecolor";
  token: string;
  children: Node[];
}

/** `\fontsize{14pt}{...}` */
export interface FontSizeNode extends NodeBase {
  type: "fontsize";
  size: string;
  children: Node[];
}

/** `\fontfamily{Inter}{...}` */
export interface FontFamilyNode extends NodeBase {
  type: "fontfamily";
  family: string;
  children: Node[];
}

/** Relative size switch: `\small`, `\large`, `\Large`, `\Huge`. */
export type FontScale = "small" | "normal" | "large" | "Large" | "Huge";
export interface FontScaleNode extends NodeBase {
  type: "fontscale";
  scale: FontScale;
  /** Content the switch applies to (rest of the enclosing group). */
  children: Node[];
}

/* ------------------------------------------------------------------ */
/* Hyperlinks & icons                                                  */
/* ------------------------------------------------------------------ */

/** `\href{url}{label}` */
export interface LinkNode extends NodeBase {
  type: "link";
  /** Sanitized, render-safe URL. */
  href: string;
  /** Original, unsanitized URL (kept for diagnostics / round-tripping). */
  rawHref: string;
  children: Node[];
}

/** `\url{url}` — renders the URL as its own label. */
export interface UrlNode extends NodeBase {
  type: "url";
  href: string;
  rawHref: string;
}

/** `\icon{github}` */
export interface IconNode extends NodeBase {
  type: "icon";
  name: string;
}

/* ------------------------------------------------------------------ */
/* Sections & lists                                                    */
/* ------------------------------------------------------------------ */

export interface SectionNode extends NodeBase {
  type: "section";
  /** Plain-text title (always present, even when {@link children} is set). */
  title: string;
  /** 1 = `\section`, 2 = `\subsection`, 3 = `\subsubsection`, 4 = `\paragraph`. */
  level: number;
  /** Rich title content. Only set when the title has non-text inline markup. */
  children?: Node[];
  /** `\section*` — never receives an automatic number. */
  unnumbered?: boolean;
}

export type ListKind = "itemize" | "enumerate";

export interface ListNode extends NodeBase {
  type: "list";
  kind: ListKind;
  items: ListItemNode[];
  /** First number of an `enumerate` list, when it does not start at 1. */
  start?: number;
}

export interface ListItemNode extends NodeBase {
  type: "item";
  children: Node[];
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export interface ColumnsNode extends NodeBase {
  type: "columns";
  columns: ColumnNode[];
  /** Gap between columns, e.g. `"1.5rem"`. */
  gap?: string;
}

export interface ColumnNode extends NodeBase {
  type: "column";
  /** Width as authored (`"40%"`, `"200px"`, `"2fr"`). */
  width: string;
  children: Node[];
}

/* ------------------------------------------------------------------ */
/* Resume / CV semantics                                               */
/* ------------------------------------------------------------------ */

export type ContactField =
  | "name"
  | "title"
  | "email"
  | "phone"
  | "location"
  | "website"
  | "date";

/** One of the single-value header commands (`\name`, `\email`, …). */
export interface ContactNode extends NodeBase {
  type: "contact";
  field: ContactField;
  value: string;
  /**
   * Whether to render the field's leading icon. Icons are opt-in: the plain
   * command (`\email{…}`) renders no icon, while its `-icon` variant
   * (`\email-icon{…}`) sets this so the renderer prepends the glyph.
   */
  icon?: boolean;
  /** Rich content for `\title`. Only set when it has non-text inline markup. */
  children?: Node[];
}

/** Parsed `key=value` map preserving per-field source ranges. */
export interface FieldMap {
  [key: string]: string;
}

/** `\job{title=…, company=…, …}{ body }` */
export interface JobNode extends NodeBase {
  type: "job";
  fields: FieldMap;
  children: Node[];
}

/** `\education{school=…, degree=…, …}{ body? }` */
export interface EducationNode extends NodeBase {
  type: "education";
  fields: FieldMap;
  children: Node[];
}

/** `\project{name=…, …}{ body? }` */
export interface ProjectNode extends NodeBase {
  type: "project";
  fields: FieldMap;
  children: Node[];
}

/** `\skills{a, b, c}` */
export interface SkillsNode extends NodeBase {
  type: "skills";
  items: string[];
}

/* ------------------------------------------------------------------ */
/* Paper semantics                                                     */
/* ------------------------------------------------------------------ */

/** `\author{name=…, affiliation=…, email=…}` */
export interface AuthorNode extends NodeBase {
  type: "author";
  fields: FieldMap;
}

/** `\begin{abstract} … \end{abstract}` */
export interface AbstractNode extends NodeBase {
  type: "abstract";
  children: Node[];
}

/** `\keywords{a, b, c}` */
export interface KeywordsNode extends NodeBase {
  type: "keywords";
  items: string[];
}

/** `\code{…}` — inline verbatim code. */
export interface InlineCodeNode extends NodeBase {
  type: "code";
  value: string;
}

/** `\begin{code}[python] … \end{code}` / `\begin{verbatim} … \end{verbatim}` */
export interface CodeBlockNode extends NodeBase {
  type: "codeblock";
  value: string;
  language?: string;
}

/** `\math{…}` (inline) or `\begin{equation} … \end{equation}` (display). */
export interface MathNode extends NodeBase {
  type: "math";
  /** The TeX source of the formula, exactly as written. */
  tex: string;
  display: boolean;
  /** `false` for `equation*`: never numbered, whatever the paper style says. */
  numbered?: boolean;
}

/** `\begin{quote} … \end{quote}` */
export interface QuoteNode extends NodeBase {
  type: "quote";
  children: Node[];
}

/** `\includegraphics[width=80%]{url}` */
export interface ImageNode extends NodeBase {
  type: "image";
  /** Sanitized, render-safe URL. */
  src: string;
  /** Original, unsanitized URL (kept for diagnostics / round-tripping). */
  rawSrc: string;
  alt: string;
  width?: string;
}

/** `\caption{…}` inside a figure or table. */
export interface CaptionNode extends NodeBase {
  type: "caption";
  children: Node[];
}

/** `\begin{figure} … \end{figure}`; `wide` comes from `figure*`. */
export interface FigureNode extends NodeBase {
  type: "figure";
  children: Node[];
  /** Span every column of a multi-column layout. */
  wide?: boolean;
}

export type TableAlign = "left" | "center" | "right";

/** One cell of a {@link TableRowNode}. */
export interface TableCellNode extends NodeBase {
  type: "cell";
  children: Node[];
}

/** `\row{a}{b}{c}` or, for a header row, `\head{a}{b}{c}`. */
export interface TableRowNode extends NodeBase {
  type: "row";
  cells: TableCellNode[];
  header?: boolean;
}

/** `\begin{table}[l, c, r] … \end{table}`; `wide` comes from `table*`. */
export interface TableNode extends NodeBase {
  type: "table";
  rows: TableRowNode[];
  /** Per-column alignment. Columns past the end of this list use the default. */
  align: TableAlign[];
  caption?: CaptionNode;
  wide?: boolean;
}

/** `\footnote{…}` */
export interface FootnoteNode extends NodeBase {
  type: "footnote";
  children: Node[];
}

/** `\cite{a, b}` */
export interface CiteNode extends NodeBase {
  type: "cite";
  keys: string[];
}

/** `\bibitem{key} …` inside a {@link ReferencesNode}. */
export interface BibItemNode extends NodeBase {
  type: "bibitem";
  key: string;
  children: Node[];
}

/** `\begin{references} \bibitem{key} … \end{references}` */
export interface ReferencesNode extends NodeBase {
  type: "references";
  items: BibItemNode[];
}

/* ------------------------------------------------------------------ */
/* Generic / extensibility / recovery                                  */
/* ------------------------------------------------------------------ */

/** A parsed argument attached to a generic {@link CommandNode}. */
export interface ArgumentNode {
  kind: "required" | "optional";
  /** Parsed children for `content` arguments. */
  children: Node[];
  /** Raw text for `string`/verbatim arguments. */
  raw?: string;
  range?: SourceRange;
}

/**
 * A command the core does not model natively — including every
 * plugin-registered command and any unknown command encountered during
 * lenient parsing. Keeps the tree loss-less.
 */
export interface CommandNode extends NodeBase {
  type: "command";
  name: string;
  args: ArgumentNode[];
}

/** A placeholder emitted during error recovery so rendering can continue. */
export interface ErrorNode extends NodeBase {
  type: "error";
  message: string;
  /** The raw source that could not be parsed. */
  raw: string;
}

/* ------------------------------------------------------------------ */
/* Union & helpers                                                     */
/* ------------------------------------------------------------------ */

export type Node =
  | DocumentNode
  | TextNode
  | ParBreakNode
  | LineBreakNode
  | RuleNode
  | SpaceNode
  | GroupNode
  | UsePackageNode
  | MarkNode
  | ColorNode
  | ThemeColorNode
  | FontSizeNode
  | FontFamilyNode
  | FontScaleNode
  | LinkNode
  | UrlNode
  | IconNode
  | SectionNode
  | ListNode
  | ListItemNode
  | ColumnsNode
  | ColumnNode
  | ContactNode
  | JobNode
  | EducationNode
  | ProjectNode
  | SkillsNode
  | AuthorNode
  | AbstractNode
  | KeywordsNode
  | InlineCodeNode
  | CodeBlockNode
  | MathNode
  | QuoteNode
  | ImageNode
  | CaptionNode
  | FigureNode
  | TableCellNode
  | TableRowNode
  | TableNode
  | FootnoteNode
  | CiteNode
  | BibItemNode
  | ReferencesNode
  | CommandNode
  | ErrorNode;

export type NodeType = Node["type"];

/** Map from node `type` to its concrete interface, for typed visitors. */
export interface NodeMap {
  document: DocumentNode;
  text: TextNode;
  parbreak: ParBreakNode;
  linebreak: LineBreakNode;
  rule: RuleNode;
  space: SpaceNode;
  group: GroupNode;
  usepackage: UsePackageNode;
  bold: MarkNode;
  italic: MarkNode;
  underline: MarkNode;
  strike: MarkNode;
  sub: MarkNode;
  sup: MarkNode;
  color: ColorNode;
  themecolor: ThemeColorNode;
  fontsize: FontSizeNode;
  fontfamily: FontFamilyNode;
  fontscale: FontScaleNode;
  link: LinkNode;
  url: UrlNode;
  icon: IconNode;
  section: SectionNode;
  list: ListNode;
  item: ListItemNode;
  columns: ColumnsNode;
  column: ColumnNode;
  contact: ContactNode;
  job: JobNode;
  education: EducationNode;
  project: ProjectNode;
  skills: SkillsNode;
  author: AuthorNode;
  abstract: AbstractNode;
  keywords: KeywordsNode;
  code: InlineCodeNode;
  codeblock: CodeBlockNode;
  math: MathNode;
  quote: QuoteNode;
  image: ImageNode;
  caption: CaptionNode;
  figure: FigureNode;
  cell: TableCellNode;
  row: TableRowNode;
  table: TableNode;
  footnote: FootnoteNode;
  cite: CiteNode;
  bibitem: BibItemNode;
  references: ReferencesNode;
  command: CommandNode;
  error: ErrorNode;
}

/** Nodes that carry a `children: Node[]` array. */
export type ParentNode = Extract<Node, { children: Node[] }>;

export function isParent(node: Node): node is ParentNode {
  return Array.isArray((node as { children?: unknown }).children);
}

/** Type guard generator for a given node type. */
export function isNode<T extends NodeType>(node: Node, type: T): node is NodeMap[T] {
  return node.type === type;
}
