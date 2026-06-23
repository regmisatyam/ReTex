/**
 * Two-way preview sync — the editor-agnostic half of ReTeX's Overleaf-style
 * "click the preview, jump to the source" feature (and its reverse).
 *
 * The {@link HtmlRenderer} `sourceMap` option stamps every meaningful element
 * with a `data-rtx-pos="start:end"` attribute (zero-based UTF-16 offsets into
 * the source) and a `data-rtx-type`. These helpers are the small, dependency-
 * free glue a host editor uses on top of those attributes:
 *
 *  - **Preview → code** (reverse sync): on a click in the preview, read the
 *    nearest annotated ancestor's span and select/scroll to it in the editor.
 *
 *    ```ts
 *    preview.addEventListener("click", (e) => {
 *      const span = closestSourcePos(e.target as Element);
 *      if (span) {
 *        textarea.focus();
 *        textarea.setSelectionRange(span.start, span.end);
 *      }
 *    });
 *    ```
 *
 *  - **Code → preview** (forward sync): on caret move, find the tightest
 *    element whose span contains the caret offset and highlight it.
 *
 *    ```ts
 *    const el = pickElementForOffset(
 *      preview.querySelectorAll(`[${SOURCE_POS_ATTR}]`),
 *      textarea.selectionStart,
 *    );
 *    el?.scrollIntoView({ block: "center" });
 *    ```
 *
 * Every function is pure and works with any object exposing `getAttribute`
 * (real DOM elements, or test doubles), so this module never touches `document`
 * and stays usable outside the browser.
 */

/** Attribute carrying a `"start:end"` source-offset span. */
export const SOURCE_POS_ATTR = "data-rtx-pos";

/** Attribute carrying the originating AST node type (e.g. `"section"`). */
export const SOURCE_TYPE_ATTR = "data-rtx-type";

/** A half-open `[start, end)` span of UTF-16 offsets into the source text. */
export interface SourceSpan {
  start: number;
  end: number;
}

/** The minimal shape these helpers need from a preview element. */
export interface AttrElement {
  getAttribute(name: string): string | null;
}

/** An element that can also walk up to its nearest matching ancestor. */
export interface ClosestElement extends AttrElement {
  closest(selectors: string): (AttrElement & ClosestElement) | null;
}

/** Parse a `"start:end"` attribute value into a {@link SourceSpan}. */
export function parseSourcePos(value: string | null | undefined): SourceSpan | null {
  if (!value) return null;
  const sep = value.indexOf(":");
  if (sep === -1) return null;
  const start = Number.parseInt(value.slice(0, sep), 10);
  const end = Number.parseInt(value.slice(sep + 1), 10);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return { start, end };
}

/** Read the {@link SOURCE_POS_ATTR} span off a single element. */
export function readSourcePos(el: AttrElement | null | undefined): SourceSpan | null {
  if (!el) return null;
  return parseSourcePos(el.getAttribute(SOURCE_POS_ATTR));
}

/** Read the {@link SOURCE_TYPE_ATTR} off a single element. */
export function readSourceType(el: AttrElement | null | undefined): string | null {
  return el?.getAttribute(SOURCE_TYPE_ATTR) ?? null;
}

/**
 * Reverse sync: from a clicked element, walk up to the nearest annotated
 * ancestor and return its span. Uses the DOM `closest` when available.
 */
export function closestSourcePos(
  el: ClosestElement | null | undefined,
): SourceSpan | null {
  if (!el) return null;
  const match = el.closest(`[${SOURCE_POS_ATTR}]`);
  return readSourcePos(match);
}

/** Width of a span; used to prefer the most specific (smallest) match. */
export function spanLength(span: SourceSpan): number {
  return span.end - span.start;
}

/** Whether `offset` falls within `span` (both ends inclusive). */
export function spanContains(span: SourceSpan, offset: number): boolean {
  return offset >= span.start && offset <= span.end;
}

/**
 * Forward sync: from a set of annotated elements, return the single tightest
 * one whose span contains `offset` — i.e. the most specific element under the
 * caret. Ties on width are broken toward the later span (the deepest/innermost
 * element rendered). Returns `null` when no span contains the offset.
 */
export function pickElementForOffset<T extends AttrElement>(
  elements: Iterable<T>,
  offset: number,
): T | null {
  let best: T | null = null;
  let bestLen = Infinity;
  let bestStart = -1;
  for (const el of elements) {
    const span = readSourcePos(el);
    if (!span || !spanContains(span, offset)) continue;
    const len = spanLength(span);
    if (len < bestLen || (len === bestLen && span.start > bestStart)) {
      best = el;
      bestLen = len;
      bestStart = span.start;
    }
  }
  return best;
}
