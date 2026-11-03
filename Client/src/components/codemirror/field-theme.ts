// Dark theme of the small CodeMirror fields (formula input, channel options),
// matching the zinc inputs around them. Tooltips use the cm-doc classes.
import { EditorView } from "@codemirror/view";

export const fieldTheme = EditorView.theme({
  "&": { backgroundColor: "#27272a", color: "#f4f4f5", fontSize: "12px" },
  "&.cm-focused": { outline: "none" },
  ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", padding: "2px 0", caretColor: "#f4f4f5" },
  ".cm-line": { padding: "0 4px" },
  ".cm-scroller": { maxHeight: "6.5em", overflow: "auto" },
  ".cm-matchingBracket": { backgroundColor: "#3f3f46", outline: "1px solid #71717a" },
  ".cm-nonmatchingBracket": { color: "#f87171" },
  ".cm-tooltip": { backgroundColor: "#18181b", color: "#e4e4e7", border: "1px solid #3f3f46", borderRadius: "4px", fontSize: "11px", zIndex: "1000" },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", maxHeight: "14em" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "#3f3f46", color: "#fafafa" },
  ".cm-completionDetail": { color: "#a1a1aa", fontStyle: "normal", marginLeft: "1em" },
  ".cm-completionMatchedText": { textDecoration: "none", color: "#7dd3fc" },
  ".cm-doc": { padding: "3px 6px", maxWidth: "22em", display: "flex", flexDirection: "column", gap: "2px" },
  ".cm-doc-sig": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "#fafafa" },
  ".cm-doc-active": { color: "#7dd3fc", fontWeight: "bold" },
  ".cm-diagnostic": { padding: "3px 6px" },
  ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy #f87171" },
  ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy #fbbf24" },
}, { dark: true });
