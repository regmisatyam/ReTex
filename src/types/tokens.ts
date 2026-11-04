import type { SourceRange } from "./source.js";

/**
 * Token kinds produced by the {@link Tokenizer}.
 *
 * ReTeX intentionally diverges from TeX in a few places that matter for
 * resumes:
 *  - `%` is a *literal* percent sign (so `Reduced latency by 40%` and
 *    `\column{40%}` work as written) rather than a comment marker.
 *  - Comments use `%%` to end-of-line, which never collides with percentages.
 */
export enum TokenType {
  /** A command such as `\section`, `\textbf`, `\item`. The lexeme excludes the backslash. */
  Command = "Command",
  /** `{` — begin group / argument. */
  LBrace = "LBrace",
  /** `}` — end group / argument. */
  RBrace = "RBrace",
  /** `[` — begin optional argument. */
  LBracket = "LBracket",
  /** `]` — end optional argument. */
  RBracket = "RBracket",
  /** Run of literal text. */
  Text = "Text",
  /** Run of inline whitespace (spaces/tabs, single newline). */
  Whitespace = "Whitespace",
  /** A blank line — paragraph break. */
  ParBreak = "ParBreak",
  /** `\\` — explicit line break. */
  LineBreak = "LineBreak",
  /** `%% ...` comment (stripped from output, surfaced to editor tooling). */
  Comment = "Comment",
  /** The untouched body of a verbatim environment such as `code` or `equation`. */
  Verbatim = "Verbatim",
  /** End of input. */
  EOF = "EOF",
}

/** A lexical token with full source provenance. */
export interface Token {
  type: TokenType;
  /** The exact source text of the token (backslash stripped for commands). */
  value: string;
  /** Original source when it differs from `value`, e.g. `\{` for the escape `{`. */
  raw?: string;
  range: SourceRange;
}

/**
 * Environments whose body is never tokenized: everything up to the matching
 * `\end{name}` is one {@link TokenType.Verbatim} token, so code and TeX survive
 * byte for byte.
 */
export const VERBATIM_ENVIRONMENTS: readonly string[] = [
  "verbatim",
  "code",
  "equation",
  "equation*",
  "displaymath",
  "align",
  "align*",
  "gather",
  "gather*",
];

/** The verbatim environment named by a `{name}` at `offset`, if there is one. */
export function verbatimEnvironmentAt(source: string, offset: number): string | undefined {
  if (source[offset] !== "{") return undefined;
  const close = source.indexOf("}", offset);
  if (close === -1 || close - offset > 16) return undefined;
  const name = source.slice(offset + 1, close);
  return VERBATIM_ENVIRONMENTS.includes(name) ? name : undefined;
}

/** Reserved single characters that the tokenizer treats specially. */
export const SPECIAL_CHARS = new Set(["\\", "{", "}", "[", "]"]);
