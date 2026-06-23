export { EditorService } from "./editor.js";
export type {
  EditorServiceOptions,
  CompletionItem,
  CompletionKind,
  HoverInfo,
  SemanticToken,
  SemanticTokenType,
} from "./editor.js";
export { printDocument } from "./printer.js";

export {
  SOURCE_POS_ATTR,
  SOURCE_TYPE_ATTR,
  parseSourcePos,
  readSourcePos,
  readSourceType,
  closestSourcePos,
  spanLength,
  spanContains,
  pickElementForOffset,
} from "./sync.js";
export type { SourceSpan, AttrElement, ClosestElement } from "./sync.js";
