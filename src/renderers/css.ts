import type { Theme } from "../types/index.js";
import {
  isSafeColor,
  isSafeDimension,
  sanitizeStyleValue,
} from "../security/sanitize.js";

const tokenSafe = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, "");

const has = (v: string | undefined): v is string => v != null && v !== "";

/** A theme color, only if safe; otherwise the neutral fallback. */
const color = (v: string | undefined, fallback: string): string =>
  has(v) && isSafeColor(v) ? v : fallback;

/** A theme dimension (size/spacing), only if safe; otherwise the fallback. */
const dim = (v: string | undefined, fallback: string): string =>
  has(v) && isSafeDimension(v) ? v : fallback;

/** Any other CSS value (font stack, keyword, tracking), vetted; else fallback. */
const val = (v: string | undefined, fallback: string): string =>
  has(v) ? (sanitizeStyleValue(v) ?? fallback) : fallback;

/**
 * Generate the stylesheet for a rendered resume from a {@link Theme}.
 *
 * Themes are **blank by default**: any field may be `undefined`. The structural
 * layout (flex rows, list indents, spacing rhythm) is always emitted, while all
 * *decoration* (accent colors, fonts, uppercased headings, skill chips, section
 * rules) is driven by CSS custom properties whose fallbacks are neutral. So an
 * unstyled theme produces a clean, browser-default document, and importing a
 * library/theme simply fills in those variables.
 *
 * Every embedded theme value is vetted before it reaches the stylesheet
 * (`isSafeColor` / `isSafeDimension` / `sanitizeStyleValue`), so even a
 * user-supplied theme cannot inject CSS. Each color is also exposed as
 * `--retex-color-<token>` for use by `\themecolor`.
 */
