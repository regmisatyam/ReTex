import {
  type Node,
  type DocumentNode,
  type SectionNode,
  type Theme,
  type ThemePaper,
  type ListNode,
  type ColumnsNode,
  type CommandNode,
} from "../types/index.js";
import { resolveTheme } from "../theme/themes.js";
import {
  sanitizeUrl,
  sanitizeImageUrl,
  isSafeColor,
  isSafeDimension,
  sanitizeStyleValue,
} from "../security/sanitize.js";
import { iconToSvg } from "../icons/icons.js";
import { texToMathML } from "../math/index.js";
import { themeToCss } from "./css.js";
import { paperRootClasses } from "./paper-css.js";
import { isBlockNode } from "./context.js";
import {
  toRegions,
  splitPreamble,
  splitPaperFront,
  entryParts,
  authorDetails,
  bibliographyNumbers,
  equationFit,
} from "./structure.js";

/**
 * Minimal structural type for a JSX factory (React.createElement, Preact's `h`,
 * etc.). Declaring it locally means the package has **no** hard React
 * dependency — callers pass whichever factory they use.
 */
export type JsxFactory = (
  type: unknown,
  props: Record<string, unknown> | null,
  ...children: unknown[]
) => unknown;

/** A React render override keyed by node `type` or `command:<name>`. */
export type ReactRenderFn = (
  node: Node,
  ctx: ReactRenderContext,
  renderChildren: (nodes: Node[]) => unknown[],
) => unknown;

export interface ReactRenderContext {
  theme: Theme;
  classPrefix: string;
  h: JsxFactory;
  Fragment: unknown;
  overrides: Map<string, ReactRenderFn>;
  renderNodes: (nodes: Node[]) => unknown[];
  cls: (name: string) => string;
}

export interface ReactRenderOptions {
  /** JSX factory. Required. Pass `React.createElement`. */
  createElement: JsxFactory;
  /** Fragment component. Pass `React.Fragment`. Falls back to a `<div>`. */
  Fragment?: unknown;
  theme?: Theme;
  classPrefix?: string;
  overrides?: Map<string, ReactRenderFn>;
  header?: boolean;
}

const tokenSafe = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, "");

/**
 * The React renderer. Produces a React element tree mirroring the HTML
 * renderer's structure and class names, so the same theme stylesheet applies.
 */
export class ReactRenderer {
  private readonly theme: Theme;
  private readonly prefix: string;
  private readonly h: JsxFactory;
  private readonly Fragment: unknown;
  private readonly overrides: Map<string, ReactRenderFn>;
  private readonly useHeader: boolean;
  private key = 0;
  /** Number of each `\bibitem` key, for resolving `\cite`. */
  private bibNumbers = new Map<string, number>();
  /** Footnote bodies met so far, rendered together at the end of the document. */
  private footnotes: Node[][] = [];

  constructor(options: ReactRenderOptions) {
    if (typeof options.createElement !== "function") {
      throw new TypeError(
        "ReactRenderer requires a `createElement` factory (e.g. React.createElement).",
      );
    }
    // Normalize so every theme sub-object is defined (the theme may be blank).
    this.theme = resolveTheme(options.theme);
    this.prefix = options.classPrefix ?? "retex";
    this.h = options.createElement;
    this.Fragment = options.Fragment ?? "div";
    this.overrides = options.overrides ?? new Map();
    this.useHeader = options.header ?? true;
  }

  /** The stylesheet for the active theme. Render it in a `<style>` yourself. */
  styles(): string {
    return themeToCss(this.theme, this.prefix);
  }

  /** Render the document AST to a React element. */
  render(ast: DocumentNode): unknown {
    this.bibNumbers = bibliographyNumbers(ast);
    this.footnotes = [];
    if (this.theme.paper) return this.renderPaper(ast, this.theme.paper);

    const regions = toRegions(ast.children);
    const parts: unknown[] = [];
    const preamble = regions[0]?.section ? undefined : regions.shift();
    if (preamble) parts.push(...this.renderPreamble(preamble.nodes));
    for (const region of regions) {
      if (region.section) parts.push(this.renderSection(region.section, region.nodes));
      else parts.push(...this.renderFlow(region.nodes));
    }
    const notes = this.renderFootnotes();
    if (notes) parts.push(notes);
    return this.el("div", { className: this.cls("resume") }, parts);
  }

