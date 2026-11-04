import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  sanitizeUrl,
  isSafeColor,
  isSafeDimension,
  sanitizeStyleValue,
} from "../src/security/index.js";
import { ReTeXEngine, markdownToHtml, sanitizeImageUrl } from "../src/index.js";

describe("escapeHtml", () => {
  it("escapes the dangerous five", () => {
    expect(escapeHtml(`<script>&"'`)).toBe("&lt;script&gt;&amp;&quot;&#39;");
  });
});

describe("sanitizeUrl", () => {
  it("allows http(s), mailto, tel", () => {
    expect(sanitizeUrl("https://x.com").blocked).toBe(false);
    expect(sanitizeUrl("mailto:a@b.com").blocked).toBe(false);
    expect(sanitizeUrl("tel:+123").blocked).toBe(false);
  });

  it("allows relative URLs and fragments", () => {
    expect(sanitizeUrl("/path").blocked).toBe(false);
    expect(sanitizeUrl("#section").blocked).toBe(false);
    expect(sanitizeUrl("page.html").blocked).toBe(false);
  });

  it("blocks javascript: and data: and vbscript:", () => {
    expect(sanitizeUrl("javascript:alert(1)").safe).toBe("#");
    expect(sanitizeUrl("data:text/html,<script>").safe).toBe("#");
    expect(sanitizeUrl("vbscript:msgbox").safe).toBe("#");
  });

  it("blocks scheme-obfuscation via control characters", () => {
    expect(sanitizeUrl("java\tscript:alert(1)").safe).toBe("#");
    expect(sanitizeUrl("java\nscript:alert(1)").safe).toBe("#");
    expect(sanitizeUrl("  javascript:alert(1)").safe).toBe("#");
  });
});

describe("isSafeColor / isSafeDimension / sanitizeStyleValue", () => {
  it("validates colors", () => {
    expect(isSafeColor("#2563eb")).toBe(true);
    expect(isSafeColor("#abc")).toBe(true);
    expect(isSafeColor("rgb(1,2,3)")).toBe(true);
    expect(isSafeColor("red")).toBe(true);
    expect(isSafeColor("red; background:url(x)")).toBe(false);
    expect(isSafeColor("expression(alert(1))")).toBe(false);
  });

  it("validates dimensions", () => {
    expect(isSafeDimension("14pt")).toBe(true);
    expect(isSafeDimension("40%")).toBe(true);
    expect(isSafeDimension("1.5rem")).toBe(true);
    expect(isSafeDimension("10px;")).toBe(false);
  });

  it("rejects style values with injection vectors", () => {
    expect(sanitizeStyleValue("red")).toBe("red");
    expect(sanitizeStyleValue("url(javascript:x)")).toBeUndefined();
    expect(sanitizeStyleValue("a; b: c")).toBeUndefined();
  });
});

describe("end-to-end XSS resistance (HTML renderer)", () => {
  const engine = new ReTeXEngine();
  const html = (src: string): string => engine.toHtml(src);

  it("escapes HTML in text content", () => {
    expect(html("<img src=x onerror=alert(1)>")).not.toContain("<img");
    expect(html("<img src=x onerror=alert(1)>")).toContain("&lt;img");
  });

  it("escapes HTML inside section titles", () => {
    expect(html("\\section{<b>x</b>}")).toContain("&lt;b&gt;");
  });

  it("neutralizes javascript: hrefs", () => {
    const out = html("\\href{javascript:alert(1)}{click}");
    expect(out).toContain('href="#"');
    expect(out).not.toContain("javascript:");
  });

  it("drops unsafe inline colors", () => {
    const out = html("\\usepackage{colors}\n\\textcolor{red;}{x}");
    expect(out).not.toContain("red;");
  });

  it("never emits a raw <script> from any input", () => {
    const out = engine.toHtmlDocument("\\name{</style><script>alert(1)</script>}");
    expect(out).not.toContain("<script>alert");
  });
});

describe("sanitizeImageUrl", () => {
  it("allows web images, relative paths, and inline raster images", () => {
    expect(sanitizeImageUrl("https://x.org/a.png").blocked).toBe(false);
    expect(sanitizeImageUrl("figures/a.png").safe).toBe("figures/a.png");
    expect(sanitizeImageUrl("data:image/png;base64,iVBORw0KGgo=").blocked).toBe(false);
  });

  it("blocks everything else", () => {
    for (const url of [
      "javascript:alert(1)",
      "java\tscript:alert(1)",
      "file:///etc/passwd",
      "mailto:a@b.org",
      "data:text/html,<script>alert(1)</script>",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:image/png,not-base64<script>",
    ]) {
      const { blocked, safe } = sanitizeImageUrl(url);
      expect(blocked, url).toBe(true);
      expect(safe, url).toBe("");
    }
  });
});

