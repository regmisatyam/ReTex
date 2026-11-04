import { ReTeXEngine } from "./engine.js";
import { printDocument } from "./editor/printer.js";
import type { MarkdownOptions } from "./markdown/index.js";
import type { PdfOptions } from "./renderers/index.js";

export interface PaperOptions extends MarkdownOptions {
  /** Engine to render with, for custom styles and plugins. Default: a new one. */
  engine?: ReTeXEngine;
  /** `<title>` of the page. Default: the paper's title. */
  pageTitle?: string;
}

const engineFor = (options: PaperOptions): ReTeXEngine => options.engine ?? new ReTeXEngine();

/**
 * Convert Markdown straight to a standalone HTML page in a paper style. The page
 * is self-contained and print-ready: printing it from a browser gives a real
 * paginated paper.
 *
 * ```ts
 * const html = markdownToHtml(answer, { style: "ieee" });
 * ```
 */
export function markdownToHtml(markdown: string, options: PaperOptions = {}): string {
  const engine = engineFor(options);
  const { ast } = engine.fromMarkdown(markdown, options);
  return engine.toHtmlDocument(ast, { title: options.pageTitle });
}

/**
 * Convert Markdown to editable `.retex` source, so a generated draft can be
 * refined by hand and compiled like any other document.
 */
export function markdownToRetex(markdown: string, options: PaperOptions = {}): string {
  return printDocument(engineFor(options).fromMarkdown(markdown, options).ast);
}

/**
 * Convert Markdown to a PDF. Needs `puppeteer` installed, or a browser supplied
 * through `options.launch`, exactly like {@link ReTeXEngine.toPdf}.
 */
export function markdownToPdf(
  markdown: string,
  options: PaperOptions & PdfOptions = {},
): Promise<Uint8Array> {
  const engine = engineFor(options);
  const { ast } = engine.fromMarkdown(markdown, options);
  return engine.toPdf(ast, { title: options.pageTitle, launch: options.launch });
}
