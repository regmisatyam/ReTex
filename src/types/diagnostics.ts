import type { SourceRange } from "./source.js";

/** Severity levels, ordered the same way LSP orders them. */
export enum DiagnosticSeverity {
  Error = "error",
  Warning = "warning",
  Info = "info",
  Hint = "hint",
}

/**
 * Stable, machine-readable diagnostic codes. Editors can key quick-fixes and
 * documentation links off these rather than the (localizable) message text.
 */
export enum DiagnosticCode {
  UnexpectedToken = "RTX1001",
  UnterminatedGroup = "RTX1002",
  UnterminatedArgument = "RTX1003",
  UnexpectedEOF = "RTX1004",
  MismatchedBrace = "RTX1005",

  UnknownCommand = "RTX2001",
  UnknownEnvironment = "RTX2002",
  MissingRequiredArgument = "RTX2003",
  TooManyArguments = "RTX2004",
  MissingEnvironmentEnd = "RTX2005",
  MismatchedEnvironment = "RTX2006",

  InvalidColor = "RTX3001",
  InvalidUrl = "RTX3002",
  InvalidDimension = "RTX3003",
  MissingRequiredField = "RTX3004",
  UnknownField = "RTX3005",
  EmptyArgument = "RTX3006",
  UnknownOption = "RTX3007",
  UnsupportedMath = "RTX3008",

  CommandOutsideContext = "RTX4001",
  UnknownIcon = "RTX4002",
  UnknownThemeColor = "RTX4003",
  UnknownLibrary = "RTX4004",
  LibraryRequired = "RTX4005",
  UnknownCitation = "RTX4006",
  MarkdownCleanup = "RTX4007",

  UnsafeUrlBlocked = "RTX5001",
}

/** Optional quick-fix an editor can apply. */
export interface QuickFix {
  title: string;
  /** Replacement text for {@link Diagnostic.range}. */
  replacement: string;
  range?: SourceRange;
}

/** A single diagnostic emitted by any stage of the pipeline. */
export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  message: string;
  range: SourceRange;
  /** Stage that produced the diagnostic, for filtering. */
  source: "tokenizer" | "parser" | "validator" | "security" | "markdown";
  /** Optional editor quick-fixes. */
  fixes?: QuickFix[];
}
