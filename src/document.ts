import { MarkdownView } from "obsidian";
import type { App, Editor, TFile } from "obsidian";

export interface DocumentTarget {
  file: TFile;
  editor: Editor;
}

/** Find the original editor only while it still displays the original file. */
export function targetEditor(app: App, target: DocumentTarget): Editor | undefined {
  let fallback: Editor | undefined;
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    const view = leaf.view;
    if (view instanceof MarkdownView && view.file === target.file) {
      if (view.editor === target.editor) return view.editor;
      fallback = view.editor;
    }
  }
  return fallback;
}

export async function updateDocument(app: App, target: DocumentTarget, transform: (value: string) => string): Promise<boolean> {
  if (app.vault.getAbstractFileByPath(target.file.path) !== target.file) return false;
  const editor = targetEditor(app, target);
  if (editor) {
    const previous = editor.getValue();
    const next = transform(previous);
    if (previous === next) return false;
    // Replace only the changed span; preserve edits, selection and undo history.
    let start = 0;
    while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
    let beforeEnd = previous.length;
    let afterEnd = next.length;
    while (beforeEnd > start && afterEnd > start && previous[beforeEnd - 1] === next[afterEnd - 1]) {
      beforeEnd--; afterEnd--;
    }
    editor.replaceRange(next.slice(start, afterEnd), editor.offsetToPos(start), editor.offsetToPos(beforeEnd));
    return true;
  }
  let changed = false;
  await app.vault.process(target.file, value => {
    const next = transform(value);
    changed = next !== value;
    return next;
  });
  return changed;
}
