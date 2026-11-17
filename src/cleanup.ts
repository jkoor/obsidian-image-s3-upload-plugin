import { MarkdownView } from "obsidian";
import type { App, CachedMetadata, EventRef, TFile } from "obsidian";
import type Helper from "./helper";
import { getImageReferences } from "./helper";
import type { DocumentTarget } from "./document";
import { targetEditor } from "./document";
import { isNetworkUrl } from "./utils";

export type CleanupOutcome = "trashed" | "referenced" | "unverified" | "failed";

export async function fingerprint(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Subscribe before editing so even a synchronous metadata update cannot be missed. */
export class SourceCleanup {
  private snapshots = new Map<TFile, { data: string; cache: CachedMetadata }>();
  private event: EventRef;
  private timer: ReturnType<typeof setTimeout>;
  private wake: () => void;
  private disposed = false;

  constructor(private app: App, private helper: Helper, private target: DocumentTarget) {
    this.event = app.metadataCache.on("changed", (file, data, cache) => {
      this.snapshots.set(file, { data, cache });
      this.wake?.();
    });
  }

  async waitForContent(expected: string): Promise<boolean> {
    if (this.disposed) return false;
    if (this.snapshots.get(this.target.file)?.data === expected) return true;
    return new Promise(resolve => {
      const finish = (success: boolean) => {
        clearTimeout(this.timer);
        this.wake = undefined;
        resolve(success);
      };
      this.wake = () => {
        if (this.disposed) finish(false);
        else if (this.snapshots.get(this.target.file)?.data === expected) finish(true);
      };
      this.timer = setTimeout(() => finish(false), 3000);
    });
  }

  async trash(file: TFile, uploadedFingerprint: string, expected: string): Promise<CleanupOutcome> {
    try {
      if (this.disposed || !uploadedFingerprint || this.app.vault.getAbstractFileByPath(file.path) !== file) return "unverified";
      if (!await this.waitForContent(expected)) return "unverified";
      const checked: { note: TFile; content: string; cache: CachedMetadata }[] = [];
      for (const note of this.app.vault.getMarkdownFiles()) {
        const disk = await this.app.vault.read(note);
        const views = this.app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view)
          .filter((view): view is MarkdownView => view instanceof MarkdownView && view.file === note);
        const content = note === this.target.file ? expected : disk;
        // Unsaved or conflicting editors cannot be checked with an on-disk cache.
        const contents = [disk, ...views.map(view => view.editor.getValue())];
        if (contents.some(text => getImageReferences(text, true).some(ref => !isNetworkUrl(ref.path)
          && this.helper.resolveImage(ref.path, note.path) === file))) return "referenced";
        if (views.some(view => view.editor.getValue() !== content) || disk !== content) return "unverified";
        // Reference-style Markdown links are not covered by our inline parser.
        // Preserve the source if their cache cannot be tied to this exact content.
        if (/^ {0,3}\[[^\]\n]+\]:/m.test(content) && this.snapshots.get(note)?.data !== content) return "unverified";
        const snapshot = this.snapshots.get(note);
        const cache = snapshot?.data === content ? snapshot.cache : this.app.metadataCache.getFileCache(note);
        if (!cache || (snapshot && snapshot.data !== content)) return "unverified";
        if (note === this.target.file && snapshot?.data !== expected) return "unverified";
        if (this.helper.getImageLink(content).some(ref => !isNetworkUrl(ref.path) && this.helper.resolveImage(ref.path, note.path) === file)
          || [...(cache.links || []), ...(cache.embeds || [])].some(link => this.helper.resolveImage(link.link, note.path) === file)) return "referenced";
        checked.push({ note, content, cache });
      }
      const stat = file.stat ? { ...file.stat } : undefined;
      if (await fingerprint(await this.app.vault.readBinary(file)) !== uploadedFingerprint) return "unverified";
      // Recheck after asynchronous reads: do not trash if a note changed meanwhile.
      const currentNotes = this.app.vault.getMarkdownFiles();
      if (currentNotes.length !== checked.length || currentNotes.some(note => !checked.some(item => item.note === note))) return "unverified";
      for (const item of checked) {
        if (await this.app.vault.read(item.note) !== item.content || this.app.metadataCache.getFileCache(item.note) !== item.cache) return "unverified";
      }
      for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
        const view = leaf.view;
        if (view instanceof MarkdownView && view.file) {
          const item = checked.find(item => item.note === view.file);
          if (!item || view.editor.getValue() !== item.content) return "unverified";
        }
      }
      const live = targetEditor(this.app, this.target);
      if (this.disposed || (live && live.getValue() !== expected)) return "unverified";
      if (this.app.vault.getAbstractFileByPath(this.target.file.path) !== this.target.file) return "unverified";
      if (this.app.vault.getAbstractFileByPath(file.path) !== file) return "unverified";
      if (stat && (file.stat.mtime !== stat.mtime || file.stat.size !== stat.size)) return "unverified";
      try {
        await this.app.fileManager.trashFile(file);
        return "trashed";
      } catch { return "failed"; }
    } catch { return "unverified"; }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.wake?.();
    clearTimeout(this.timer);
    this.app.metadataCache.offref(this.event);
  }
}