  /** A research paper: front matter above, then the body that flows into columns. */
  private renderPaper(ast: DocumentNode, paper: ThemePaper): unknown {
    const regions = toRegions(ast.children);
    const preamble = regions.shift()!;
    const front = splitPaperFront(preamble.nodes);

    const head: unknown[] = [];
    if (front.title) {
      const title = front.title;
      head.push(
        this.el(
          "h1",
          { className: this.cls("paper-title") },
          title.children ? this.renderInline(title.children) : [title.value],
        ),
      );
    }
    if (front.authors.length > 0) {
      head.push(
        this.el(
          "div",
          { className: this.cls("authors") },
          front.authors.map((a) => this.renderAuthor(a)),
        ),
      );
    }
    if (front.contacts.length > 0) {
      head.push(
        this.el(
          "div",
          { className: this.cls("contact") },
          front.contacts.map((c) => this.renderNode(c)),
        ),
      );
    }
    if (front.date) {
      head.push(this.el("p", { className: this.cls("paper-date") }, [front.date.value]));
    }

    const summary = [...front.abstracts, ...front.keywords].map((n) => this.renderNode(n));
    const inColumn = paper.abstractPlacement === "column";

    const body: unknown[] = [];
    if (inColumn) body.push(...summary);
    body.push(...this.renderFlow(front.rest));
    for (const region of regions) {
      if (region.section) body.push(this.renderSection(region.section, region.nodes));
      else body.push(...this.renderFlow(region.nodes));
    }
    const notes = this.renderFootnotes();
    if (notes) body.push(notes);

    const frontChildren = inColumn ? head : [...head, ...summary];
    const className = [
      this.cls("resume"),
      ...paperRootClasses(paper, this.prefix),
    ].join(" ");
    return this.el("article", { className }, [
      frontChildren.length > 0
        ? this.el("header", { className: this.cls("paper-front") }, frontChildren)
        : null,
      this.el("div", { className: this.cls("paper-body") }, body),
    ]);
  }

  private renderAuthor(node: Extract<Node, { type: "author" }>): unknown {
    const { fields } = node;
    const children: unknown[] = [];
    if (fields.name) {
      children.push(this.el("span", { className: this.cls("author-name") }, [fields.name]));
    }
    for (const detail of authorDetails(fields)) {
      children.push(this.el("span", { className: this.cls("author-detail") }, [detail]));
    }
    if (fields.email) {
      children.push(
        this.contactLink(`mailto:${fields.email}`, "", fields.email, this.cls("author-email")),
      );
    }
    return this.el("div", { className: this.cls("author") }, children);
  }

  /** The numbered notes collected while rendering, as a closing block. */
  private renderFootnotes(): unknown {
    if (this.footnotes.length === 0) return null;
    const items: unknown[] = [];
    // A footnote can itself contain a footnote, so the list may grow as we go.
    for (let i = 0; i < this.footnotes.length; i++) {
      const n = i + 1;
      items.push(
        this.el("li", { id: `${this.prefix}-fn-${n}` }, [
          ...this.renderFlow(this.footnotes[i]!),
          " ",
          this.el(
            "a",
            {
              className: this.cls("footnote-back"),
              href: `#${this.prefix}-fnref-${n}`,
              "aria-label": "Back to text",
            },
            ["↩\ufe0e"],
          ),
        ]),
      );
    }
    return this.el("section", { className: this.cls("footnotes") }, [
      this.el("ol", null, items),
    ]);
  }

  private ctx(): ReactRenderContext {
    return {
      theme: this.theme,
      classPrefix: this.prefix,
      h: this.h,
      Fragment: this.Fragment,
      overrides: this.overrides,
      renderNodes: (nodes) => this.renderFlow(nodes),
      cls: (name) => this.cls(name),
    };
  }

  /* --------------------------- structuring ---------------------------- */

