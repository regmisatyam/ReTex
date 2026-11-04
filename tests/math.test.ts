import { describe, it, expect } from "vitest";
import { estimateMathWidth, texToMathML } from "../src/index.js";

const ml = (tex: string, display = false): string =>
  texToMathML(tex, { display }).mathml.replace(/<annotation.*<\/annotation>/, "");
const errors = (tex: string): string[] => texToMathML(tex).errors;

/** Every element a script wraps must have exactly the right number of children. */
function assertWellFormed(tex: string, display = false): void {
  const { mathml } = texToMathML(tex, { display });
  const arity: Record<string, number> = {
    msub: 2,
    msup: 2,
    msubsup: 3,
    munder: 2,
    mover: 2,
    munderover: 3,
    mfrac: 2,
    mroot: 2,
  };
  const stack: Array<{ name: string; children: number }> = [];
  const re = /<(\/?)([a-z]+)[^>]*?(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(mathml))) {
    const [, close, name] = m;
    if (close) {
      const top = stack.pop();
      expect(top?.name, `${tex}: closing ${name}`).toBe(name);
      const want = arity[name!];
      if (want !== undefined) {
        expect(top!.children, `${tex}: <${name}> children\n${mathml}`).toBe(want);
      }
    } else {
      if (stack.length > 0) stack[stack.length - 1]!.children++;
      stack.push({ name: name!, children: 0 });
    }
  }
  expect(stack, tex).toEqual([]);
}

