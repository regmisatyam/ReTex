import { describe, it, expect } from "vitest";
import { EditorService } from "../src/index.js";

const ed = new EditorService();

describe("editor — completion", () => {
  it("completes command names by prefix", () => {
    const items = ed.getCompletions("\\sec", 4);
    expect(items.map((i) => i.label)).toContain("\\section");
    expect(items[0]!.kind).toBe("command");
    expect(items.find((i) => i.label === "\\section")!.snippet).toContain("section{");
  });

  it("completes environment names after \\begin{", () => {
    const items = ed.getCompletions("\\begin{it", 9);
    expect(items.map((i) => i.label)).toContain("itemize");
    expect(items[0]!.kind).toBe("environment");
  });

  it("suggests field keys inside a \\job{...}", () => {
    const items = ed.getCompletions("\\job{tit", 8);
    expect(items.map((i) => i.label)).toContain("title");
    expect(items[0]!.kind).toBe("field");
  });

  it("provides a replacement range for the partial token", () => {
    const items = ed.getCompletions("\\sec", 4);
    const section = items.find((i) => i.label === "\\section")!;
    expect(section.range!.start.offset).toBe(0);
    expect(section.range!.end.offset).toBe(4);
  });
});

describe("editor — hover", () => {
  it("documents a known command", () => {
    const hover = ed.getHover("\\section{X}", 3);
    expect(hover).toBeTruthy();
    expect(hover!.contents).toContain("\\section");
    expect(hover!.contents.toLowerCase()).toContain("section");
  });

  it("documents an environment", () => {
    const hover = ed.getHover("\\begin{itemize}", 3);
    expect(hover!.contents).toContain("itemize");
  });

  it("flags an unknown command on hover", () => {
    const hover = ed.getHover("\\nope{}", 3);
    expect(hover!.contents).toContain("Unknown");
  });

  it("returns null when not over a command", () => {
    expect(ed.getHover("plain text", 3)).toBeNull();
  });
});

describe("editor — semantic tokens", () => {
  it("classifies tokens for highlighting", () => {
    const tokens = ed.getSemanticTokens("\\section{Hi} 40%");
    const cmd = tokens.find((t) => t.type === "command");
    expect(cmd).toBeTruthy();
    expect(cmd!.modifiers).toContain("block");
    expect(tokens.some((t) => t.type === "brace")).toBe(true);
  });

  it("marks unknown commands distinctly", () => {
    const tokens = ed.getSemanticTokens("\\zzz");
    expect(tokens[0]!.type).toBe("command-unknown");
  });
});

describe("editor — diagnostics & inspect", () => {
  it("returns diagnostics for a source string", () => {
    expect(ed.getDiagnostics("\\item x").length).toBeGreaterThan(0);
  });

  it("inspects the AST", () => {
    expect(ed.inspect("\\section{X}").type).toBe("document");
  });
});

describe("editor — formatting", () => {
  it("formats and is idempotent", () => {
    const src =
      "\\section{Experience}\n\\job{title=Eng, company=ACME}{Did \\textbf{work}}";
    const once = ed.format(src);
    const twice = ed.format(once);
    expect(twice).toBe(once);
    expect(once).toContain("\\section{Experience}");
    expect(once).toContain("\\job{");
  });

  it("round-trips a list", () => {
    const out = ed.format("\\begin{itemize}\\item a\\item b\\end{itemize}");
    expect(out).toContain("\\begin{itemize}");
    expect(out).toContain("\\item a");
    expect(out).toContain("\\end{itemize}");
  });

  it("preserves the contact -icon variant when formatting", () => {
    expect(ed.format("\\email-icon{a@b.com}")).toContain("\\email-icon{a@b.com}");
    expect(ed.format("\\email{a@b.com}")).toContain("\\email{a@b.com}");
  });
});
