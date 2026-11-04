/**
 * Security utilities. ReTeX renders untrusted markup to HTML, so every text
 * node and attribute value must be escaped, and every URL must be vetted
 * before it reaches an `href`/`src`. The engine never evaluates source as
 * code — there is no `eval`, `Function`, or template-string interpolation of
 * user input into executable contexts.
 */

/** HTML text-content escaping. Order matters: ampersand first. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escaping for values placed inside double-quoted HTML attributes. */
export function escapeAttribute(input: string): string {
  return escapeHtml(input);
}

/** Protocols we consider safe for links. */
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:", "ftp:", "sms:"]);

/**
 * Matches the leading `scheme:` of a URL. We strip ASCII control characters
 * and whitespace first because browsers ignore them inside the scheme
 * (`java\tscript:` is a classic bypass).
 */
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;

/** Matches ASCII control characters (0x00–0x1F and 0x7F). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/g;

export interface UrlSanitizeResult {
  /** Safe URL, or `"#"` when the input was rejected. */
  safe: string;
  /** True when the original URL was blocked. */
  blocked: boolean;
  /** The detected scheme, when present. */
  scheme?: string;
}

/**
 * Sanitize a URL for use in an `href`.
 *
 *  - Relative URLs and fragments are allowed as-is.
 *  - Absolute URLs are allowed only for an allow-listed protocol.
 *  - `javascript:`, `data:`, `vbscript:`, `file:` and friends are blocked.
 *  - Control characters used to obfuscate the scheme are removed first.
 */
export function sanitizeUrl(input: string): UrlSanitizeResult {
  const raw = String(input ?? "").trim();

  // Strip ASCII control characters (incl. tabs/newlines) that browsers ignore
  // and that are commonly used to hide a `javascript:` scheme, e.g.
  // `java\tscript:alert(1)`. They are removed from the emitted value too.
  const cleaned = raw.replace(CONTROL_CHARS_RE, "");

  const match = SCHEME_RE.exec(cleaned);
  if (!match) {
    // No scheme → relative URL, fragment, query, or protocol-relative.
    return { safe: cleaned, blocked: false };
  }

  const scheme = match[1]!.toLowerCase() + ":";
  if (SAFE_PROTOCOLS.has(scheme)) {
    return { safe: cleaned, blocked: false, scheme };
  }

  return { safe: "#", blocked: true, scheme };
}

/** Inline raster images only: an SVG can carry script, so it is never allowed. */
const SAFE_DATA_IMAGE_RE = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

/**
 * Sanitize a URL for use in an `<img src>`. Same policy as {@link sanitizeUrl},
 * plus inline base64 raster images. Non-http schemes such as `mailto:` are
 * meaningless for an image and are blocked.
 */
export function sanitizeImageUrl(input: string): UrlSanitizeResult {
  const cleaned = String(input ?? "")
    .trim()
    .replace(CONTROL_CHARS_RE, "");
  if (SAFE_DATA_IMAGE_RE.test(cleaned)) {
    return { safe: cleaned, blocked: false, scheme: "data:" };
  }
  const result = sanitizeUrl(cleaned);
  if (result.scheme && result.scheme !== "http:" && result.scheme !== "https:") {
    return { safe: "", blocked: true, scheme: result.scheme };
  }
  return result.blocked ? { ...result, safe: "" } : result;
}

/**
 * Validate a CSS color token. Accepts `#rgb`, `#rrggbb`, `#rrggbbaa`,
 * `rgb()/rgba()/hsl()/hsla()` functional notation, and a curated set of
 * CSS named colors. Anything else is rejected so it can't smuggle
 * `url(javascript:…)` or `expression(...)` into a `style` attribute.
 */
export function isSafeColor(value: string): boolean {
  const v = value.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return true;
  if (/^(rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s/]+\)$/i.test(v)) return true;
  return CSS_NAMED_COLORS.has(v.toLowerCase());
}

/**
 * Validate a CSS length/dimension such as `14pt`, `1.5rem`, `40%`, `200px`.
 * Used for `\fontsize`, `\column` widths and spacing commands.
 */
export function isSafeDimension(value: string): boolean {
  return /^-?\d*\.?\d+(px|pt|em|rem|ex|ch|vw|vh|vmin|vmax|cm|mm|in|pc|%|fr)?$/.test(
    value.trim(),
  );
}

/**
 * Sanitize a value destined for a CSS property. Returns `undefined` when the
 * value is unsafe so callers can omit the declaration entirely.
 */
export function sanitizeStyleValue(value: string): string | undefined {
  const v = value.trim();
  if (/[<>;{}]/.test(v) || /expression|url\s*\(|javascript:/i.test(v)) {
    return undefined;
  }
  return v;
}

/** A pragmatic subset of CSS named colors. */
export const CSS_NAMED_COLORS = new Set([
  "black",
  "silver",
  "gray",
  "grey",
  "white",
  "maroon",
  "red",
  "purple",
  "fuchsia",
  "green",
  "lime",
  "olive",
  "yellow",
  "navy",
  "blue",
  "teal",
  "aqua",
  "cyan",
  "magenta",
  "orange",
  "pink",
  "brown",
  "gold",
  "indigo",
  "violet",
  "tan",
  "beige",
  "ivory",
  "coral",
  "salmon",
  "khaki",
  "crimson",
  "turquoise",
  "lavender",
  "plum",
  "orchid",
  "slateblue",
  "slategray",
  "steelblue",
  "skyblue",
  "royalblue",
  "midnightblue",
  "darkblue",
  "darkgreen",
  "darkred",
  "darkgray",
  "darkgrey",
  "lightgray",
  "lightgrey",
  "lightblue",
  "transparent",
  "currentcolor",
  "inherit",
]);
