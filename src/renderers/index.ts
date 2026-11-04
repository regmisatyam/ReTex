export { HtmlRenderer, renderHtml, renderHtmlDocument, themeToCss } from "./html.js";
export type { HtmlRenderOptions } from "./html.js";

export { renderJson, toJsonTree } from "./json.js";
export type { JsonRenderOptions } from "./json.js";

export { renderPrintHtml, renderPdf, pageCss } from "./pdf.js";
export type { PrintOptions, PdfOptions, HeadlessBrowser, HeadlessPage } from "./pdf.js";

export { isBlockNode, BLOCK_TYPES } from "./context.js";
export type { HtmlRenderFn, HtmlRenderContext, ReactElementSpec } from "./context.js";

export { paperToCss, paperPageCss } from "./paper-css.js";

export {
  toRegions,
  splitPreamble,
  splitPaperFront,
  entryParts,
  dateRange,
  equationFit,
} from "./structure.js";
export type {
  Region,
  PreambleParts,
  PaperFront,
  EntryParts,
  EquationFit,
} from "./structure.js";

// Note: the React renderer is exposed via the dedicated `retex/react` entry so
// the core bundle never imports React.