describe("math: structure", () => {
  it("wraps output in <math>, keeping the source as an annotation", () => {
    const { mathml } = texToMathML("x", { display: true });
    expect(mathml).toMatch(/^<math display="block"><semantics>/);
    expect(mathml).toContain('<annotation encoding="application/x-tex">x</annotation>');
    expect(texToMathML("x").mathml).toContain('display="inline"');
  });

  it("identifiers, numbers, and operators", () => {
    expect(ml("x")).toContain("<mi>x</mi>");
    expect(ml("3.14")).toContain("<mn>3.14</mn>");
    expect(ml("a+b")).toContain("<mo>+</mo>");
    expect(ml("a-b")).toContain("−");
  });

  it("scripts", () => {
    expect(ml("x^2")).toContain("<msup><mi>x</mi><mn>2</mn></msup>");
    expect(ml("x_i")).toContain("<msub><mi>x</mi><mi>i</mi></msub>");
    expect(ml("x_i^2")).toContain("<msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup>");
    expect(ml("x^2_i")).toContain("<msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup>");
    expect(ml("x^{ab}")).toContain("<msup><mi>x</mi><mrow><mi>a</mi><mi>b</mi></mrow></msup>");
    expect(ml("x'")).toContain("′");
    expect(ml("x''")).toContain("′′");
  });

  it("fractions and roots", () => {
    expect(ml("\\frac{a}{b}")).toContain("<mfrac><mrow><mi>a</mi></mrow><mrow><mi>b</mi></mrow></mfrac>");
    expect(ml("\\frac12")).toContain("<mfrac><mn>1</mn><mn>2</mn></mfrac>");
    expect(ml("\\sqrt{x}")).toContain("<msqrt>");
    expect(ml("\\sqrt[3]{x}")).toContain("<mroot>");
    expect(ml("\\binom{n}{k}")).toContain('linethickness="0"');
  });

  it("big operators take limits above and below only in display style", () => {
    expect(ml("\\sum_{i=1}^n x", true)).toContain("<munderover>");
    expect(ml("\\sum_{i=1}^n x", false)).toContain("<msubsup>");
    expect(ml("\\int_0^1 x", true)).toContain("<msubsup>");
    expect(ml("\\sum\\limits_{i} x", false)).toContain("<munder>");
    expect(ml("\\sum\\nolimits_{i} x", true)).toContain("<msub>");
    expect(ml("\\lim_{x \\to 0} f", true)).toContain("<munder>");
  });

  it("delimiters only stretch when asked", () => {
    expect(ml("(x)")).toContain('<mo stretchy="false">(</mo>');
    expect(ml("\\left( x \\right)")).toContain('<mo stretchy="true" fence="true">(</mo>');
    expect(ml("\\left. x \\right|")).not.toContain(">.<");
    expect(ml("\\bigl( x \\bigr)")).toContain('minsize="1.2em"');
    expect(ml("\\left( a \\middle| b \\right)")).toContain('<mo stretchy="true">|</mo>');
  });

  it("Unicode math fonts, since MathML Core has no mathvariant", () => {
    expect(ml("\\mathbb{R}")).toContain("ℝ");
    expect(ml("\\mathbb{N}")).toContain("ℕ");
    expect(ml("\\mathcal{L}")).toContain("ℒ");
    expect(ml("\\mathcal{A}")).toContain("𝒜");
    expect(ml("\\mathbf{x}")).toContain("𝐱");
    expect(ml("\\mathbf{1}")).toContain("𝟏");
    expect(ml("\\boldsymbol{\\theta}")).toContain("𝜽");
    expect(ml("\\mathfrak{g}")).toContain("𝔤");
    expect(ml("\\mathrm{d}")).toContain('<mi mathvariant="normal">d</mi>');
    expect(ml("\\mathbf{x} y")).toContain("<mi>y</mi>");
  });

  it("text", () => {
    expect(ml("\\text{if } x")).toContain("<mtext>if\u00a0</mtext>");
    expect(ml("\\text{50\\%}")).toContain("<mtext>50%</mtext>");
    expect(ml("\\textbf{a}")).toContain("font-weight:bold");
  });

  it("environments", () => {
    const matrix = ml("\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}");
    expect(matrix.match(/<mtr>/g)).toHaveLength(2);
    expect(matrix.match(/<mtd/g)).toHaveLength(4);
    expect(matrix).toContain(">(</mo>");
    expect(ml("\\begin{bmatrix} a \\end{bmatrix}")).toContain(">[</mo>");
    expect(ml("\\begin{vmatrix} a \\end{vmatrix}")).toContain(">|</mo>");
    expect(ml("\\begin{cases} a & b \\\\ c & d \\end{cases}")).toContain(">{</mo>");
    expect(ml("\\begin{align} a &= b \\\\ c &= d \\end{align}")).toContain("text-align:right");
    expect(ml("\\begin{array}{lr} a & b \\end{array}")).toContain("text-align:left");
  });

  it("a trailing row break adds no empty row", () => {
    expect(ml("\\begin{matrix} a \\\\ b \\\\ \\end{matrix}").match(/<mtr>/g)).toHaveLength(2);
  });

  it("escapes and spacing", () => {
    expect(ml("\\{x\\}")).toContain('<mo stretchy="false">{</mo>');
    expect(ml("50\\%")).toContain("<mo>%</mo>");
    expect(ml("a\\,b")).toContain('width="0.167em"');
    expect(ml("a\\quad b")).toContain('width="1em"');
  });

  it("accents", () => {
    expect(ml("\\hat{x}")).toContain('<mover accent="true"><mrow><mi>x</mi></mrow>');
    expect(ml("\\vec{x}")).toContain("→");
    expect(ml("\\bar{x}")).toContain("¯");
    expect(ml("\\overline{xy}")).toContain("‾");
    expect(ml("\\underline{x}")).toContain("<munder");
  });

  it("negation", () => {
    expect(ml("a \\not= b")).toContain("=\u0338");
    expect(ml("a \\not\\in b")).toContain("∈\u0338");
  });

  it("Unicode typed directly", () => {
    expect(ml("α ≤ β")).toContain("<mi>α</mi>");
    expect(ml("α ≤ β")).toContain("<mo>≤</mo>");
  });

  it("minus is unary after an operator, binary after a term", () => {
    expect(ml("= -x")).toContain('<mo lspace="0" rspace="0">−</mo>');
    expect(ml("-x")).toContain('<mo lspace="0" rspace="0">−</mo>');
    expect(ml("\\leq -x")).toContain('<mo lspace="0" rspace="0">−</mo>');
    expect(ml("a - x")).toContain("<mo>−</mo>");
    expect(ml("\\alpha - x")).toContain("<mo>−</mo>");
  });

  it("named functions are upright and spaced", () => {
    expect(ml("\\sin x")).toContain("<mi>sin</mi>");
    expect(ml("a \\log b")).toContain('<mspace width="0.167em"></mspace><mi>log</mi>');
    expect(ml("(\\log b)")).not.toContain('<mspace width="0.167em"></mspace><mi>log</mi>');
    expect(ml("\\operatorname{foo}(x)")).toContain("<mi>foo</mi>");
    expect(ml("\\operatorname*{argmax}_x y", true)).toContain("<munder><mi>argmax</mi>");
  });
});

describe("math: well-formed output", () => {
  // Regression: `\log_2` once produced an <msub> with three children.
  const formulas = [
    "\\log_2 n",
    "\\log^2 n",
    "a \\log_2 n",
    "\\sin^2 x + \\cos^2 x = 1",
    "\\lim_{x \\to 0} f(x)",
    "\\max_{i} x_i",
    "\\arg\\max_x f",
    "\\operatorname{rank}_k A",
    "\\sum_{i=1}^{n} \\frac{a_i}{b_i}",
    "\\int_0^\\infty e^{-x^2} dx",
    "\\prod_{i} x_i",
    "\\overbrace{a+b}^{n}",
    "\\underbrace{a+b}_{n}",
    "x^{y^{z^w}}",
    "x_{i_{j_k}}",
    "{x}^2",
    "\\frac{\\frac{a}{b}}{\\frac{c}{d}}",
    "\\sqrt{\\sqrt{x}}",
    "\\hat{x}_i^2",
    "\\mathbb{E}[X]^2",
    "a \\pmod{n}",
    "a \\bmod n",
    "x \\tag{1}",
    "\\begin{pmatrix} a^2 & b_i \\\\ \\frac{c}{d} & \\sqrt{e} \\end{pmatrix}^{-1}",
    "\\begin{cases} x^2 & x > 0 \\\\ 0 & \\text{otherwise} \\end{cases}",
    "\\xrightarrow[below]{above}",
    "\\xrightarrow{above}",
    "\\overset{a}{b}",
    "\\underset{a}{b}",
    "\\substack{a \\\\ b}",
    "\\sum_{\\substack{i < n \\\\ j < m}} x",
    "\\phantom{x} \\boxed{y} \\cancel{z}",
    "\\textcolor{red}{x}",
    "\\displaystyle \\sum_i x",
    "\\left( \\frac{a}{b} \\right)^2",
    "\\left( a \\middle| b \\right)_c",
  ];
  for (const tex of formulas) {
    it(tex, () => {
      assertWellFormed(tex, false);
      assertWellFormed(tex, true);
      expect(errors(tex)).toEqual([]);
    });
  }
});

