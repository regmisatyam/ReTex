import type { DocumentNode, Theme } from "../types/index.js";
import { resolveTheme } from "../theme/themes.js";
import { isSafeDimension, sanitizeStyleValue } from "../security/sanitize.js";
import { HtmlRenderer, type HtmlRenderOptions } from "./html.js";

/** Vet a page size keyword/dimension before it reaches CSS or the PDF API. */
const pageSize = (v: string | undefined): string =>
  (v && sanitizeStyleValue(v)) || "Letter";
/** Vet a page margin dimension. */
const pageMargin = (v: string | undefined): string =>
  v && isSafeDimension(v) ? v : "0.5in";

export interface PrintOptions extends HtmlRenderOptions {
  title?: string;
}

/**
 * Build the `@page` CSS for the theme's page geometry. This is what turns a
 * web page into a paginated, print-ready document.
 */
export function pageCss(theme: Theme): string {
  const size = pageSize(theme.page?.size);
  const margin = pageMargin(theme.page?.margin);
  return `@page { size: ${size}; margin: ${margin}; }
html, body { margin: 0; padding: 0; background: #fff; }
@media screen { body { background: #f1f5f9; padding: 24px; } .retex-resume { box-shadow: 0 1px 8px rgba(0,0,0,.12); } }`;
}

/**
 * Render a print-optimized, standalone HTML document. This is the portable
 * core of the PDF strategy: the same HTML can be
 *  - printed to PDF in the browser via `window.print()`,
 *  - converted headlessly with Puppeteer/Playwright ({@link renderPdf}), or
 *  - handed to any HTML-to-PDF service.
 */
export function renderPrintHtml(ast: DocumentNode, options: PrintOptions = {}): string {
  const theme = options.theme ?? resolveTheme();
  const renderer = new HtmlRenderer({ ...options, theme });
  const body = renderer.render(ast);
  const title = options.title ?? "Resume";
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title.replace(/[<>&]/g, "")}</title>`,
    `<style>\n${renderer.styles()}\n${pageCss(theme)}\n</style>`,
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
  ].join("\n");
}

export interface PdfOptions extends PrintOptions {
  /**
   * Optional injected headless-browser launcher. When omitted, `renderPdf`
   * dynamically imports `puppeteer` if it is installed.
   */
  launch?: () => Promise<HeadlessBrowser>;
  /** Print background colors/images. Default `true`. */
  printBackground?: boolean;
}

/** Minimal structural types for the puppeteer/playwright adapter. */
export interface HeadlessPage {
  setContent(html: string, opts?: { waitUntil?: string }): Promise<void>;
  pdf(opts: Record<string, unknown>): Promise<Uint8Array>;
}
export interface HeadlessBrowser {
  newPage(): Promise<HeadlessPage>;
  close(): Promise<void>;
}

/**
 * Render a document to a PDF byte buffer using a headless browser.
 *
 * The default path lazily imports `puppeteer` (an *optional* dependency) so the
 * core library stays dependency-free. Supply `options.launch` to plug in
 * Playwright, a pooled browser, or a remote Chromium instead.
 *
 * @throws if no launcher is available, with guidance on how to enable PDF export.
 */
export async function renderPdf(
  ast: DocumentNode,
  options: PdfOptions = {},
): Promise<Uint8Array> {
  const html = renderPrintHtml(ast, options);
  const theme = options.theme ?? resolveTheme();

  const launch = options.launch ?? (await defaultLauncher());
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const size = pageSize(theme.page?.size);
    const margin = pageMargin(theme.page?.margin);
    return await page.pdf({
      printBackground: options.printBackground ?? true,
      preferCSSPageSize: true,
      format: size,
      margin: { top: margin, bottom: margin, left: margin, right: margin },
    });
  } finally {
    await browser.close();
  }
}

async function defaultLauncher(): Promise<() => Promise<HeadlessBrowser>> {
  try {
    // Indirected so bundlers don't try to resolve the optional dependency.
    const mod = (await import(/* @vite-ignore */ "puppeteer" as string)) as {
      launch: (opts?: Record<string, unknown>) => Promise<HeadlessBrowser>;
    };
    return () => mod.launch({ headless: true });
  } catch {
    throw new Error(
      "PDF export requires a headless browser. Either install `puppeteer` " +
        "(`npm i -D puppeteer`) or pass `options.launch` with your own " +
        "Playwright/Chromium launcher. Alternatively, use `renderPrintHtml()` " +
        "and print to PDF in the browser via `window.print()`.",
    );
  }
}
