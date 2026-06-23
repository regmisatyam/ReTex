import type { PartialTheme, Theme } from "../types/theme.js";
import { blankTheme, defaultTheme } from "./default.js";

/**
 * Deep-merge a partial theme over a base theme (sub-objects merged shallowly).
 * The result always has defined (possibly empty) sub-objects, so consumers can
 * safely read `theme.colors`, `theme.fonts`, … without null checks even when
 * the base is the blank theme.
 */
export function resolveTheme(partial?: PartialTheme, base: Theme = defaultTheme): Theme {
  return {
    name: partial?.name ?? base.name,
    colors: { ...base.colors, ...partial?.colors },
    fonts: { ...base.fonts, ...partial?.fonts },
    fontSizes: { ...base.fontSizes, ...partial?.fontSizes },
    spacing: { ...base.spacing, ...partial?.spacing },
    page: { ...base.page, ...partial?.page },
    sectionStyle: partial?.sectionStyle ?? base.sectionStyle,
    headings: { ...base.headings, ...partial?.headings },
  };
}

/**
 * A complete, ATS-friendly typographic foundation. The styled presets below are
 * built on top of this; the blank default deliberately ships none of it, so a
 * plain document only gets this look once a theme/library is imported.
 */
const styledBase: PartialTheme = {
  fonts: {
    heading: '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif',
    body: '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif',
    mono: '"JetBrains Mono", "SF Mono", "Fira Code", Consolas, monospace',
  },
  fontSizes: {
    base: "10.5pt",
    small: "9pt",
    large: "12pt",
    Large: "15pt",
    Huge: "22pt",
    name: "26pt",
    section: "13pt",
  },
  spacing: { unit: "4px", section: "1.1rem", item: "0.28rem", page: "0.55in" },
  page: { size: "Letter", margin: "0.55in", maxWidth: "8.5in" },
  headings: { transform: "uppercase", tracking: "0.06em", nameTracking: "-0.01em" },
};

/** A modern, accent-forward theme with underlined section headings. */
export const modernTheme: Theme = resolveTheme({
  ...styledBase,
  name: "modern",
  colors: {
    primary: "#7c3aed",
    secondary: "#64748b",
    text: "#111827",
    muted: "#64748b",
    background: "#ffffff",
    border: "#e2e8f0",
    accent: "#7c3aed",
  },
  sectionStyle: "underline",
});

/** A restrained, classic serif theme suited to academic CVs. */
export const classicTheme: Theme = resolveTheme({
  ...styledBase,
  name: "classic",
  colors: {
    primary: "#111827",
    secondary: "#4b5563",
    text: "#1e293b",
    muted: "#4b5563",
    background: "#ffffff",
    border: "#cbd5e1",
    accent: "#111827",
  },
  fonts: {
    heading: 'Georgia, "Times New Roman", serif',
    body: 'Georgia, "Times New Roman", serif',
    mono: 'Consolas, "Courier New", monospace',
  },
  sectionStyle: "rule",
});

/** A compact, single-accent theme that maximizes content density. */
export const compactTheme: Theme = resolveTheme({
  ...styledBase,
  name: "compact",
  colors: {
    primary: "#2563eb",
    secondary: "#64748b",
    text: "#1e293b",
    muted: "#64748b",
    background: "#ffffff",
    border: "#e2e8f0",
    accent: "#2563eb",
  },
  fontSizes: {
    base: "9.5pt",
    small: "8pt",
    large: "11pt",
    Large: "13pt",
    Huge: "18pt",
    name: "20pt",
    section: "11pt",
  },
  spacing: { unit: "3px", section: "0.7rem", item: "0.18rem", page: "0.4in" },
  sectionStyle: "bar",
});

/**
 * Built-in theme presets keyed by name. `default` and `blank` both map to the
 * unstyled theme; the styled presets are opt-in (import them, or activate them
 * with `\usepackage{modern}` etc.).
 */
export const themes: Record<string, Theme> = {
  blank: blankTheme,
  default: blankTheme,
  modern: modernTheme,
  classic: classicTheme,
  compact: compactTheme,
};

/** Look up a preset theme by name, falling back to the blank default. */
export function getTheme(name: string): Theme {
  return themes[name] ?? defaultTheme;
}