describe("math: errors and safety", () => {
  it("reports an unknown command and shows its source", () => {
    const { mathml, errors: found } = texToMathML("\\nosuchcommand{x}");
    expect(found[0]).toContain("nosuchcommand");
    expect(mathml).toContain("\\nosuchcommand");
    expect(mathml).toContain("<mi>x</mi>");
  });

  it("recovers from broken input without throwing or looping", () => {
    for (const tex of [
      "",
      "{",
      "}",
      "^",
      "_",
      "^^",
      "x^",
      "\\",
      "\\frac",
      "\\frac{a}",
      "\\sqrt[",
      "\\left(",
      "\\right)",
      "\\begin{pmatrix}",
      "\\end{pmatrix}",
      "\\begin{nope}x\\end{nope}",
      "\\begin{",
      "&&&",
      "\\\\\\\\",
      "'''",
      "\\text{",
      "\\not",
      "\\big",
      "\\left\\",
    ]) {
      expect(() => texToMathML(tex), tex).not.toThrow();
      assertWellFormed(tex);
    }
  });

  it("survives pathological nesting", () => {
    expect(() => texToMathML("{".repeat(20000))).not.toThrow();
    expect(() => texToMathML("\\frac{".repeat(5000))).not.toThrow();
    expect(() => texToMathML("x^".repeat(20000))).not.toThrow();
    expect(() => texToMathML("\\sqrt{".repeat(5000))).not.toThrow();
    expect(() => texToMathML("\\left(".repeat(5000))).not.toThrow();
    expect(() => texToMathML("\\begin{matrix}".repeat(3000))).not.toThrow();
    expect(() => texToMathML("\\mathbf{".repeat(5000))).not.toThrow();
  });

  it("escapes everything that reaches the markup", () => {
    for (const tex of [
      "<script>alert(1)</script>",
      "\\text{<img src=x onerror=alert(1)>}",
      "\\operatorname{<b>}",
      "\\tag{<b>}",
      '\\nosuch<script>',
      "\\textcolor{red;background:url(x)}{y}",
      '\\hspace{1em"><script>}',
      "a<b",
      'x"y',
    ]) {
      const { mathml } = texToMathML(tex);
      expect(mathml, tex).not.toMatch(/<(script|img|b)\b/);
      // The annotation legitimately quotes the source, escaped, as plain text.
      const rendered = mathml.replace(/<annotation.*<\/annotation>/, "");
      expect(rendered, tex).not.toContain("url(x)");
    }
  });

  it("only allows elements from a fixed set", () => {
    const allowed = new Set(
      "math semantics annotation mrow mi mn mo mtext mspace msup msub msubsup munder mover munderover mfrac msqrt mroot mtable mtr mtd mstyle mphantom".split(
        " ",
      ),
    );
    const { mathml } = texToMathML(
      "\\sum_{i}^{n} \\frac{a}{b} \\sqrt[3]{x} \\begin{matrix} a & b \\end{matrix} \\displaystyle \\phantom{x} \\text{t} \\nosuch",
    );
    for (const m of mathml.matchAll(/<\/?([a-zA-Z]+)/g)) {
      expect(allowed.has(m[1]!), m[1]).toBe(true);
    }
  });
});

describe("math: width estimate", () => {
  const width = (tex: string): number =>
    estimateMathWidth(texToMathML(tex, { display: true }).mathml);

  it("grows with content", () => {
    expect(width("x")).toBeLessThan(width("x + y"));
    expect(width("x + y")).toBeLessThan(width("x + y + z + w"));
  });

  it("counts structure rather than characters", () => {
    expect(width("\\frac{abcdef}{abcdef}")).toBeLessThan(width("abcdef abcdef"));
    expect(width("x^{abc}")).toBeLessThan(width("xabc"));
    expect(width("\\sum_{abcdefghij} x")).toBeLessThan(width("abcdefghij x"));
    expect(width("\\begin{matrix} abc \\\\ abc \\end{matrix}")).toBeLessThan(width("abc abc"));
  });

  it("ignores the source kept in the annotation", () => {
    expect(width("x")).toBeLessThan(2);
  });

  it("is zero for nothing, and never fails on broken input", () => {
    expect(width("")).toBe(0);
    expect(() => width("\\frac{")).not.toThrow();
  });
});
