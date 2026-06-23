import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  sanitizeUrl,
  isSafeColor,
  isSafeDimension,
  sanitizeStyleValue,
} from "../src/security/index.js";
import { ReTeXEngine } from "../src/index.js";

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