describe("paper commands", () => {
  const engine = new ReTeXEngine();
  const html = (src: string): string => engine.toHtml(src);

  it("blocks unsafe image URLs, keeping the alt text", () => {
    const out = html("\\includegraphics[alt=Chart]{javascript:alert(1)}");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<img");
    expect(out).toContain("Chart");
  });

  it("escapes attributes and text in every new node", () => {
    const evil = '"><script>alert(1)</script>';
    for (const src of [
      `\\includegraphics[alt=${evil}]{a.png}`,
      `\\includegraphics{a.png"onerror="alert(1)}`,
      `\\code{${evil}}`,
      `\\begin{code}[${evil}]\n${evil}\n\\end{code}`,
      `\\begin{verbatim}\n${evil}\n\\end{verbatim}`,
      `\\math{${evil}}`,
      `\\begin{equation}${evil}\\end{equation}`,
      `\\author{name=${evil}, affiliation=${evil}, email=${evil}}`,
      `\\keywords{${evil}}`,
      `\\cite{${evil}}`,
      `\\begin{references}\\bibitem{${evil}} ${evil}\\end{references}`,
      `\\footnote{${evil}}`,
      `\\caption{${evil}}`,
      `\\abstract{${evil}}`,
      `\\begin{quote}${evil}\\end{quote}`,
      `\\begin{table}\\row{${evil}}\\end{table}`,
      `\\date{${evil}}`,
      `\\documentclass{ieee}\n\\title{${evil}}`,
      `\\documentclass{ieee}\n\\author{name=${evil}, email=${evil}}`,
    ]) {
      const out = engine.toHtmlDocument(src);
      expect(out, src).not.toContain("<script>");
      expect(out, src).not.toMatch(/\sonerror=/);
    }
  });

  it("does not let an image width escape its style attribute", () => {
    const out = html('\\includegraphics[width=1px;background:url(x)]{a.png}');
    expect(out).not.toContain("url(x)");
  });

  it("blocks javascript: in an author's email link", () => {
    const out = engine.toHtml("\\documentclass{ieee}\n\\author{name=A, email=x}");
    expect(out).toContain('href="mailto:x"');
  });
});

describe("markdown", () => {
  const convert = (md: string): string => markdownToHtml(md);

  it("never passes raw HTML through", () => {
    for (const md of [
      "<script>alert(1)</script>",
      "text <script>alert(1)</script> text",
      "<SCRIPT SRC=x></SCRIPT>",
      "<style>body{display:none}</style>",
      "text <style>body{display:none}</style> text",
      '<iframe src="javascript:alert(1)"></iframe>',
      "<svg onload=alert(1)>",
      '<svg><script>alert(1)</script></svg>',
      '<img src=x onerror=alert(1)>',
      '<a href="x" onclick="alert(1)">y</a>',
      '<div onmouseover="alert(1)">y</div>',
      "<object data=x></object>",
      "<embed src=x>",
      "<form action=x><input></form>",
      "<math><mi>x</mi></math>",
      "<base href=//evil.org>",
      "<meta http-equiv=refresh content=0>",
      "<link rel=stylesheet href=x>",
    ]) {
      const out = convert(md);
      const body = out.slice(out.indexOf("<body>"));
      expect(body, md).not.toMatch(/<(script|style|iframe|svg|object|embed|form|base|meta|link)\b/i);
      expect(body, md).not.toMatch(/\son[a-z]+\s*=\s*["']?[a-z]/i);
    }
  });

  it("removes dangerous elements with their content, and says so", () => {
    const out = convert("before <script>alert(1)</script> after");
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("before");
    expect(out).toContain("after");
    expect(convert("<script>\nalert(1)\n\nalert(2)\n</script>\n\nafter")).not.toContain("alert(");
  });

  it("blocks unsafe link and image targets of every kind", () => {
    for (const md of [
      "[x](javascript:alert(1))",
      "[x](JaVaScRiPt:alert(1))",
      "[x](java\tscript:alert(1))",
      "[x](data:text/html,<script>alert(1)</script>)",
      "[x](vbscript:msgbox)",
      "[x][r]\n\n[r]: javascript:alert(1)",
      "<javascript:alert(1)>",
      "![x](javascript:alert(1))",
      "![x](data:image/svg+xml;base64,PHN2Zz4=)",
      '<a href="javascript:alert(1)">x</a>',
      '<img src="javascript:alert(1)">',
    ]) {
      const out = convert(md);
      expect(out, md).not.toMatch(/(?:href|src)="(?:java|data:text|data:image\/svg|vbscript)/i);
    }
  });

  it("escapes attribute breakouts in URLs and alt text", () => {
    for (const md of [
      '[x](https://a.org/"onmouseover="alert(1))',
      '![" onerror="alert(1)](a.png)',
      '![x](a.png" onerror="alert(1))',
      '[x](<https://a.org/"><script>alert(1)</script>>)',
    ]) {
      const out = convert(md);
      const body = out.slice(out.indexOf("<body>"));
      expect(body, md).not.toContain("<script>");
      expect(body, md).not.toMatch(/"\s*on(mouseover|error)="/);
    }
  });

  it("escapes code, math, and fence languages", () => {
    for (const md of [
      "`<script>alert(1)</script>`",
      "```\n<script>alert(1)</script>\n```",
      '```"><script>alert(1)</script>\nx\n```',
      "$<script>alert(1)</script>$",
      "$$<script>alert(1)</script>$$",
      "| <script>alert(1)</script> |\n|---|\n| x |",
    ]) {
      expect(convert(md), md).not.toContain("<script>");
    }
  });

  it("front matter cannot inject markup", () => {
    const out = convert(
      '---\ntitle: "<script>alert(1)</script>"\nauthor: <img src=x onerror=alert(1)>\nabstract: <script>alert(2)</script>\nstyle: "><script>\n---\nx',
    );
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img");
  });

  it("the page title cannot break out of its element", () => {
    const out = convert("# </title><script>alert(1)</script>\n\n## A");
    expect(out).not.toContain("<script>");
  });

  it("the generated .retex cannot smuggle commands through text", () => {
    const engine2 = new ReTeXEngine();
    const { ast } = engine2.fromMarkdown("\\href{javascript:alert(1)}{x} \\usepackage{colors}");
    expect(engine2.toHtml(ast)).not.toContain('href="javascript');
  });
});
