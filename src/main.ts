import { MarkdownView, Notice, Plugin, TFile } from "obsidian";
import type { Editor, MarkdownFileInfo, Menu } from "obsidian";
import Helper, { getImageReferences, replaceImageReferences } from "./helper";
import { S3Uploader, mapConcurrent } from "./uploader";
import type { TaskResult } from "./uploader";
import type { Image } from "./types";
import { SettingTab, migrateSettings } from "./setting";
import type { PluginSettings } from "./setting";
import { isAssetTypeAnImage, isNetworkUrl, uuid } from "./utils";
import { isOwnImage } from "./uploader/s3";
import { readBlob, readVaultImage, downloadImage } from "./images";
import { updateDocument, targetEditor } from "./document";
import type { DocumentTarget } from "./document";
import { downloadAllImageFiles } from "./download";
import { t } from "./lang/helpers";

interface SourceGroup {
  references: Image[];
  file?: TFile;
  url?: string;
}

export default class ImageAutoUploadPlugin extends Plugin {
  settings: PluginSettings;
  helper: Helper;
  private batches = new Set<TFile>();
  private stopped = false;

  async loadSettings() {
    const saved = await this.loadData();
    this.settings = migrateSettings(saved);
    if (saved?.settingsVersion !== this.settings.settingsVersion) await this.saveSettings();
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
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file, source) => {
      if (source !== "canvas-menu" && file instanceof TFile && isAssetTypeAnImage(file.path)) this.fileMenu(menu, file);
    }));
  }

  onunload() { this.stopped = true; }
  private run(action: () => Promise<unknown>) {
    void action().catch(error => new Notice(error instanceof Error ? error.message : t("Operation failed")));
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
    const tasks = files.map(file => ({ file, marker: `![Uploading file...${uuid()}]()` }));
    target.editor.replaceSelection(tasks.map(task => task.marker).join("\n") + "\n");
    let failed = 0;
    await mapConcurrent(tasks, async task => {
      let replacement: string;
      try {
        const object = await uploader.upload(await readBlob(task.file));
        replacement = this.markdown(task.file.name, object.url);
      } catch (error) {
        failed++;
        replacement = `⚠️ ${t("Upload failed")}`;
        new Notice((error as Error).message);
      }
      if (!this.stopped) await updateDocument(this.app, target, value => value.replace(task.marker, replacement));
    });
    this.report(tasks.length - failed, failed, 0);
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
          const object = await this.getUploader().upload(await readVaultImage(this.app, file));
          try {
            await navigator.clipboard.writeText(object.url);
            new Notice(t("Uploaded URL copied"));
          } catch { new Notice(object.url, 15000); }
        }
      });
    }));
  }

  networkAllowed(url: string): boolean {
    return this.settings.workOnNetWork && !isOwnImage(url, this.settings.s3)
      && !this.helper.hasBlackDomain(url, this.settings.newWorkBlackDomains);
  }

  async uploadAllFile() {
    const target = this.captureTarget();
    if (!target || !this.ready(true)) return;
    await this.uploadReferences(target, this.helper.getImageLink(target.editor.getValue()));
  }

  async uploadReferences(target: DocumentTarget, references: Image[]) {
    if (this.batches.has(target.file)) { new Notice(t("Upload already running")); return; }
    const uploader = this.getUploader();
    this.batches.add(target.file);
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
      const results = await mapConcurrent([...groups.values()], async (source): Promise<TaskResult<SourceGroup>> => {
        try {
          if (this.stopped) throw new Error(t("Operation cancelled"));
          const image = source.file ? await readVaultImage(this.app, source.file) : await downloadImage(source.url);
          return { source, success: true, object: await uploader.upload(image) };
        } catch (error) { return { source, success: false, error: (error as Error).message }; }
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
      await updateDocument(this.app, target, value => {
        applied.clear();
        for (const ref of getImageReferences(value)) if (replacements.has(ref.source)) applied.add(ref.source);
        return replaceImageReferences(value, replacements);
      });
      if (this.settings.deleteSource) {
        for (const result of results) {
          if (result.success === true && result.source.file && result.source.references.some(ref => applied.has(ref.source))) {
            await this.safeTrash(result.source.file, target);
          }
        }
      }
      this.report(succeeded, failed, skipped);
    } finally { this.batches.delete(target.file); }
  }

  private async safeTrash(file: TFile, target: DocumentTarget) {
    // Refuse deletion on incomplete caches, unreadable notes or remaining references.
    try {
      for (const note of this.app.vault.getMarkdownFiles()) {
        const live = note === target.file ? targetEditor(this.app, target) : undefined;
        const content = live ? live.getValue() : await this.app.vault.cachedRead(note);
        if (this.helper.getImageLink(content).some(ref => !isNetworkUrl(ref.path) && this.helper.resolveImage(ref.path, note.path) === file)) return;
        const cache = this.app.metadataCache.getFileCache(note);
        if (!cache) return;
        // Include ordinary links, not only image embeds. Stale caches err on preservation.
        if ([...(cache.links || []), ...(cache.embeds || [])].some(link => this.helper.resolveImage(link.link, note.path) === file)) return;
      }
      await this.app.fileManager.trashFile(file);
    } catch { new Notice(t("Source preserved")); }
  }

  handleName(name: string) {
    if (this.settings.imageDesc === "none" || (this.settings.imageDesc === "removeDefault" && name === "image.png")) return "";
    const suffix = this.settings.imageSizeSuffix || "";
    return name + (suffix && !/\|\d+(?:x\d+)?$/.test(name) ? suffix : "");
  }
  markdown(name: string, url: string) {
    const alt = this.handleName(name).replace(/[\r\n]/g, " ")
      .replace(/(\\*)([\[\]])/g, (_match, slashes: string, bracket: string) => slashes + (slashes.length % 2 ? "" : "\\") + bracket);
    return `![${alt}](${url})`;
  }
  private report(success: number, failed: number, skipped: number) {
    new Notice(`${t("Upload result")}: ${t("Success")} ${success}, ${t("Failed")} ${failed}, ${t("Skipped")} ${skipped}`);
  }
}
