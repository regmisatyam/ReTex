/** A value in the small YAML subset that Markdown front matter uses. */
export type FrontMatterValue = string | Array<string | Record<string, string>>;

export interface FrontMatter {
  data: Record<string, FrontMatterValue>;
  /** The document with the front matter removed. */
  body: string;
  /** The 1-based line number at which `body` starts in the original text. */
  bodyLine: number;
}

const KEY_RE = /^([A-Za-z_][\w -]*?)[ \t]*:(?:[ \t]+(.*))?$/;

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) {
    return v.slice(1, -1);
  }
  return v;
}

function parseScalarOrList(value: string): FrontMatterValue {
  const v = value.trim();
  if (v.startsWith("[") && v.endsWith("]")) {
    return v
      .slice(1, -1)
      .split(",")
      .map(unquote)
      .filter((item) => item !== "");
  }
  return unquote(v);
}

/**
 * Pull YAML front matter off the top of a document. Only the shapes that paper
 * metadata needs are understood: scalars, `[a, b]` lists, `- item` lists, lists of
 * small maps, and `|` / `>` text blocks. Anything else means the leading `---` was
 * just a horizontal rule, and the document is returned untouched.
 */
export function extractFrontMatter(text: string): FrontMatter {
  const untouched: FrontMatter = { data: {}, body: text, bodyLine: 1 };
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return untouched;

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "---" || line === "...") {
      end = i;
      break;
    }
  }
  if (end === -1) return untouched;

  // No prototype: keys come straight from the document, and may be `__proto__`.
  const data = Object.create(null) as Record<string, FrontMatterValue>;
  let i = 1;
  while (i < end) {
    const line = lines[i]!;
    if (line.trim() === "" || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const match = KEY_RE.exec(line);
    if (!match) return untouched;
    const key = match[1]!.toLowerCase();
    const value = (match[2] ?? "").trim();
    i++;

    if (value === "|" || value === ">" || value === "|-" || value === ">-") {
      const block: string[] = [];
      while (i < end && (lines[i]!.trim() === "" || /^\s/.test(lines[i]!))) {
        block.push(lines[i]!.trim());
        i++;
      }
      data[key] = block.join(value.startsWith("|") ? "\n" : " ").trim();
    } else if (value !== "") {
      data[key] = parseScalarOrList(value);
    } else {
      const items: Array<string | Record<string, string>> = [];
      while (i < end && /^\s*-(\s|$)/.test(lines[i]!)) {
        const first = lines[i]!.replace(/^\s*-\s*/, "");
        i++;
        const entry = KEY_RE.exec(first);
        if (!entry) {
          items.push(unquote(first));
          continue;
        }
        const map: Record<string, string> = {
          [entry[1]!.toLowerCase()]: unquote(entry[2] ?? ""),
        };
        // Keys belonging to the same list item are indented under it.
        while (i < end && /^\s+[^\s-]/.test(lines[i]!)) {
          const more = KEY_RE.exec(lines[i]!.trim());
          if (more) map[more[1]!.toLowerCase()] = unquote(more[2] ?? "");
          i++;
        }
        items.push(map);
      }
      if (items.length > 0) data[key] = items;
    }
  }

  return {
    data,
    body: lines.slice(end + 1).join("\n"),
    bodyLine: end + 2,
  };
}
