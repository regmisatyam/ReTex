import {
  type Node,
  type DocumentNode,
  type SectionNode,
  type Theme,
  type SourceRange,
} from "../types/index.js";
import { resolveTheme } from "../theme/themes.js";
import {
  escapeHtml,
  escapeAttribute,
  sanitizeUrl,
  isSafeColor,
  isSafeDimension,
  sanitizeStyleValue,
} from "../security/sanitize.js";
import { iconToSvg } from "../icons/icons.js";
import { themeToCss } from "./css.js";
import { isBlockNode, type HtmlRenderFn, type HtmlRenderContext } from "./context.js";
import { toRegions, splitPreamble, entryParts } from "./structure.js";

export interface HtmlRenderOptions {
  theme?: Theme;
  /** CSS class prefix. Default `"retex"`. */
  classPrefix?: string;
  /** Plugin render overrides keyed by node `type` or `command:<name>`. */
  overrides?: Map<string, HtmlRenderFn>;
  /** Group leading contact commands into a `<header>`. Default `true`. */
  header?: boolean;
  /**
   * Emit source-position attributes (`data-rtx-pos="start:end"` and
   * `data-rtx-type`) on rendered elements so a live editor can map preview
   * clicks back to the source and vice-versa (Overleaf-style two-way sync).
   * Offsets are zero-based UTF-16 code-unit offsets into the original source.
   * Default `false` — final/exported HTML stays clean and unannotated.
   */
  sourceMap?: boolean;
}

const tokenSafe = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, "");

/**
 * The HTML renderer. Produces clean, semantic, fully-escaped HTML. Every text
 * node and attribute is escaped; every URL is re-sanitized at render time as a
 * defense-in-depth measure even though the parser already vetted it.
 */
export class HtmlRenderer {
  private readonly theme: Theme;
  private readonly prefix: string;
  private readonly overrides: Map<string, HtmlRenderFn>;
  private readonly useHeader: boolean;
  private readonly sourceMap: boolean;
  private readonly ctx: HtmlRenderContext;

  constructor(options: HtmlRenderOptions = {}) {
    this.theme = options.theme ?? resolveTheme();
    this.prefix = options.classPrefix ?? "retex";
    this.overrides = options.overrides ?? new Map();
    this.useHeader = options.header ?? true;
    this.sourceMap = options.sourceMap ?? false;
    this.ctx = {
      theme: this.theme,
      classPrefix: this.prefix,
      overrides: this.overrides,
      renderNodes: (nodes) => this.renderFlow(nodes),
      cls: (name) => this.cls(name),
    };
  }

  /** Render the resume body as an HTML fragment (no `<html>`/`<style>`). */
  render(ast: DocumentNode): string {
    const regions = toRegions(ast.children);
    const parts: string[] = [];

    const preamble = regions[0]?.section ? undefined : regions.shift();
    if (preamble) parts.push(this.renderPreamble(preamble.nodes));

    for (const region of regions) {
      if (region.section) parts.push(this.renderSection(region.section, region.nodes));
      else parts.push(this.renderFlow(region.nodes));
    }

    return `<div class="${this.cls("resume")}">\n${parts.filter(Boolean).join("\n")}\n</div>`;
  }

  /** Render a complete, standalone HTML document including the stylesheet. */
  renderDocument(ast: DocumentNode, title = "Resume"): string {
    return [
      "<!DOCTYPE html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${escapeHtml(title)}</title>`,
      `<style>\n${this.styles()}\n</style>`,
      "</head>",
      "<body>",
      this.render(ast),
      "</body>",
      "</html>",
    ].join("\n");
  }

  /** The stylesheet for the active theme (without `<style>` tags). */
  styles(): string {
    return themeToCss(this.theme, this.prefix);
  }

  /* --------------------------- structuring ---------------------------- */

  private renderSection(section: SectionNode, body: Node[]): string {
    const styleMod = ` ${this.cls("section")}--${this.theme.sectionStyle}`;
    return (
      `<section class="${this.cls("section")}${styleMod}"${this.src(section)}>` +
      `<h2 class="${this.cls("section-title")}"${this.src(section, "section-title")}>${escapeHtml(section.title)}</h2>` +
      `<div class="${this.cls("section-body")}">${this.renderFlow(body)}</div>` +
      `</section>`
    );
  }

