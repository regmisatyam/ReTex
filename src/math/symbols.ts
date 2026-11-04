/**
 * Lookup tables for the TeX-to-MathML compiler: which character each control
 * word stands for, and how MathML should treat it.
 */

/**
 * A lookup table with no prototype. Control words come straight from the document,
 * so `\constructor` must not find `Object.prototype.constructor`.
 */
function table<T>(entries: Record<string, T>): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, entries);
}

/** Control words rendered as identifiers (`<mi>`). */
export const IDENTIFIERS = table<string>({
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ϵ",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  varkappa: "ϰ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  omicron: "ο",
  pi: "π",
  varpi: "ϖ",
  rho: "ρ",
  varrho: "ϱ",
  sigma: "σ",
  varsigma: "ς",
  tau: "τ",
  upsilon: "υ",
  phi: "ϕ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  forall: "∀",
  exists: "∃",
  nexists: "∄",
  emptyset: "∅",
  varnothing: "∅",
  aleph: "ℵ",
  beth: "ℶ",
  hbar: "ℏ",
  ell: "ℓ",
  Re: "ℜ",
  Im: "ℑ",
  wp: "℘",
  top: "⊤",
  bot: "⊥",
  angle: "∠",
  triangle: "△",
  square: "□",
  Box: "□",
  Diamond: "◇",
  imath: "ı",
  jmath: "ȷ",
  checkmark: "✓",
  degree: "°",
  S: "§",
  P: "¶",
});

/** Capital Greek is upright in TeX, unlike every other letter. */
export const UPRIGHT_IDENTIFIERS = table<string>({
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Upsilon: "Υ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
});

/** Control words rendered as operators (`<mo>`). */
export const OPERATORS = table<string>({
  // Binary operators.
  pm: "±",
  mp: "∓",
  times: "×",
  div: "÷",
  cdot: "⋅",
  ast: "∗",
  star: "⋆",
  circ: "∘",
  bullet: "∙",
  oplus: "⊕",
  otimes: "⊗",
  ominus: "⊖",
  odot: "⊙",
  oslash: "⊘",
  cap: "∩",
  cup: "∪",
  sqcup: "⊔",
  sqcap: "⊓",
  uplus: "⊎",
  vee: "∨",
  wedge: "∧",
  lor: "∨",
  land: "∧",
  setminus: "∖",
  dagger: "†",
  ddagger: "‡",
  wr: "≀",
  amalg: "⨿",
  // Relations.
  leq: "≤",
  le: "≤",
  geq: "≥",
  ge: "≥",
  neq: "≠",
  ne: "≠",
  approx: "≈",
  equiv: "≡",
  sim: "∼",
  simeq: "≃",
  cong: "≅",
  propto: "∝",
  ll: "≪",
  gg: "≫",
  subset: "⊂",
  supset: "⊃",
  subseteq: "⊆",
  supseteq: "⊇",
  nsubseteq: "⊈",
  nsupseteq: "⊉",
  subsetneq: "⊊",
  supsetneq: "⊋",
  sqsubseteq: "⊑",
  sqsupseteq: "⊒",
  in: "∈",
  notin: "∉",
  ni: "∋",
  mid: "∣",
  nmid: "∤",
  parallel: "∥",
  perp: "⟂",
  prec: "≺",
  succ: "≻",
  preceq: "⪯",
  succeq: "⪰",
  doteq: "≐",
  models: "⊨",
  vdash: "⊢",
  dashv: "⊣",
  triangleq: "≜",
  coloneqq: "≔",
  leqslant: "⩽",
  geqslant: "⩾",
  lesssim: "≲",
  gtrsim: "≳",
  asymp: "≍",
  // Arrows.
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  gets: "←",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  leftrightarrow: "↔",
  Leftrightarrow: "⇔",
  mapsto: "↦",
  implies: "⟹",
  impliedby: "⟸",
  iff: "⟺",
  longrightarrow: "⟶",
  longleftarrow: "⟵",
  longleftrightarrow: "⟷",
  Longrightarrow: "⟹",
  Longleftarrow: "⟸",
  Longleftrightarrow: "⟺",
  longmapsto: "⟼",
  uparrow: "↑",
  downarrow: "↓",
  updownarrow: "↕",
  Uparrow: "⇑",
  Downarrow: "⇓",
  nearrow: "↗",
  searrow: "↘",
  swarrow: "↙",
  nwarrow: "↖",
  hookrightarrow: "↪",
  hookleftarrow: "↩",
  rightharpoonup: "⇀",
  rightleftharpoons: "⇌",
  leadsto: "⇝",
  // Logic and punctuation.
  neg: "¬",
  lnot: "¬",
  therefore: "∴",
  because: "∵",
  prime: "′",
  surd: "√",
  ldots: "…",
  dots: "…",
  dotsc: "…",
  cdots: "⋯",
  dotsb: "⋯",
  dotsm: "⋯",
  vdots: "⋮",
  ddots: "⋱",
  colon: ":",
  backslash: "\\",
});

