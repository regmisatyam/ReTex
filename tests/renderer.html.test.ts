import { describe, it, expect } from "vitest";
import { ReTeXEngine, renderHtml, tokenize, parse, getTheme } from "../src/index.js";

const engine = new ReTeXEngine();
const html = (src: string): string => engine.toHtml(src);

describe("html renderer — structure", () => {
  it("wraps the document in a prefixed container", () => {
    expect(html("hi")).toContain('class="retex-resume"');
  });

  it("builds a header from contact commands", () => {
    const out = html("\\name{Jane Doe}\\title{Engineer}\\email{a@b.com}");
    expect(out).toContain("<header");
    expect(out).toContain('class="retex-name">Jane Doe');
    expect(out).toContain('class="retex-title">Engineer');
    expect(out).toContain('href="mailto:a@b.com"');
  });

  it("groups content under sections", () => {
    const out = html("\\section{Experience}\nSome text");
    expect(out).toContain("<section");
    expect(out).toContain('class="retex-section-title">Experience');
    expect(out).toContain("Some text");
  });

  it("renders marks to semantic tags", () => {
    expect(html("\\textbf{b}")).toContain("<strong>b</strong>");
    expect(html("\\textit{i}")).toContain("<em>i</em>");
    expect(html("\\underline{u}")).toContain("<u>u</u>");
  });

  it("renders external links with rel/target", () => {
    const out = html("\\href{https://x.com}{X}");
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it("renders itemize as a <ul>", () => {
    const out = html("\\begin{itemize}\\item a\\item b\\end{itemize}");
    expect(out).toContain("<ul");
    expect((out.match(/<li>/g) ?? []).length).toBe(2);
  });

  it("renders columns with flex basis", () => {
    const out = html("\\begin{columns}\\column{40%}L\\column{60%}R\\end{columns}");
    expect(out).toContain("retex-columns");
    expect(out).toContain("flex:0 0 40%");
  });

  it("renders skills as pills", () => {
    const out = html("\\skills{A, B}");
    expect(out).toContain("retex-skills");
    expect((out.match(/retex-skill"/g) ?? []).length).toBe(2);
  });

  it("renders an icon as inline SVG", () => {
    expect(html("\\icon{github}")).toContain("<svg");
  });

  it("renders a full job entry", () => {
    const out = html(
      "\\job{title=Eng, company=ACME, start=2020, end=2024, location=NYC}{Did work}",
    );
    expect(out).toContain("retex-entry-title");
    expect(out).toContain("2020 – 2024");
    expect(out).toContain("ACME");
    expect(out).toContain("NYC");
    expect(out).toContain("Did work");
  });

  it("escapes literal percent signs", () => {
    expect(html("Reduced latency by 40%")).toContain("40%");
  });
});

describe("html renderer — full document", () => {
  it("emits a standalone page with styles", () => {
    const out = engine.toHtmlDocument("\\name{Jane}", { title: "Jane CV" });
    expect(out).toContain("<!DOCTYPE html>");
    expect(out).toContain("<style>");
    expect(out).toContain("<title>Jane CV</title>");
    expect(out).toContain(".retex-resume");
  });

  it("respects a custom class prefix", () => {
    expect(renderHtml(parse(tokenize("hi").tokens).ast, { classPrefix: "cv" })).toContain(
      'class="cv-resume"',
    );
  });

  it("reflects theme section style in classes", () => {
    const out = renderHtml(parse(tokenize("\\section{X}").tokens).ast, {
      theme: getTheme("modern"),
    });
    expect(out).toContain("retex-section--underline");
  });
});

describe("html renderer — snapshots", () => {
  it("matches the resume snapshot", () => {
    const src = `\\usepackage{colors}
\\name{John Doe}
\\title{Senior Software Engineer}
\\email{john@example.com}
\\location{New York, NY}

\\section{Experience}
\\job{title=Senior Engineer, company=OpenAI, start=2023, end=Present}{
Built \\textbf{distributed systems}. Reduced latency by 40\\%.
\\begin{itemize}
  \\item Led a team of five
  \\item Shipped \\textcolor{#2563eb}{ReTeX}
\\end{itemize}
}

\\section{Skills}
\\skills{TypeScript, React, Node.js}`;
    expect(html(src)).toMatchSnapshot();
  });

  it("matches the typography snapshot", () => {
    const src =
      "\\usepackage{fonts, colors}\n\\textbf{a} \\textit{b} \\underline{c} {\\Large big} \\textcolor{#fff}{w}";
    expect(html(src)).toMatchSnapshot();
  });
});

describe("html renderer — source map (two-way preview)", () => {
  const SRC = `\\name{Ada Lovelace}
\\section{Experience}
\\job{title=Engineer, company=ACME, start=2021, end=Present}{
Built \\textbf{compilers}.
}`;

  /** Pull the `data-rtx-pos` span for the element of a given `data-rtx-type`. */
  const posOf = (out: string, type: string): [number, number] | null => {
    const m = new RegExp(`data-rtx-pos="(\\d+):(\\d+)" data-rtx-type="${type}"`).exec(
      out,
    );
    return m ? [Number(m[1]), Number(m[2])] : null;
  };

  it("emits no source attributes by default", () => {
    const out = engine.toHtml(SRC);
    expect(out).not.toContain("data-rtx-pos");
    expect(out).not.toContain("data-rtx-type");
  });

  it("annotates structural elements when sourceMap is enabled", () => {
    const out = engine.toHtml(SRC, { sourceMap: true });
    expect(out).toContain('data-rtx-type="section"');
    expect(out).toContain('data-rtx-type="job"');
    expect(out).toContain('data-rtx-type="para"');
    expect(out).toContain('data-rtx-type="bold"');
  });

  it("maps offsets back to the exact source bytes", () => {
    const out = engine.toHtml(SRC, { sourceMap: true });

    const section = posOf(out, "section");
    expect(section).not.toBeNull();
    expect(SRC.slice(section![0], section![1])).toBe("\\section{Experience}");

    const bold = posOf(out, "bold");
    expect(bold).not.toBeNull();
    expect(SRC.slice(bold![0], bold![1])).toBe("\\textbf{compilers}");
  });

  it("nests inline spans inside their paragraph span", () => {
    const out = engine.toHtml(SRC, { sourceMap: true });
    const para = posOf(out, "para")!;
    const bold = posOf(out, "bold")!;
    // The bold run is contained within the paragraph's merged span.
    expect(bold[0]).toBeGreaterThanOrEqual(para[0]);
    expect(bold[1]).toBeLessThanOrEqual(para[1]);
  });

  it("annotates list items and skills", () => {
    const out = engine.toHtml(
      "\\section{S}\n\\begin{itemize}\\item one\\item two\\end{itemize}\n\\skills{A, B}",
      { sourceMap: true },
    );
    expect(out).toContain('data-rtx-type="list"');
    expect(out).toContain('data-rtx-type="item"');
    expect(out).toContain('data-rtx-type="skills"');
  });

  it("keeps the default render byte-for-byte identical to sourceMap:false", () => {
    expect(engine.toHtml(SRC)).toBe(engine.toHtml(SRC, { sourceMap: false }));
  });
});