  private renderPreamble(nodes: Node[]): string {
    if (!this.useHeader) return this.renderFlow(nodes);

    const { name, title, contacts, other } = splitPreamble(nodes);
    const hasHeader = name || title || contacts.length > 0;
    let html = "";
    if (hasHeader) {
      html += `<header class="${this.cls("header")}">`;
      if (name)
        html += `<h1 class="${this.cls("name")}"${this.src(name)}>${escapeHtml(name.value)}</h1>`;
      if (title)
        html += `<p class="${this.cls("title")}"${this.src(title)}>${escapeHtml(title.value)}</p>`;
      if (contacts.length > 0) {
        html += `<div class="${this.cls("contact")}">${contacts
          .map((c) => this.renderContactItem(c))
          .join("")}</div>`;
      }
      html += `</header>`;
    }
    if (other.length > 0) html += this.renderFlow(other);
    return html;
  }

  private renderContactItem(node: Node): string {
    const item = this.cls("contact-item");
    const src = this.src(node);
    if (node.type === "contact") {
      switch (node.field) {
        case "email":
          return this.contactLink(`mailto:${node.value}`, "email", node.value, item, src);
        case "phone":
          return this.contactLink(
            `tel:${node.value.replace(/[^\d+]/g, "")}`,
            "phone",
            node.value,
            item,
            src,
          );
        case "website":
          return this.contactLink(node.value, "website", node.value, item, src);
        case "location":
          return `<span class="${item}"${src}>${this.icon("location")}${escapeHtml(node.value)}</span>`;
        default:
          return `<span class="${item}"${src}>${escapeHtml(node.value)}</span>`;
      }
    }
    if (node.type === "icon")
      return `<span class="${item}"${src}>${this.renderNode(node)}</span>`;
    if (node.type === "link" || node.type === "url") {
      return `<span class="${item}"${src}>${this.renderNode(node)}</span>`;
    }
    return this.renderNode(node);
  }

  private contactLink(
    url: string,
    icon: string,
    label: string,
    cls: string,
    src = "",
  ): string {
    const { safe } = sanitizeUrl(url);
    return (
      `<a class="${cls}"${src} href="${escapeAttribute(safe)}">` +
      `${this.icon(icon)}${escapeHtml(label)}</a>`
    );
  }

  /* ----------------------------- flow / inline ------------------------ */

  /** Block-aware rendering: groups inline runs into `<p>`, renders blocks as-is. */
  private renderFlow(nodes: Node[]): string {
    const out: string[] = [];
    let inline: Node[] = [];
    const flush = (): void => {
      const html = this.renderInline(inline).trim();
      if (html)
        out.push(
          `<p class="${this.cls("para")}"${this.srcSpan(inline, "para")}>${html}</p>`,
        );
      inline = [];
    };
    for (const node of nodes) {
      if (node.type === "parbreak") {
        flush();
      } else if (isBlockNode(node)) {
        flush();
        out.push(this.renderNode(node));
      } else {
        inline.push(node);
      }
    }
    flush();
    return out.join("\n");
  }

  private renderInline(nodes: Node[]): string {
    return nodes.map((n) => this.renderNode(n)).join("");
  }

  /* ------------------------------ per node ---------------------------- */

