import { MarkdownView, Notice, Plugin, TFile } from "obsidian";
import type { Editor, MarkdownFileInfo, Menu } from "obsidian";
import Helper, { getImageReferences, replaceImageReferences } from "./helper";
import { S3Uploader, mapConcurrent } from "./uploader";
import type { TaskResult } from "./uploader";
import type { Image } from "./types";
import { SettingTab, migrateSettings } from "./setting";
import type { PluginSettings } from "./setting";
import { isAssetTypeAnImage, isNetworkUrl, isRecord, uuid } from "./utils";
import { isOwnImage } from "./uploader/s3";
import { readBlob, readVaultImage, downloadImage } from "./images";
import { updateDocument, targetEditor } from "./document";
import type { DocumentTarget } from "./document";
import { downloadAllImageFiles } from "./download";
import { t } from "./lang/helpers";
import { UploadProgress } from "./progress";
import { SourceCleanup, fingerprint } from "./cleanup";
import type { CleanupOutcome } from "./cleanup";

interface SourceGroup {
  references: Image[];
  file?: TFile;
  url?: string;
  fingerprint?: string;
}

export default class ImageAutoUploadPlugin extends Plugin {
  declare settings: PluginSettings;
  helper: Helper;
  private batches = new Set<TFile>();
  private stopped = false;
  private progress = new Set<UploadProgress>();
  private cleanups = new Set<SourceCleanup>();

  private startProgress(label: string, total: number) {
    const progress = new UploadProgress(label, total, () => this.progress.delete(progress));
    this.progress.add(progress);
    return progress;
  }

  async loadSettings() {
    const saved: unknown = await this.loadData();
    this.settings = migrateSettings(saved);
    if (!isRecord(saved) || saved.settingsVersion !== this.settings.settingsVersion) await this.saveSettings();
  }
  async saveSettings() { await this.saveData(this.settings); }

