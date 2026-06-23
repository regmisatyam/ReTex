import { describe, it, expect } from "vitest";
import {
  ReTeXEngine,
  EditorService,
  IncrementalCompiler,
  resolveTheme,
  colorsLibrary,
  shapesLibrary,
  fontsLibrary,
  getBuiltinLibrary,
  resolveLibraryName,
  DiagnosticCode,
  type ReTeXLibrary,
  type CommandNode,
} from "../src/index.js";

describe("libraries — blank core gating", () => {
  it("is blank by default: a styling command needs its library", () => {
    const engine = new ReTeXEngine();
    const { diagnostics } = engine.compile("\\textcolor{red}{x}");
    const codes = diagnostics.map((d) => d.code);
    expect(codes).toContain(DiagnosticCode.LibraryRequired);
    expect(codes).not.toContain(DiagnosticCode.UnknownCommand); // replaced, not duplicated
    const msg = diagnostics.find((d) => d.code === DiagnosticCode.LibraryRequired)!.message;
    expect(msg).toContain("colors");
    // It still renders something (the inner content) but no color styling.
    expect(engine.toHtml("\\textcolor{red}{x}")).not.toContain('style="color');
  });

  it("flags an unknown library name", () => {
    const engine = new ReTeXEngine();
    const { diagnostics } = engine.compile("\\usepackage{nope}\n\\section{X}");
    expect(diagnostics.map((d) => d.code)).toContain(DiagnosticCode.UnknownLibrary);
  });
});

describe("libraries — \\usepackage activation", () => {
  const engine = new ReTeXEngine();
  const html = (src: string) => engine.toHtml(src);

  it("enables \\textcolor via \\usepackage{colors}", () => {
    expect(html("\\usepackage{colors}\n\\textcolor{#2563eb}{x}")).toContain(
      'style="color:#2563eb"',
    );
  });

  it("enables \\hrule and styled variants via \\usepackage{shapes}", () => {
    expect(html("\\usepackage{shapes}\n\\hrule")).toContain('class="retex-rule"');
    expect(html("\\usepackage{shapes}\n\\dashrule")).toContain("retex-rule--dashed");
    expect(html("\\usepackage{shapes}\n\\doublerule")).toContain("retex-rule--double");
  });

  it("enables size switches and \\fontfamily via \\usepackage{fonts}", () => {
    expect(html("\\usepackage{fonts}\n{\\Large big}")).toContain("retex-scale-Large");
    expect(html("\\usepackage{fonts}\n\\fontfamily{Georgia}{x}")).toContain(
      "font-family:Georgia",
    );
  });

  it("accepts comma-separated imports and aliases", () => {
    const out = html("\\usepackage{color, shape}\n\\textcolor{#000}{x}\\hrule");
    expect(out).toContain('style="color:#000"');
    expect(out).toContain('class="retex-rule"');
  });

  it("supports the \\use alias", () => {
    expect(html("\\use{colors}\n\\textcolor{#000}{x}")).toContain('style="color');
  });

  it("compiles cleanly once the library is imported", () => {
    const { diagnostics } = engine.compile("\\usepackage{colors}\n\\textcolor{#2563eb}{x}");
    expect(diagnostics).toHaveLength(0);
  });

  it("theme packs bundle a styled look plus the toolkits", () => {
    const out = html("\\usepackage{modern}\n\\section{X}\n\\textcolor{#000}{y}");
    expect(out).toContain("retex-section--underline"); // modern theme
    expect(out).toContain('style="color:#000"'); // colors toolkit bundled
    expect(engine.styles("\\usepackage{modern}")).toContain("#7c3aed");
  });
});