  private renderNode(node: Node): string {
    const override =
      this.overrides.get(node.type) ??
      (node.type === "command" ? this.overrides.get(`command:${node.name}`) : undefined);
    if (override) return override(node, this.ctx, (ns) => this.renderFlow(ns));

    switch (node.type) {
      case "text":
        return escapeHtml(node.value);
      case "parbreak":
        return "";
      case "linebreak":
        return "<br>";
      case "rule":
        return `<hr class="${this.cls("rule")}"${this.src(node)}>`;
      case "space":
        return node.axis === "vertical"
          ? `<div style="height:${this.dim(node.size)}"${this.src(node)}></div>`
          : `<span style="display:inline-block;width:${this.dim(node.size)}"${this.src(node)}></span>`;
      case "group":
        return this.renderInline(node.children);
      case "bold":
        return `<strong${this.src(node)}>${this.renderInline(node.children)}</strong>`;
      case "italic":
        return `<em${this.src(node)}>${this.renderInline(node.children)}</em>`;
      case "underline":
        return `<u${this.src(node)}>${this.renderInline(node.children)}</u>`;
      case "strike":
        return `<s${this.src(node)}>${this.renderInline(node.children)}</s>`;
      case "color": {
        const inner = this.renderInline(node.children);
        if (!node.color || !isSafeColor(node.color)) return inner;
        return `<span style="color:${node.color}"${this.src(node)}>${inner}</span>`;
      }
      case "themecolor": {
        const inner = this.renderInline(node.children);
        const tok = tokenSafe(node.token);
        return `<span style="color:var(--${this.prefix}-color-${tok}, currentColor)"${this.src(node)}>${inner}</span>`;
      }
      case "fontsize": {
        const inner = this.renderInline(node.children);
        if (!isSafeDimension(node.size)) return inner;
        return `<span style="font-size:${node.size}"${this.src(node)}>${inner}</span>`;
      }
      case "fontfamily": {
        const inner = this.renderInline(node.children);
        const family =
          node.family === "monospace"
            ? `var(--${this.prefix}-font-mono)`
            : sanitizeStyleValue(node.family);
        if (!family) return inner;
        return `<span style="font-family:${family}"${this.src(node)}>${inner}</span>`;
      }
      case "fontscale": {
        const inner = this.renderInline(node.children);
        if (node.scale === "normal") return `<span${this.src(node)}>${inner}</span>`;
        return `<span class="${this.cls(`scale-${node.scale}`)}"${this.src(node)}>${inner}</span>`;
      }
      case "link":
        return this.renderLink(
          node.href,
          this.renderInline(node.children),
          this.src(node),
        );
      case "url":
        return this.renderLink(node.href, escapeHtml(node.rawHref), this.src(node));
      case "icon":
        return this.icon(node.name);
      case "section":
        // A section nested in flow (e.g. subsection) renders as a heading.
        return `<h${node.level + 1} class="${this.cls("subsection-title")}"${this.src(node)}>${escapeHtml(node.title)}</h${node.level + 1}>`;
      case "list":
        return this.renderList(node);
      case "columns":
        return this.renderColumns(node);
      case "skills":
        return this.renderSkills(node);
      case "job":
        return this.renderEntry(node, "job");
      case "education":
        return this.renderEntry(node, "education");
      case "project":
        return this.renderEntry(node, "project");
      case "contact":
        return this.renderContactItem(node);
      case "command":
        return this.renderCommand(node);
      case "error":
        return "";
      default:
        return "";
    }
  }