/** Delimiters: they never stretch unless `\left` or `\big` asks them to. */
export const DELIMITERS = table<string>({
  langle: "⟨",
  rangle: "⟩",
  lceil: "⌈",
  rceil: "⌉",
  lfloor: "⌊",
  rfloor: "⌋",
  lvert: "|",
  rvert: "|",
  vert: "|",
  lVert: "‖",
  rVert: "‖",
  Vert: "‖",
  lbrace: "{",
  rbrace: "}",
  lbrack: "[",
  rbrack: "]",
  lgroup: "⟮",
  rgroup: "⟯",
});

/** Single-character escapes such as `\{`. */
export const ESCAPED_DELIMITERS = table<string>({
  "{": "{",
  "}": "}",
  "|": "‖",
});

/** Other single-character escapes, shown as the literal character. */
export const ESCAPED_LITERALS = new Set(["%", "$", "#", "&", "_"]);

/** Big operators, whose scripts can sit above and below them. */
export const LARGE_OPERATORS = table<string>({
  sum: "∑",
  prod: "∏",
  coprod: "∐",
  bigcup: "⋃",
  bigcap: "⋂",
  bigoplus: "⨁",
  bigotimes: "⨂",
  bigodot: "⨀",
  bigvee: "⋁",
  bigwedge: "⋀",
  bigsqcup: "⨆",
  biguplus: "⨄",
});

/** Integrals keep their scripts at the side, even in display style. */
export const INTEGRALS = table<string>({
  int: "∫",
  iint: "∬",
  iiint: "∭",
  oint: "∮",
  oiint: "∯",
});

/** Upright named functions such as `\sin`. */
export const FUNCTIONS = new Set([
  "sin",
  "cos",
  "tan",
  "cot",
  "sec",
  "csc",
  "arcsin",
  "arccos",
  "arctan",
  "sinh",
  "cosh",
  "tanh",
  "coth",
  "log",
  "ln",
  "lg",
  "exp",
  "det",
  "dim",
  "ker",
  "hom",
  "deg",
  "gcd",
  "arg",
]);

/** Upright named functions whose scripts act as limits, such as `\lim`. */
export const LIMIT_FUNCTIONS = table<string>({
  lim: "lim",
  limsup: "lim sup",
  liminf: "lim inf",
  max: "max",
  min: "min",
  sup: "sup",
  inf: "inf",
  Pr: "Pr",
  argmax: "arg max",
  argmin: "arg min",
});

/** Horizontal spacing commands, in em. */
export const SPACES = table<string>({
  ",": "0.167em",
  ":": "0.222em",
  ">": "0.222em",
  ";": "0.278em",
  "!": "-0.167em",
  " ": "0.25em",
  quad: "1em",
  qquad: "2em",
  thinspace: "0.167em",
  medspace: "0.222em",
  thickspace: "0.278em",
  enspace: "0.5em",
});

/** Accents: the mark drawn over (or under) the argument. */
export const ACCENTS = table<{ mark: string; stretchy?: boolean; under?: boolean }>({
    hat: { mark: "^" },
    check: { mark: "ˇ" },
    breve: { mark: "˘" },
    acute: { mark: "´" },
    grave: { mark: "`" },
    tilde: { mark: "~" },
    bar: { mark: "¯" },
    vec: { mark: "→" },
    dot: { mark: "˙" },
    ddot: { mark: "¨" },
    mathring: { mark: "˚" },
    widehat: { mark: "^", stretchy: true },
    widetilde: { mark: "~", stretchy: true },
    overline: { mark: "‾", stretchy: true },
    overrightarrow: { mark: "→", stretchy: true },
    overleftarrow: { mark: "←", stretchy: true },
    underline: { mark: "_", stretchy: true, under: true },
  });

/** `\big` and friends, as the height of the delimiter they produce. */
export const BIG_SIZES = table<string>({
  big: "1.2em",
  bigl: "1.2em",
  bigr: "1.2em",
  bigm: "1.2em",
  Big: "1.8em",
  Bigl: "1.8em",
  Bigr: "1.8em",
  Bigm: "1.8em",
  bigg: "2.4em",
  biggl: "2.4em",
  biggr: "2.4em",
  biggm: "2.4em",
  Bigg: "3em",
  Biggl: "3em",
  Biggr: "3em",
  Biggm: "3em",
});

