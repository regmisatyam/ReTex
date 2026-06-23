import { describe, it, expect } from "vitest";
import {
  resolveTheme,
  getTheme,
  themes,
  defaultTheme,
  blankTheme,
  modernTheme,
  themeToCss,
  ReTeXEngine,
} from "../src/index.js";

describe("theming", () => {
  it("defaults to a blank theme with no styling", () => {
    expect(defaultTheme).toBe(blankTheme);
    expect(defaultTheme.name).toBe("blank");
    const t = resolveTheme();
    expect(t.name).toBe("blank");
    expect(t.colors).toEqual({}); // no colors defined
    expect(t.sectionStyle).toBeUndefined(); // no section decoration
  });

  it("deep-merges partial overrides over a base", () => {
    const t = resolveTheme({ colors: { primary: "#ff0000" } }, modernTheme);
    expect(t.colors?.primary).toBe("#ff0000");
    expect(t.colors?.text).toBe(modernTheme.colors?.text); // untouched
    expect(t.fonts?.body).toBe(modernTheme.fonts?.body);
  });

  it("ships named presets (blank by default, styling opt-in)", () => {
    expect(Object.keys(themes)).toEqual(
      expect.arrayContaining(["blank", "default", "modern", "classic", "compact"]),
    );
    expect(getTheme("modern").sectionStyle).toBe("underline");
    expect(getTheme("unknown")).toBe(defaultTheme);
  });

  it("emits CSS variables for every color (including custom tokens)", () => {
    const css = themeToCss(resolveTheme({ colors: { brand: "#123456" } }));
    expect(css).toContain("--retex-color-brand: #123456");
    expect(css).toContain("--retex-primary:");
  });

  it("renders the blank theme with neutral fallbacks", () => {
    const css = themeToCss(resolveTheme());
    expect(css).toContain("--retex-primary: inherit");
    expect(css).toContain("--retex-font-body: inherit");
    expect(css).toContain("--retex-section-transform: none");
  });

  it("applies a theme through the engine", () => {
    const engine = new ReTeXEngine({ theme: { colors: { primary: "#7c3aed" } } });
    expect(engine.getTheme().colors?.primary).toBe("#7c3aed");
    expect(engine.styles()).toContain("#7c3aed");
  });

  it("resolves \\themecolor against the active theme palette", () => {
    const engine = new ReTeXEngine();
    const out = engine.toHtml("\\usepackage{colors}\n\\themecolor{primary}{x}");
    expect(out).toContain("var(--retex-color-primary");
  });

  it("activates a full styled look via \\usepackage{modern}", () => {
    const engine = new ReTeXEngine();
    const out = engine.toHtml("\\usepackage{modern}\n\\section{Experience}");
    expect(out).toContain("retex-section--underline");
    expect(engine.styles("\\usepackage{modern}")).toContain("#7c3aed");
  });
});

describe("CSS injection — theme values are sanitized", () => {
  // A malicious color/value containing `}` would otherwise close the
  // `.retex-resume { … }` rule and let arbitrary top-level rules through
  // (`} .hacked { … }` is valid CSS once the rule closes). themeToCss must
  // vet every embedded theme value, so injection vectors are dropped to the
  // neutral fallback.

  const braceBalanced = (css: string): boolean => {
    let depth = 0;
    for (const ch of css) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      if (depth < 0) return false;
    }
    return depth === 0;
  };

  it("drops an injecting color value (uses the neutral fallback)", () => {
    const evil = "#fff; } .hacked { display: block;";
    const css = themeToCss(resolveTheme({ colors: { primary: evil } }));
    expect(css).not.toContain(".hacked");
    expect(css).not.toContain(evil);
    expect(css).toContain("--retex-primary: inherit"); // fell back, not injected
    expect(braceBalanced(css)).toBe(true);
  });

  it("drops an injecting color that breaks out of a custom property", () => {
    const css = themeToCss(
      resolveTheme({ colors: { primary: "#fff}body{background:red" } }),
    );
    expect(css).not.toContain("body{background:red");
    expect(braceBalanced(css)).toBe(true);
  });

  it("sanitizes font, size, spacing, page, and heading values too", () => {
    const css = themeToCss(
      resolveTheme({
        fonts: { body: "Arial; } .x { color: red" },
        fontSizes: { base: "12px; } .y {" },
        spacing: { page: "1in; } .z {" },
        page: { maxWidth: "8.5in; } .w {" },
        headings: { transform: "uppercase; } .v {" },
      }),
    );
    for (const probe of [".x", ".y", ".z", ".w", ".v"]) {
      expect(css).not.toContain(probe);
    }
    expect(braceBalanced(css)).toBe(true);
  });

  it("still passes through legitimate styled themes unchanged", () => {
    const css = themeToCss(modernTheme);
    expect(css).toContain("#7c3aed"); // valid color survives
    expect(css).toContain("--retex-section-transform: uppercase"); // valid keyword survives
    expect(braceBalanced(css)).toBe(true);
  });
});