describe("libraries — programmatic activation", () => {
  it("engine.use(lib) makes commands available without a directive", () => {
    const engine = new ReTeXEngine().use(colorsLibrary).use(shapesLibrary);
    expect(engine.toHtml("\\textcolor{#000}{x}")).toContain('style="color:#000"');
    expect(engine.toHtml("\\hrule")).toContain('class="retex-rule"');
    expect(engine.compile("\\textcolor{#000}{x}").diagnostics).toHaveLength(0);
  });

  it("provideLibrary registers a custom library for \\usepackage (with render overrides)", () => {
    const callout: ReTeXLibrary = {
      name: "callout",
      commands: [
        {
          name: "callout",
          category: "inline",
          args: [{ kind: "content", name: "x" }],
          render: {
            html: (node, _ctx, kids) =>
              `<mark>${kids((node as CommandNode).args[0]?.children ?? [])}</mark>`,
          },
        },
      ],
    };
    const engine = new ReTeXEngine().provideLibrary(callout);
    // Not active until imported.
    expect(engine.compile("\\callout{hi}").diagnostics.length).toBeGreaterThan(0);
    // Imported: command parses and its render override applies per-document.
    const out = engine.toHtml("\\usepackage{callout}\n\\callout{hi}");
    expect(out).toContain("<mark>");
    expect(out).toContain("hi");
  });
});

describe("libraries — resolution helpers", () => {
  it("resolves names and aliases", () => {
    expect(resolveLibraryName("colors")).toBe("colors");
    expect(resolveLibraryName("color")).toBe("colors"); // alias
    expect(resolveLibraryName("FONTS")).toBe("fonts"); // case-insensitive
    expect(resolveLibraryName("nope")).toBeUndefined();
    expect(getBuiltinLibrary("shape")).toBe(shapesLibrary);
    expect(getBuiltinLibrary("fonts")).toBe(fontsLibrary);
  });
});

describe("libraries — editor awareness", () => {
  const ed = new EditorService();

  it("diagnoses a gated command and points at the library", () => {
    const codes = ed.getDiagnostics("\\textcolor{red}{x}").map((d) => d.code);
    expect(codes).toContain(DiagnosticCode.LibraryRequired);
  });

  it("recognizes a command once its library is imported", () => {
    const codes = ed
      .getDiagnostics("\\usepackage{colors}\n\\textcolor{#000}{x}")
      .map((d) => d.code);
    expect(codes).not.toContain(DiagnosticCode.LibraryRequired);
  });

  it("surfaces gated commands in completion (annotated with the library)", () => {
    const items = ed.getCompletions("\\textc", 6);
    const textcolor = items.find((i) => i.label === "\\textcolor");
    expect(textcolor).toBeTruthy();
    expect(textcolor!.detail).toContain("usepackage{colors}");
  });

  it("merges imported library themes when validating \\themecolor", () => {
    // Base theme lacks a `primary` token, but \usepackage{modern} provides it.
    const editor = new EditorService({ theme: resolveTheme({ colors: { text: "#111" } }) });
    const ok = editor
      .getDiagnostics("\\usepackage{modern}\n\\themecolor{primary}{x}")
      .map((d) => d.code);
    expect(ok).not.toContain(DiagnosticCode.UnknownThemeColor);
    // A token no active theme/library provides is still flagged.
    const bad = editor
      .getDiagnostics("\\usepackage{modern}\n\\themecolor{nope}{x}")
      .map((d) => d.code);
    expect(bad).toContain(DiagnosticCode.UnknownThemeColor);
  });
});

describe("libraries — incremental compiler", () => {
  it("activates built-in libraries across blocks", () => {
    const inc = new IncrementalCompiler();
    const r = inc.compile("\\usepackage{colors}\n\n\\textcolor{#222}{x}");
    expect(r.diagnostics.map((d) => d.code)).not.toContain(DiagnosticCode.LibraryRequired);
  });

  it("accepts custom libraries via options", () => {
    const spark: ReTeXLibrary = {
      name: "spark",
      commands: [
        {
          name: "spark",
          category: "inline",
          args: [{ kind: "content", name: "x" }],
          build: ({ args }) => ({ type: "bold", children: args[0]?.children ?? [] }),
        },
      ],
    };
    const inc = new IncrementalCompiler({ libraries: [spark] });
    const codes = inc.compile("\\usepackage{spark}\n\n\\spark{hi}").diagnostics.map((d) => d.code);
    expect(codes).not.toContain(DiagnosticCode.LibraryRequired);
    expect(codes).not.toContain(DiagnosticCode.UnknownLibrary);
  });
});
