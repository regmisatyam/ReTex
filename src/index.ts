/**
 * ReTeX — a modern, LaTeX-inspired markup language and compiler for resumes,
 * research papers, and developer portfolios.
 *
 * The quickest way in is the engine:
 *
 * ```ts
 * import { ReTeXEngine } from "retex";
 * const engine = new ReTeXEngine();
 * const html = engine.toHtml("\\section{Experience}\n\\job{title=Eng, company=ACME}{Did things}");
 * ```
 *
 * Or use the stage functions directly: {@link tokenize} → {@link parse} →
 * {@link validate} → {@link renderHtml}.
 */

/* ------------------------------- engine ------------------------------ */
export { ReTeXEngine, createEngine } from "./engine.js";
export type { EngineOptions, CompileResult, CompileOptions } from "./engine.js";

/* -------------------------------- types ------------------------------ */
export * from "./types/index.js";

/* ----------------------------- pipeline ------------------------------ */
export { Tokenizer, tokenize } from "./tokenizer/index.js";
export type { TokenizeResult } from "./tokenizer/index.js";

export {
  Parser,
  parse,
  CommandRegistry,
  createDefaultRegistry,
  parseKeyValArg,
  parseListArg,
  splitTopLevel,
  closestMatch,
  levenshtein,
} from "./parser/index.js";
export type { ParseResult, ParserOptions } from "./parser/index.js";

export { validate } from "./validator/index.js";
export type { ValidateOptions } from "./validator/index.js";

/* ------------------------------- AST --------------------------------- */
export { walk, collect, childrenOf, nodePathAt } from "./ast/walk.js";
export type { VisitOptions } from "./ast/walk.js";
export { flattenText, normalizeWhitespace } from "./ast/text.js";

/* ----------------------------- renderers ----------------------------- */
export {
  HtmlRenderer,
  renderHtml,
  renderHtmlDocument,
  themeToCss,
  renderJson,
  toJsonTree,
  renderPrintHtml,
  renderPdf,
  pageCss,
  isBlockNode,
  BLOCK_TYPES,
  toRegions,
  splitPreamble,
  entryParts,
  dateRange,
} from "./renderers/index.js";
export type {
  HtmlRenderOptions,
  JsonRenderOptions,
  PrintOptions,
  PdfOptions,
  HeadlessBrowser,
  HeadlessPage,
  HtmlRenderFn,
  HtmlRenderContext,
  Region,
  PreambleParts,
  EntryParts,
} from "./renderers/index.js";

// React renderer (dependency-free; React is supplied by the caller).
export { ReactRenderer, renderReact } from "./renderers/react.js";
export type {
  ReactRenderFn,
  ReactRenderContext,
  ReactRenderOptions,
  JsxFactory,
} from "./renderers/react.js";

/* ------------------------------- theme ------------------------------- */
export {
  defaultTheme,
  resolveTheme,
  getTheme,
  themes,
  modernTheme,
  classicTheme,
  compactTheme,
} from "./theme/index.js";

/* ------------------------------ plugins ------------------------------ */
export { badgePlugin, ratingPlugin } from "./plugin/index.js";
export type { ReTeXPlugin, EngineCommand, PluginHost } from "./plugin/index.js";

/* ------------------------------ security ----------------------------- */
export {
  escapeHtml,
  escapeAttribute,
  sanitizeUrl,
  isSafeColor,
  isSafeDimension,
  sanitizeStyleValue,
} from "./security/index.js";
export type { UrlSanitizeResult } from "./security/index.js";

/* -------------------------------- icons ------------------------------ */
export {
  iconToSvg,
  getIcon,
  hasIcon,
  registerIcon,
  iconNames,
  resolveIconName,
} from "./icons/index.js";
export type { IconDefinition } from "./icons/index.js";

/* ------------------------------- editor ------------------------------ */
export { EditorService, printDocument } from "./editor/index.js";
export type {
  EditorServiceOptions,
  CompletionItem,
  CompletionKind,
  HoverInfo,
  SemanticToken,
  SemanticTokenType,
} from "./editor/index.js";

/* --------------------- two-way preview / source map ------------------ */
export {
  SOURCE_POS_ATTR,
  SOURCE_TYPE_ATTR,
  parseSourcePos,
  readSourcePos,
  readSourceType,
  closestSourcePos,
  spanLength,
  spanContains,
  pickElementForOffset,
} from "./editor/index.js";
export type { SourceSpan, AttrElement, ClosestElement } from "./editor/index.js";

/* ---------------------------- incremental ---------------------------- */
export {
  IncrementalCompiler,
  splitBalancedSegments,
  isBalanced,
} from "./incremental/index.js";
export type { IncrementalResult, IncrementalStats } from "./incremental/index.js";
