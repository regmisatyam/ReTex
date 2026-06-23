import { describe, it, expect } from "vitest";
import {
  ReTeXEngine,
  SOURCE_POS_ATTR,
  parseSourcePos,
  readSourcePos,
  readSourceType,
  closestSourcePos,
  pickElementForOffset,
  spanContains,
  spanLength,
  type AttrElement,
  type ClosestElement,
} from "../src/index.js";

/** A tiny DOM-free stand-in for an annotated preview element. */
const el = (pos?: string, type?: string): AttrElement => ({
  getAttribute: (name) =>
    name === SOURCE_POS_ATTR
      ? (pos ?? null)
      : name === "data-rtx-type"
        ? (type ?? null)
        : null,
});

describe("parseSourcePos", () => {
  it("parses a start:end pair", () => {
    expect(parseSourcePos("12:34")).toEqual({ start: 12, end: 34 });
  });
  it("rejects malformed, empty, or inverted values", () => {
    expect(parseSourcePos(null)).toBeNull();
    expect(parseSourcePos("")).toBeNull();
    expect(parseSourcePos("12")).toBeNull();
    expect(parseSourcePos("nope:nope")).toBeNull();
    expect(parseSourcePos("9:2")).toBeNull(); // end < start
  });
});

describe("readSourcePos / readSourceType", () => {
  it("reads the attributes off an element", () => {
    const e = el("5:9", "section");
    expect(readSourcePos(e)).toEqual({ start: 5, end: 9 });
    expect(readSourceType(e)).toBe("section");
  });
  it("returns null for missing elements/attributes", () => {
    expect(readSourcePos(null)).toBeNull();
    expect(readSourcePos(el())).toBeNull();
    expect(readSourceType(undefined)).toBeNull();
  });
});

describe("span helpers", () => {
  it("spanContains is inclusive on both ends", () => {
    const s = { start: 4, end: 8 };
    expect(spanContains(s, 4)).toBe(true);
    expect(spanContains(s, 8)).toBe(true);
    expect(spanContains(s, 6)).toBe(true);
    expect(spanContains(s, 3)).toBe(false);
    expect(spanContains(s, 9)).toBe(false);
  });
  it("spanLength is end - start", () => {
    expect(spanLength({ start: 4, end: 10 })).toBe(6);
  });
});

describe("closestSourcePos (reverse sync: preview → code)", () => {
  it("walks up to the nearest annotated ancestor via closest()", () => {
    const ancestor = el("0:40", "section");
    // A clicked text node whose closest('[data-rtx-pos]') is the section.
    const clicked: ClosestElement = {
      getAttribute: () => null,
      closest: (sel) =>
        sel === `[${SOURCE_POS_ATTR}]` ? (ancestor as ClosestElement) : null,
    };
    expect(closestSourcePos(clicked)).toEqual({ start: 0, end: 40 });
  });
  it("returns null when nothing matches", () => {
    const clicked: ClosestElement = { getAttribute: () => null, closest: () => null };
    expect(closestSourcePos(clicked)).toBeNull();
    expect(closestSourcePos(null)).toBeNull();
  });
});

describe("pickElementForOffset (forward sync: code → preview)", () => {
  it("returns the tightest element containing the offset", () => {
    const para = el("100:130", "para");
    const bold = el("110:128", "bold");
    const section = el("0:200", "section");
    const all = [section, para, bold];
    // Offset inside the bold run → bold (smallest span) wins.
    expect(pickElementForOffset(all, 115)).toBe(bold);
    // Offset in the paragraph but outside bold → paragraph.
    expect(pickElementForOffset(all, 105)).toBe(para);
    // Offset only in the section → section.
    expect(pickElementForOffset(all, 50)).toBe(section);
  });

  it("returns null when no span contains the offset", () => {
    expect(pickElementForOffset([el("10:20")], 5)).toBeNull();
    expect(pickElementForOffset([], 5)).toBeNull();
  });

  it("ignores elements with no/invalid pos attribute", () => {
    const good = el("10:20");
    expect(pickElementForOffset([el(), el("bad"), good], 15)).toBe(good);
  });
});

describe("end-to-end: rendered attributes feed the helpers", () => {
  it("a click span and a caret span agree on the same source", () => {
    const engine = new ReTeXEngine();
    const src = "\\section{Experience}\nHello \\textbf{world}.";
    const out = engine.toHtml(src, { sourceMap: true });

    // Simulate reading the bold element straight out of the rendered HTML.
    const m = /<strong data-rtx-pos="(\d+):(\d+)"/.exec(out);
    expect(m).not.toBeNull();
    const span = parseSourcePos(`${m![1]}:${m![2]}`)!;
    expect(src.slice(span.start, span.end)).toBe("\\textbf{world}");
    // A caret anywhere inside that span maps back into the same run.
    expect(spanContains(span, span.start + 2)).toBe(true);
  });
});