  private renderLink(href: string, label: string, src = ""): string {
    const { safe } = sanitizeUrl(href);
    const external = /^https?:/i.test(safe);
    const rel = external ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<a class="${this.cls("link")}"${src} href="${escapeAttribute(safe)}"${rel}>${label}</a>`;
  }

  private renderList(node: Extract<Node, { type: "list" }>): string {
    const tag = node.kind === "enumerate" ? "ol" : "ul";
    const items = node.items
      .map(
        (item) => `<li${this.src(item)}>${this.renderInline(item.children).trim()}</li>`,
      )
      .join("");
    return `<${tag} class="${this.cls("list")}"${this.src(node)}>${items}</${tag}>`;
  }

  private renderColumns(node: Extract<Node, { type: "columns" }>): string {
    const cols = node.columns
      .map((col) => {
        const basis = isSafeDimension(col.width) ? col.width : "auto";
        const flex = basis === "auto" ? "flex:1 1 0" : `flex:0 0 ${basis}`;
        return `<div class="${this.cls("column")}" style="${flex}"${this.src(col)}>${this.renderFlow(col.children)}</div>`;
      })
      .join("");
    return `<div class="${this.cls("columns")}"${this.src(node)}>${cols}</div>`;
  }

  private renderSkills(node: Extract<Node, { type: "skills" }>): string {
    const lis = node.items
      .map((s) => `<li class="${this.cls("skill")}">${escapeHtml(s)}</li>`)
      .join("");
    return `<ul class="${this.cls("skills")}"${this.src(node)}>${lis}</ul>`;
  }

  private renderEntry(
    node: Extract<Node, { type: "job" | "education" | "project" }>,
    kind: string,
  ): string {
    const { fields, children: body } = node;
    const { title, subtitle, dates, location, url } = entryParts(fields, kind);

    const titleHtml = url
      ? this.renderLink(sanitizeUrl(url).safe, escapeHtml(title))
      : escapeHtml(title);

    let html = `<div class="${this.cls("entry")} ${this.cls(kind)}"${this.src(node)}>`;
    html += `<div class="${this.cls("entry-row")}">`;
    html += `<span class="${this.cls("entry-title")}">${titleHtml}</span>`;
    if (dates)
      html += `<span class="${this.cls("entry-dates")}">${escapeHtml(dates)}</span>`;
    html += `</div>`;
    if (subtitle || location) {
      html += `<div class="${this.cls("entry-row")}">`;
      html += `<span class="${this.cls("entry-subtitle")}">${escapeHtml(subtitle)}</span>`;
      if (location)
        html += `<span class="${this.cls("entry-location")}">${escapeHtml(location)}</span>`;
      html += `</div>`;
    }
    if (body.length > 0) {
      html += `<div class="${this.cls("entry-body")}">${this.renderFlow(body)}</div>`;
    }
    html += `</div>`;
    return html;
  }

  private renderCommand(node: Extract<Node, { type: "command" }>): string {
    if (node.name === "center") {
      const inner = node.args.flatMap((a) => a.children);
      return `<div class="${this.cls("center")}"${this.src(node)}>${this.renderFlow(inner)}</div>`;
    }
    // Unknown / unhandled command: render its argument content so nothing is lost.
    const inner = node.args.flatMap((a) => a.children);
    return inner.length > 0 ? this.renderInline(inner) : "";
  }

  /* ------------------------------ helpers ----------------------------- */

  /**
   * Source-position attributes for a node — `data-rtx-pos="start:end"` plus a
   * `data-rtx-type`. Returns an empty string unless `sourceMap` is enabled and
   * the node carries a range. Powers the live-preview two-way sync: a client
   * reads these to map a clicked element back to the exact source offsets (and,
   * in reverse, to find the element for a caret offset).
   */
  private src(
    node: { range?: SourceRange; type?: string } | undefined,
    type?: string,
  ): string {
    if (!this.sourceMap || !node?.range) return "";
    const kind = type ?? node.type;
    const kindAttr = kind ? ` data-rtx-type="${kind}"` : "";
    return ` data-rtx-pos="${node.range.start.offset}:${node.range.end.offset}"${kindAttr}`;
  }

  /** Like {@link src}, but spans a run of inline nodes (merges their ranges). */
  private srcSpan(nodes: Node[], type: string): string {
    if (!this.sourceMap) return "";
    let start = Infinity;
    let end = -Infinity;
    for (const n of nodes) {
      if (!n.range) continue;
      if (n.range.start.offset < start) start = n.range.start.offset;
      if (n.range.end.offset > end) end = n.range.end.offset;
    }
    if (end < 0) return "";
    return ` data-rtx-pos="${start}:${end}" data-rtx-type="${type}"`;
  }

  private icon(name: string): string {
    const svg = iconToSvg(name, { className: this.cls("icon") });
    if (svg) return svg;
    return `<span class="${this.cls("icon")}" title="${escapeAttribute(name)}"></span>`;
  }

  private dim(value: string): string {
    return isSafeDimension(value) ? value : "0";
  }

  private cls(name: string): string {
    return `${this.prefix}-${name}`;
  }
}

/** Render a document AST to an HTML fragment. */
export function renderHtml(ast: DocumentNode, options?: HtmlRenderOptions): string {
  return new HtmlRenderer(options).render(ast);
}

/** Render a document AST to a complete standalone HTML page. */
export function renderHtmlDocument(
  ast: DocumentNode,
  options?: HtmlRenderOptions & { title?: string },
): string {
  return new HtmlRenderer(options).renderDocument(ast, options?.title);
}

export { themeToCss };