/** `\displaystyle` and friends: the attributes and display mode each one sets. */
export const STYLE_SWITCHES = table<{ attrs: string; display: boolean }>({
  displaystyle: { attrs: ' displaystyle="true" scriptlevel="0"', display: true },
  textstyle: { attrs: ' displaystyle="false" scriptlevel="0"', display: false },
  scriptstyle: { attrs: ' displaystyle="false" scriptlevel="1"', display: false },
  scriptscriptstyle: { attrs: ' displaystyle="false" scriptlevel="2"', display: false },
});

/** Matrix-like environments and the delimiters around them. */
export const MATRICES = table<[string, string]>({
  matrix: ["", ""],
  smallmatrix: ["", ""],
  pmatrix: ["(", ")"],
  bmatrix: ["[", "]"],
  Bmatrix: ["{", "}"],
  vmatrix: ["|", "|"],
  Vmatrix: ["‖", "‖"],
});

export type MathFont =
  | "normal"
  | "bold"
  | "boldItalic"
  | "doubleStruck"
  | "script"
  | "fraktur"
  | "sansSerif"
  | "monospace";

/** Font commands. MathML Core has no `mathvariant`, so fonts are Unicode ranges. */
export const FONT_COMMANDS = table<MathFont>({
  mathrm: "normal",
  mathnormal: "normal",
  rm: "normal",
  mathbf: "bold",
  bf: "bold",
  boldsymbol: "boldItalic",
  bm: "boldItalic",
  mathbb: "doubleStruck",
  mathcal: "script",
  mathscr: "script",
  mathfrak: "fraktur",
  mathsf: "sansSerif",
  mathtt: "monospace",
});

interface FontRange {
  upper: number;
  lower?: number;
  digit?: number;
  greekUpper?: number;
  greekLower?: number;
  /** Characters missing from the range, which Unicode encodes elsewhere. */
  holes?: Record<string, string>;
}

const FONT_RANGES: Partial<Record<MathFont, FontRange>> = {
  bold: {
    upper: 0x1d400,
    lower: 0x1d41a,
    digit: 0x1d7ce,
    greekUpper: 0x1d6a8,
    greekLower: 0x1d6c2,
  },
  boldItalic: {
    upper: 0x1d468,
    lower: 0x1d482,
    digit: 0x1d7ce,
    greekUpper: 0x1d71c,
    greekLower: 0x1d736,
  },
  doubleStruck: {
    upper: 0x1d538,
    lower: 0x1d552,
    digit: 0x1d7d8,
    holes: { C: "ℂ", H: "ℍ", N: "ℕ", P: "ℙ", Q: "ℚ", R: "ℝ", Z: "ℤ" },
  },
  script: {
    upper: 0x1d49c,
    lower: 0x1d4b6,
    holes: {
      B: "ℬ",
      E: "ℰ",
      F: "ℱ",
      H: "ℋ",
      I: "ℐ",
      L: "ℒ",
      M: "ℳ",
      R: "ℛ",
      e: "ℯ",
      g: "ℊ",
      o: "ℴ",
    },
  },
  fraktur: {
    upper: 0x1d504,
    lower: 0x1d51e,
    holes: { C: "ℭ", H: "ℌ", I: "ℑ", R: "ℜ", Z: "ℨ" },
  },
  sansSerif: { upper: 0x1d5a0, lower: 0x1d5ba, digit: 0x1d7e2 },
  monospace: { upper: 0x1d670, lower: 0x1d68a, digit: 0x1d7f6 },
};

/** Map a character to its styled form, or return it unchanged if there is none. */
export function styleCharacter(char: string, font: MathFont): string {
  const range = FONT_RANGES[font];
  if (!range) return char;
  const hole = range.holes?.[char];
  if (hole) return hole;
  const code = char.codePointAt(0)!;
  const from = (base: number | undefined, start: number): string =>
    base === undefined ? char : String.fromCodePoint(base + code - start);
  if (char >= "A" && char <= "Z") return from(range.upper, 0x41);
  if (char >= "a" && char <= "z") return from(range.lower, 0x61);
  if (char >= "0" && char <= "9") return from(range.digit, 0x30);
  if (code >= 0x391 && code <= 0x3a9) return from(range.greekUpper, 0x391);
  if (code >= 0x3b1 && code <= 0x3c9) return from(range.greekLower, 0x3b1);
  return char;
}