  private renderSection(section: SectionNode, body: Node[]): unknown {
    const className = [
      this.cls("section"),
      this.theme.sectionStyle ? `${this.cls("section")}--${this.theme.sectionStyle}` : "",
      section.unnumbered ? `${this.cls("section")}--unnumbered` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return this.el(
      "section",
      {
        className,
      },
      [
        this.el(
          "h2",
          { className: this.cls("section-title") },
          this.sectionTitle(section),
        ),
        this.el("div", { className: this.cls("section-body") }, this.renderFlow(body)),
      ],
    );
  }

  private sectionTitle(section: SectionNode): unknown[] {
    return section.children ? this.renderInline(section.children) : [section.title];
  }

  private renderPreamble(nodes: Node[]): unknown[] {
    if (!this.useHeader) return this.renderFlow(nodes);
    const { name, title, contacts, other } = splitPreamble(nodes);
    const out: unknown[] = [];
    if (name || title || contacts.length > 0) {
      const head: unknown[] = [];
      if (name) head.push(this.el("h1", { className: this.cls("name") }, [name.value]));
      if (title) head.push(this.el("p", { className: this.cls("title") }, [title.value]));
      if (contacts.length > 0) {
        head.push(
          this.el(
            "div",
            { className: this.cls("contact") },
            contacts.map((c) => this.renderNode(c)),
          ),
        );
      }
      out.push(this.el("header", { className: this.cls("header") }, head));
    }
    if (other.length > 0) out.push(...this.renderFlow(other));
    return out;
  }

  /* ----------------------------- flow / inline ------------------------ */

  private renderFlow(nodes: Node[]): unknown[] {
    const out: unknown[] = [];
    let inline: Node[] = [];
    const flush = (): void => {
      if (inline.length === 0) return;
      const meaningful = inline.some((n) => n.type !== "text" || n.value.trim() !== "");
      if (meaningful) {
        out.push(
          this.el("p", { className: this.cls("para") }, this.renderInline(inline)),
        );
      }
      inline = [];
    };
    for (const node of nodes) {
      if (node.type === "parbreak") flush();
      else if (isBlockNode(node)) {
        flush();
        out.push(this.renderNode(node));
      } else inline.push(node);
    }
    flush();
    return out;
  }

  private renderInline(nodes: Node[]): unknown[] {
    return nodes.map((n) => this.renderNode(n));
  }

  /* ------------------------------ per node ---------------------------- */

  private renderNode(node: Node): unknown {
    const override =
      this.overrides.get(node.type) ??
      (node.type === "command" ? this.overrides.get(`command:${node.name}`) : undefined);
    if (override) return override(node, this.ctx(), (ns) => this.renderFlow(ns));

    switch (node.type) {
      case "text":
        return node.value;
      case "parbreak":
        return null;
      case "usepackage":
        // A preamble directive — no visible output.
        return null;
      case "linebreak":
        return this.el("br", null, []);
      case "rule": {
        const variant =
          node.style && node.style !== "solid"
            ? ` ${this.cls(`rule--${node.style}`)}`
            : "";
        return this.el("hr", { className: `${this.cls("rule")}${variant}` }, []);
      }
      case "space":
        return node.axis === "vertical"
          ? this.el("div", { style: { height: this.dim(node.size) } }, [])
          : this.el(
              "span",
              { style: { display: "inline-block", width: this.dim(node.size) } },
              [],
            );
      case "group":
        return this.frag(this.renderInline(node.children));
      case "bold":
        return this.el("strong", null, this.renderInline(node.children));
      case "italic":
        return this.el("em", null, this.renderInline(node.children));
      case "underline":
        return this.el("u", null, this.renderInline(node.children));
      case "strike":
        return this.el("s", null, this.renderInline(node.children));
      case "sub":
        return this.el("sub", null, this.renderInline(node.children));
      case "sup":
        return this.el("sup", null, this.renderInline(node.children));
      case "code":
        return this.el("code", { className: this.cls("code") }, [node.value]);
      case "codeblock":
        return this.el("pre", { className: this.cls("codeblock") }, [
          this.el(
            "code",
            node.language ? { className: `language-${tokenSafe(node.language)}` } : null,
            [node.value],
          ),
        ]);
      case "math":
        return this.renderMath(node);
      case "quote":
        return this.el(
          "blockquote",
          { className: this.cls("quote") },
          this.renderFlow(node.children),
        );
      case "image":
        return this.renderImage(node);
      case "figure":
        return this.renderFigure(node);
      case "caption":
        return this.el(
          "figcaption",
          { className: this.cls("caption") },
          this.renderInline(node.children),
        );
      case "table":
        return this.renderTable(node);
      case "footnote": {
        const n = this.footnotes.push(node.children);
        return this.el("sup", { className: this.cls("footnote-ref") }, [
          this.el(
            "a",
            { id: `${this.prefix}-fnref-${n}`, href: `#${this.prefix}-fn-${n}` },
            [String(n)],
          ),
        ]);
      }
      case "cite":
        return this.renderCite(node);
      case "references":
        return this.renderReferences(node);
      case "abstract":
        return this.el("section", { className: this.cls("abstract") }, [
          this.el("h2", { className: this.cls("abstract-label") }, [
            this.theme.paper?.abstractLabel ?? "Abstract",
          ]),
          this.el(
            "div",
            { className: this.cls("abstract-body") },
            this.renderFlow(node.children),
          ),
        ]);
      case "keywords":
        return this.el("p", { className: this.cls("keywords") }, [
          this.el("span", { className: this.cls("keywords-label") }, [
            this.theme.paper?.keywordsLabel ?? "Keywords",
          ]),
          this.el("span", { className: this.cls("keywords-list") }, [
            node.items.join(", "),
          ]),
        ]);
      case "author":
        return this.renderAuthor(node);
      case "color": {
        const inner = this.renderInline(node.children);
        if (!node.color || !isSafeColor(node.color)) return this.frag(inner);
        return this.el("span", { style: { color: node.color } }, inner);
      }
      case "themecolor":
        return this.el(
          "span",
          {
            style: {
              color: `var(--${this.prefix}-color-${tokenSafe(node.token)}, currentColor)`,
            },
          },
          this.renderInline(node.children),
        );
      case "fontsize": {
        const inner = this.renderInline(node.children);
        if (!isSafeDimension(node.size)) return this.frag(inner);
        return this.el("span", { style: { fontSize: node.size } }, inner);
      }
      case "fontfamily": {
        const inner = this.renderInline(node.children);
        const family =
          node.family === "monospace"
            ? `var(--${this.prefix}-font-mono)`
            : sanitizeStyleValue(node.family);
        if (!family) return this.frag(inner);
        return this.el("span", { style: { fontFamily: family } }, inner);
      }
      case "fontscale":
        return node.scale === "normal"
          ? this.frag(this.renderInline(node.children))
          : this.el(
              "span",
              { className: this.cls(`scale-${node.scale}`) },
              this.renderInline(node.children),
            );
      case "link":
        return this.renderLink(node.href, this.renderInline(node.children));
      case "url":
        return this.renderLink(node.href, [node.rawHref]);
      case "icon":
        return this.renderIcon(node.name);
      case "section":
        return this.el(
          `h${node.level + 1}`,
          {
            className: node.unnumbered
              ? `${this.cls("subsection-title")} ${this.cls("subsection-title")}--unnumbered`
              : this.cls("subsection-title"),
          },
          this.sectionTitle(node),
        );
      case "list":
        return this.renderList(node);
      case "columns":
        return this.renderColumns(node);
      case "skills":
        return this.el(
          "ul",
          { className: this.cls("skills") },
          node.items.map((s) => this.el("li", { className: this.cls("skill") }, [s])),
        );
      case "job":
        return this.renderEntry(node, "job");
      case "education":
        return this.renderEntry(node, "education");
      case "project":
        return this.renderEntry(node, "project");
      case "contact":
        return this.renderContact(node);
      case "command":
        return this.renderCommand(node);
      default:
        return null;
    }
  }

  private renderContact(node: Extract<Node, { type: "contact" }>): unknown {
    const item = this.cls("contact-item");
    // Icons are opt-in: only the `-icon` command variants set `node.icon`.
    const icon = node.icon ? node.field : "";
    switch (node.field) {
      case "email":
        return this.contactLink(`mailto:${node.value}`, icon, node.value, item);
      case "phone":
        return this.contactLink(
          `tel:${node.value.replace(/[^\d+]/g, "")}`,
          icon,
          node.value,
          item,
        );
      case "website":
        return this.contactLink(node.value, icon, node.value, item);
      case "location":
        return this.el(
          "span",
          { className: item },
          icon ? [this.renderIcon("location"), node.value] : [node.value],
        );
      default:
        return this.el("span", { className: item }, [node.value]);
    }
  }

  private contactLink(url: string, icon: string, label: string, cls: string): unknown {
    const { safe } = sanitizeUrl(url);
    const children = icon ? [this.renderIcon(icon), label] : [label];
    return this.el("a", { className: cls, href: safe }, children);
  }

  private renderLink(href: string, label: unknown[]): unknown {
    const { safe } = sanitizeUrl(href);
    const external = /^https?:/i.test(safe);
    const props: Record<string, unknown> = { className: this.cls("link"), href: safe };
    if (external) {
      props.target = "_blank";
      props.rel = "noopener noreferrer";
    }
    return this.el("a", props, label);
  }

  private renderList(node: ListNode): unknown {
    const tag = node.kind === "enumerate" ? "ol" : "ul";
    const props: Record<string, unknown> = { className: this.cls("list") };
    if (node.start !== undefined) props.start = node.start;
    return this.el(
      tag,
      props,
      node.items.map((item) =>
        this.el(
          "li",
          null,
          // A multi-paragraph item needs real paragraphs; a simple one stays bare.
          item.children.some((n) => n.type === "parbreak")
            ? this.renderFlow(item.children)
            : this.renderInline(item.children),
        ),
      ),
    );
  }

  private renderMath(node: Extract<Node, { type: "math" }>): unknown {
    const { mathml } = texToMathML(node.tex, { display: node.display });
    // Same escape hatch as icons: the markup is generated, with all text escaped.
    if (!node.display) {
      return this.el(
        "span",
        { className: this.cls("math"), dangerouslySetInnerHTML: { __html: mathml } },
        [],
      );
    }
    const fit = equationFit(mathml, this.theme);
    const className = [
      this.cls("equation"),
      node.numbered === false ? "" : `${this.cls("equation")}--numbered`,
      fit.wide ? `${this.cls("equation")}--wide` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const props: Record<string, unknown> = {
      className,
      dangerouslySetInnerHTML: { __html: mathml },
    };
    if (fit.scale) props.style = { fontSize: `${fit.scale}em` };
    return this.el("div", props, []);
  }

  private renderImage(node: Extract<Node, { type: "image" }>): unknown {
    const { safe } = sanitizeImageUrl(node.src);
    if (!safe) return node.alt;
    const props: Record<string, unknown> = {
      className: this.cls("image"),
      src: safe,
      alt: node.alt,
    };
    if (node.width && isSafeDimension(node.width)) props.style = { width: node.width };
    return this.el("img", props, []);
  }

  private renderFigure(node: Extract<Node, { type: "figure" }>): unknown {
    const className = node.wide
      ? `${this.cls("figure")} ${this.cls("figure")}--wide`
      : this.cls("figure");
    return this.el(
      "figure",
      { className },
      node.children.flatMap((child) =>
        child.type === "image" || child.type === "caption"
          ? [this.renderNode(child)]
          : this.renderFlow([child]),
      ),
    );
  }

  private renderTable(node: Extract<Node, { type: "table" }>): unknown {
    const renderRows = (rows: typeof node.rows, tag: string): unknown[] =>
      rows.map((row) =>
        this.el(
          "tr",
          null,
          row.cells.map((c, column) => {
            const align = node.align[column];
            return this.el(
              tag,
              align && align !== "left" ? { style: { textAlign: align } } : null,
              this.renderInline(c.children),
            );
          }),
        ),
      );
    const head = node.rows.filter((r) => r.header);
    const body = node.rows.filter((r) => !r.header);
    const className = node.wide
      ? `${this.cls("table-wrap")} ${this.cls("table-wrap")}--wide`
      : this.cls("table-wrap");
    return this.el("div", { className }, [
      this.el("table", { className: this.cls("table") }, [
        node.caption
          ? this.el("caption", null, this.renderInline(node.caption.children))
          : null,
        head.length > 0 ? this.el("thead", null, renderRows(head, "th")) : null,
        this.el("tbody", null, renderRows(body, "td")),
      ]),
    ]);
  }

  private renderCite(node: Extract<Node, { type: "cite" }>): unknown {
    const parts: unknown[] = ["["];
    node.keys.forEach((key, i) => {
      if (i > 0) parts.push(", ");
      const n = this.bibNumbers.get(key);
      parts.push(
        n === undefined
          ? key
          : this.el("a", { href: `#${this.prefix}-ref-${n}` }, [String(n)]),
      );
    });
    parts.push("]");
    return this.el("span", { className: this.cls("cite") }, parts);
  }

  private renderReferences(node: Extract<Node, { type: "references" }>): unknown {
    return this.el(
      "ol",
      { className: this.cls("references") },
      node.items.map((item) => {
        const n = this.bibNumbers.get(item.key);
        return this.el("li", n !== undefined ? { id: `${this.prefix}-ref-${n}` } : null, [
          this.el("span", { className: this.cls("ref-label") }, [`[${n ?? item.key}]`]),
          this.el(
            "span",
            { className: this.cls("ref-body") },
            this.renderInline(item.children),
          ),
        ]);
      }),
    );
  }

  private renderColumns(node: ColumnsNode): unknown {
    return this.el(
      "div",
      { className: this.cls("columns") },
      node.columns.map((col) => {
        const basis = isSafeDimension(col.width) ? col.width : "auto";
        const style = basis === "auto" ? { flex: "1 1 0" } : { flex: `0 0 ${basis}` };
        return this.el(
          "div",
          { className: this.cls("column"), style },
          this.renderFlow(col.children),
        );
      }),
    );
  }

  private renderEntry(
    node: Extract<Node, { type: "job" | "education" | "project" }>,
    kind: string,
  ): unknown {
    const { title, subtitle, dates, location, url } = entryParts(node.fields, kind);
    const rows: unknown[] = [];
    const titleEl = url ? this.renderLink(sanitizeUrl(url).safe, [title]) : title;
    rows.push(
      this.el("div", { className: this.cls("entry-row") }, [
        this.el("span", { className: this.cls("entry-title") }, [titleEl]),
        dates ? this.el("span", { className: this.cls("entry-dates") }, [dates]) : null,
      ]),
    );
    if (subtitle || location) {
      rows.push(
        this.el("div", { className: this.cls("entry-row") }, [
          this.el("span", { className: this.cls("entry-subtitle") }, [subtitle]),
          location
            ? this.el("span", { className: this.cls("entry-location") }, [location])
            : null,
        ]),
      );
    }
    if (node.children.length > 0) {
      rows.push(
        this.el(
          "div",
          { className: this.cls("entry-body") },
          this.renderFlow(node.children),
        ),
      );
    }
    return this.el("div", { className: `${this.cls("entry")} ${this.cls(kind)}` }, rows);
  }

  private renderCommand(node: CommandNode): unknown {
    const inner = node.args.flatMap((a) => a.children);
    if (node.name === "center") {
      return this.el("div", { className: this.cls("center") }, this.renderFlow(inner));
    }
    return this.frag(this.renderInline(inner));
  }

  private renderIcon(name: string): unknown {
    const svg = iconToSvg(name);
    if (!svg) return this.el("span", { className: this.cls("icon"), title: name }, []);
    // Inline SVG via dangerouslySetInnerHTML, matching React's escape hatch.
    return this.el(
      "span",
      {
        className: this.cls("icon"),
        dangerouslySetInnerHTML: { __html: svg },
      },
      [],
    );
  }

  /* ------------------------------ helpers ----------------------------- */

  private el(
    type: unknown,
    props: Record<string, unknown> | null,
    children: unknown[],
  ): unknown {
    const filtered = children.filter((c) => c !== null && c !== undefined && c !== "");
    const finalProps = { ...(props ?? {}), key: this.key++ };
    return this.h(type, finalProps, ...filtered);
  }

  private frag(children: unknown[]): unknown {
    return this.el(this.Fragment, null, children);
  }

  private dim(value: string): string {
    return isSafeDimension(value) ? value : "0";
  }

  private cls(name: string): string {
    return `${this.prefix}-${name}`;
  }
}

/** Render a document AST to a React element tree. */
export function renderReact(ast: DocumentNode, options: ReactRenderOptions): unknown {
  return new ReactRenderer(options).render(ast);
}