export function themeToCss(theme: Theme, prefix = "retex"): string {
  const p = prefix;
  const c = theme.colors ?? {};
  const f = theme.fonts ?? {};
  const fs = theme.fontSizes ?? {};
  const sp = theme.spacing ?? {};
  const h = theme.headings ?? {};

  // Per-token color variables (only emit the ones that are defined *and* safe).
  const colorVars = Object.entries(c)
    .filter(([, v]) => has(v) && isSafeColor(v))
    .map(([k, v]) => `    --${p}-color-${tokenSafe(k)}: ${v};`)
    .join("\n");

  // Resolved, vetted decoration values — neutral when the theme is blank.
  const primary = color(c.primary, "");
  const skillBg = primary
    ? `color-mix(in srgb, ${primary} 12%, transparent)`
    : "transparent";
  const skillColor = primary || "inherit";
  const linkDecoration = primary ? "none" : "underline";

  return `.${p}-resume {
${colorVars ? colorVars + "\n" : ""}    --${p}-primary: ${primary || "inherit"};
    --${p}-text: ${color(c.text, "inherit")};
    --${p}-muted: ${color(c.muted, "inherit")};
    --${p}-border: ${color(c.border, "currentColor")};
    --${p}-bg: ${color(c.background, "transparent")};
    --${p}-font-heading: ${val(f.heading, "inherit")};
    --${p}-font-body: ${val(f.body, "inherit")};
    --${p}-font-mono: ${val(f.mono, "ui-monospace, SFMono-Regular, Menlo, monospace")};
    --${p}-fs-base: ${dim(fs.base, "inherit")};
    --${p}-fs-small: ${dim(fs.small, "0.85em")};
    --${p}-fs-large: ${dim(fs.large, "1.2em")};
    --${p}-fs-Large: ${dim(fs.Large, "1.45em")};
    --${p}-fs-Huge: ${dim(fs.Huge, "2em")};
    --${p}-fs-name: ${dim(fs.name, "2em")};
    --${p}-fs-section: ${dim(fs.section, "1.25em")};
    --${p}-sp-section: ${dim(sp.section, "1.1rem")};
    --${p}-sp-item: ${dim(sp.item, "0.28rem")};
    --${p}-section-transform: ${val(h.transform, "none")};
    --${p}-section-tracking: ${val(h.tracking, "normal")};
    --${p}-name-tracking: ${val(h.nameTracking, "normal")};
    --${p}-link-decoration: ${linkDecoration};
    --${p}-skill-bg: ${skillBg};
    --${p}-skill-color: ${skillColor};

    box-sizing: border-box;
    max-width: ${dim(theme.page?.maxWidth, "none")};
    margin: 0 auto;
    padding: ${dim(sp.page, "0")};
    background: var(--${p}-bg);
    color: var(--${p}-text);
    font-family: var(--${p}-font-body);
    font-size: var(--${p}-fs-base);
    line-height: 1.45;
}
.${p}-resume *, .${p}-resume *::before, .${p}-resume *::after { box-sizing: border-box; }

.${p}-header { margin-bottom: var(--${p}-sp-section); }
.${p}-name {
    font-family: var(--${p}-font-heading);
    font-size: var(--${p}-fs-name);
    font-weight: 700;
    margin: 0 0 0.1em;
    color: var(--${p}-text);
    letter-spacing: var(--${p}-name-tracking);
}
.${p}-title {
    font-size: var(--${p}-fs-large);
    color: var(--${p}-primary);
    margin: 0 0 0.45em;
    font-weight: 500;
}
.${p}-contact {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 1rem;
    font-size: var(--${p}-fs-small);
    color: var(--${p}-muted);
}
.${p}-contact-item {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    color: inherit;
    text-decoration: none;
}
.${p}-contact-item svg { opacity: 0.8; }

.${p}-section { margin-bottom: var(--${p}-sp-section); break-inside: avoid; }
.${p}-section-title {
    font-family: var(--${p}-font-heading);
    font-size: var(--${p}-fs-section);
    font-weight: 700;
    text-transform: var(--${p}-section-transform);
    letter-spacing: var(--${p}-section-tracking);
    color: var(--${p}-primary);
    margin: 0 0 0.5em;
}
.${p}-section--rule .${p}-section-title { border-bottom: 2px solid var(--${p}-border); padding-bottom: 0.2em; }
.${p}-section--underline .${p}-section-title { text-decoration: underline; text-underline-offset: 3px; }
.${p}-section--bar .${p}-section-title {
    border-left: 3px solid var(--${p}-primary);
    padding-left: 0.5em;
    border-bottom: none;
}
.${p}-subsection-title {
    font-family: var(--${p}-font-heading);
    font-size: var(--${p}-fs-large);
    font-weight: 600;
    margin: 0.6em 0 0.3em;
}

.${p}-entry { margin-bottom: 0.6rem; break-inside: avoid; }
.${p}-entry-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1rem;
}
.${p}-entry-title { font-weight: 700; }
.${p}-entry-subtitle { color: var(--${p}-primary); font-weight: 500; }
.${p}-entry-dates, .${p}-entry-location {
    color: var(--${p}-muted);
    font-size: var(--${p}-fs-small);
    white-space: nowrap;
}
.${p}-entry-body { margin-top: 0.15rem; }
.${p}-entry-body p { margin: 0.2em 0; }

.${p}-list { margin: 0.2rem 0 0.2rem 1.1rem; padding: 0; }
.${p}-list li { margin-bottom: var(--${p}-sp-item); padding-left: 0.15rem; }

.${p}-columns { display: flex; gap: 1.5rem; align-items: flex-start; }
.${p}-column { min-width: 0; }

.${p}-skills { display: flex; flex-wrap: wrap; gap: 0.4rem; list-style: none; margin: 0.2rem 0; padding: 0; }
.${p}-skill {
    background: var(--${p}-skill-bg);
    color: var(--${p}-skill-color);
    border-radius: 4px;
    padding: 0.12rem 0.5rem;
    font-size: var(--${p}-fs-small);
    font-weight: 500;
    white-space: nowrap;
}

.${p}-link { color: var(--${p}-primary); text-decoration: var(--${p}-link-decoration); }
.${p}-link:hover { text-decoration: underline; }
.${p}-icon { display: inline-flex; vertical-align: -0.125em; }
.${p}-rule { border: none; border-top: 1px solid var(--${p}-border); margin: 0.6rem 0; }
.${p}-rule--dashed { border-top-style: dashed; }
.${p}-rule--dotted { border-top-style: dotted; }
.${p}-rule--thick { border-top-width: 3px; }
.${p}-rule--double { border-top-style: double; border-top-width: 3px; }
.${p}-center { text-align: center; }
.${p}-scale-small { font-size: var(--${p}-fs-small); }
.${p}-scale-large { font-size: var(--${p}-fs-large); }
.${p}-scale-Large { font-size: var(--${p}-fs-Large); }
.${p}-scale-Huge { font-size: var(--${p}-fs-Huge); }
p.${p}-para { margin: 0 0 0.45em; }
p.${p}-para:last-child { margin-bottom: 0; }

@media print {
    .${p}-resume { max-width: none; margin: 0; padding: 0; }
    .${p}-section, .${p}-entry { break-inside: avoid; }
    a { color: inherit; }
}`;
}