  async onload() {
    await this.loadSettings();
    this.helper = new Helper(this.app);
    this.addSettingTab(new SettingTab(this.app, this));
    for (const [id, action] of [
      ["Upload all images", () => this.uploadAllFile()],
      ["Download all images", () => downloadAllImageFiles(this)],
    ] as const) {
      this.addCommand({ id, name: id, checkCallback: checking => {
        if (!this.captureTarget()) return false;
        if (!checking) this.run(action);
        return true;
      } });
    }
    this.registerEvent(this.app.workspace.on("editor-paste", (event, editor, info) => this.paste(event, editor, info)));
    this.registerEvent(this.app.workspace.on("editor-drop", (event, editor, info) => this.drop(event, editor, info)));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file, source, leaf) => {
      if (source === "more-options" && file instanceof TFile && file.extension === "md") {
        const view = leaf?.view ?? this.app.workspace.getLeavesOfType("markdown")
          .map(candidate => candidate.view).find(candidate => candidate instanceof MarkdownView && candidate.file === file);
        if (view instanceof MarkdownView && view.file === file) {
          const target: DocumentTarget = { file, editor: view.editor };
          menu.addItem(item => item.setTitle(t("Upload note images")).setIcon("upload")
            .onClick(() => this.run(() => this.uploadAllFile(target))));
        }
      }
      if (source !== "canvas-menu" && file instanceof TFile && isAssetTypeAnImage(file.path)) this.fileMenu(menu, file);
    }));
  }

  onunload() {
    this.stopped = true;
    for (const progress of this.progress) progress.close();
    for (const cleanup of this.cleanups) cleanup.dispose();
    this.cleanups.clear();
  }
  private run(action: () => Promise<unknown>) {
    void action().catch(error => {
      if (!this.stopped) new Notice(error instanceof Error ? error.message : t("Operation failed"));
    });
  }

  captureTarget(editor?: Editor, info?: MarkdownFileInfo): DocumentTarget | null {
    if (editor && info?.file) return { editor, file: info.file };
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view?.file ? { file: view.file, editor: view.editor } : null;
  }

  getUploader() { return new S3Uploader(this.settings.s3); }
  private ready(notify: boolean): boolean {
    try { this.getUploader(); return true; }
    catch (error) {
      if (notify) new Notice(`${t("Configure S3")}: ${(error as Error).message}`);
      return false;
    }
  }
  private autoAllowed(target: DocumentTarget) {
    return this.helper.getFrontmatterValue("image-auto-upload", this.settings.uploadByClipSwitch, target.file) !== false;
  }

  private paste(event: ClipboardEvent, editor: Editor, info: MarkdownFileInfo) {
    const target = this.captureTarget(editor, info);
    if (event.defaultPrevented || !target || !event.clipboardData || !this.autoAllowed(target) || !this.ready(false)) return;
    const files = Array.from(event.clipboardData.files);
    const images = files.filter(file => file.type.startsWith("image/") || isAssetTypeAnImage(file.name));
    const text = event.clipboardData.getData("text/plain");
    if (images.length && images.length === files.length && (!text || this.settings.applyImage)) {
      event.preventDefault();
      this.run(() => this.uploadFiles(target, images));
    } else if (!files.length && this.settings.workOnNetWork) {
      const refs = this.helper.getImageLink(text).filter(ref => isNetworkUrl(ref.path));
      if (!refs.some(ref => this.networkAllowed(ref.path))) return;
      // Insert synchronously before starting downloads; no race with default paste.
      event.preventDefault();
      editor.replaceSelection(text);
      this.run(() => this.uploadReferences(target, refs));
    }
  }

  private drop(event: DragEvent, editor: Editor, info: MarkdownFileInfo) {
    const target = this.captureTarget(editor, info);
    if (event.defaultPrevented || event.ctrlKey || !target || !event.dataTransfer || !this.autoAllowed(target) || !this.ready(false)) return;
    const files = Array.from(event.dataTransfer.files);
    if (!files.length || !files.every(file => file.type.startsWith("image/") || isAssetTypeAnImage(file.name))) return;
    event.preventDefault();
    this.run(() => this.uploadFiles(target, files));
  }

  async uploadFiles(target: DocumentTarget, files: File[]) {
    const uploader = this.getUploader();
    if (!files.length || this.stopped) return;
    const progress = this.startProgress(target.file.name, files.length);
    try {
      const tasks = files.map(file => ({ file, marker: `![Uploading file...${uuid()}]()` }));
      target.editor.replaceSelection(tasks.map(task => task.marker).join("\n") + "\n");
      let failed = 0;
      await mapConcurrent(tasks, async task => {
        let replacement: string;
        try {
          if (this.stopped) return;
          if (files.length === 1) progress.stage(t("Reading file"));
          const data = await readBlob(task.file);
          if (this.stopped) return;
          progress.stage(t("Uploading"));
          const object = await uploader.upload(data);
          replacement = this.markdown(task.file.name, object.url);
          progress.complete(true);
        } catch (error) {
          failed++;
          progress.complete(false);
          replacement = `⚠️ ${t("Upload failed")}`;
          if (!this.stopped) new Notice((error as Error).message);
        }
        if (!this.stopped) {
          progress.stage(t("Updating note"));
          await updateDocument(this.app, target, value => value.replace(task.marker, replacement));
        }
      });
      if (!this.stopped) progress.finish(this.summary(tasks.length - failed, failed, 0, "files"));
    } catch (error) { progress.close(); throw error; }
  }

  private fileMenu(menu: Menu, file: TFile) {
    menu.addItem(item => item.setTitle(t("upload")).setIcon("upload").onClick(() => {
      this.run(async () => {
        if (!this.ready(true)) return;
        const target = this.captureTarget();
        const refs = target ? this.helper.getImageLink(target.editor.getValue()).filter(ref =>
          !isNetworkUrl(ref.path) && this.helper.resolveImage(ref.path, target.file.path) === file) : [];
        if (refs.length) await this.uploadReferences(target, refs);
        else {
          const progress = this.startProgress(file.name, 1);
          try {
            progress.stage(t("Reading file"));
            const data = await readVaultImage(this.app, file);
            if (this.stopped) return;
            progress.stage(t("Uploading"));
            const object = await this.getUploader().upload(data);
            progress.complete(true);
            if (this.stopped) return;
            try {
              await navigator.clipboard.writeText(object.url);
              progress.finish(t("Uploaded URL copied"));
            } catch {
              progress.finish(this.summary(1, 0, 0, "files"));
              new Notice(object.url, 15000);
            }
          } catch (error) { progress.close(); throw error; }
        }
      });
    }));
  }

  networkAllowed(url: string): boolean {
    return this.settings.workOnNetWork && !isOwnImage(url, this.settings.s3)
      && !this.helper.hasBlackDomain(url, this.settings.newWorkBlackDomains);
  }

  async uploadAllFile(target = this.captureTarget()) {
    if (!target || !this.ready(true)) return;
    if (this.app.vault.getAbstractFileByPath(target.file.path) !== target.file) return;
    const editor = targetEditor(this.app, target);
    const content = editor ? editor.getValue() : await this.app.vault.read(target.file);
    await this.uploadReferences(target, this.helper.getImageLink(content));
  }

  async uploadReferences(target: DocumentTarget, references: Image[]) {
    if (this.batches.has(target.file)) { new Notice(t("Upload already running")); return; }
    const uploader = this.getUploader();
    if (this.stopped) return;
    this.batches.add(target.file);
    let progress: UploadProgress;
    let cleanup: SourceCleanup;
    const deleteSource = this.settings.deleteSource;
    try {
      const groups = new Map<string, SourceGroup>();
      let skipped = 0;
      let unresolved = 0;
      for (const ref of references) {
        let id: string;
        let file: TFile;
        if (isNetworkUrl(ref.path)) {
          if (!this.networkAllowed(ref.path)) { skipped++; continue; }
          id = ref.path;
        } else {
          file = this.helper.resolveImage(ref.path, target.file.path);
          if (!file || !isAssetTypeAnImage(file.path)) { unresolved++; continue; }
          id = file.path;
        }
        if (!groups.has(id)) groups.set(id, { references: [], file, url: file ? undefined : ref.path });
        groups.get(id).references.push(ref);
      }
      if (!groups.size) {
        new Notice(this.summary(0, unresolved, skipped, "references"));
        return;
      }
      progress = this.startProgress(target.file.name, groups.size);
      const results = await mapConcurrent([...groups.values()], async (source): Promise<TaskResult<SourceGroup>> => {
        try {
          if (this.stopped) throw new Error(t("Operation cancelled"));
          progress.stage(source.file ? t("Reading and uploading") : t("Downloading and uploading"));
          const image = source.file ? await readVaultImage(this.app, source.file) : await downloadImage(source.url);
          if (deleteSource && source.file) source.fingerprint = await fingerprint(image.data);
          if (this.stopped) throw new Error(t("Operation cancelled"));
          progress.stage(t("Uploading"));
          const object = await uploader.upload(image);
          progress.complete(true);
          return { source, success: true, object };
        } catch (error) {
          progress.complete(false);
          return { source, success: false, error: (error as Error).message };
        }
      });
      if (this.stopped) return;
      const replacements = new Map<string, string>();
      let succeeded = 0;
      let failed = unresolved;
      for (const result of results) {
        if (result.success === true) {
          succeeded += result.source.references.length;
          for (const ref of result.source.references) replacements.set(ref.source, this.markdown(ref.name, result.object.url));
        } else {
          failed += result.source.references.length;
          new Notice(result.error);
        }
      }
      const applied = new Set<string>();
      if (deleteSource && results.some(result => result.success && result.source.file)) {
        cleanup = new SourceCleanup(this.app, this.helper, target);
        this.cleanups.add(cleanup);
      }
      progress.stage(t("Updating note"));
      let expected: string;
      const changed = await updateDocument(this.app, target, value => {
        applied.clear();
        for (const ref of getImageReferences(value)) if (replacements.has(ref.source)) applied.add(ref.source);
        expected = replaceImageReferences(value, replacements);
        return expected;
      });
      const outcomes: Record<CleanupOutcome, number> = { trashed: 0, referenced: 0, unverified: 0, failed: 0 };
      if (cleanup && changed && !this.stopped) {
        progress.stage(t("Checking source files"));
        const fresh = await cleanup.waitForContent(expected);
        for (const result of results) {
          if (result.success === true && result.source.file && result.source.references.some(ref => applied.has(ref.source))) {
            const outcome = fresh ? await cleanup.trash(result.source.file, result.source.fingerprint, expected) : "unverified";
            outcomes[outcome]++;
          }
        }
      }
      let summary = this.summary(succeeded, failed, skipped, "references");
      if (Object.values(outcomes).some(count => count > 0)) {
        summary += `\n${t("Sources trashed")} ${outcomes.trashed}, ${t("Sources referenced")} ${outcomes.referenced}, ${t("Sources unverified")} ${outcomes.unverified}, ${t("Source cleanup failed")} ${outcomes.failed}`;
      }
      if (!this.stopped) progress.finish(summary);
    } catch (error) { progress?.close(); throw error; }
    finally {
      cleanup?.dispose();
      if (cleanup) this.cleanups.delete(cleanup);
      this.batches.delete(target.file);
    }
  }

  handleName(name: string) {
    if (this.settings.imageDesc === "none" || (this.settings.imageDesc === "removeDefault" && name === "image.png")) return "";
    const suffix = this.settings.imageSizeSuffix || "";
    return name + (suffix && !/\|\d+(?:x\d+)?$/.test(name) ? suffix : "");
  }
  markdown(name: string, url: string) {
    const alt = this.handleName(name).replace(/[\r\n]/g, " ")
      .replace(/(\\*)([[\]])/g, (_match, slashes: string, bracket: string) => slashes + (slashes.length % 2 ? "" : "\\") + bracket);
    return `![${alt}](${url})`;
  }
  private summary(success: number, failed: number, skipped: number, unit: "files" | "references") {
    return `${t("Upload result")} (${t(unit)}): ${t("Success")} ${success}, ${t("Failed")} ${failed}, ${t("Skipped")} ${skipped}`;
  }
}
