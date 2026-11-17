import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownView, Notice, requestUrl, TFile } from "obsidian";
import ImageAutoUploadPlugin from "../src/main";
import Helper from "../src/helper";
import { DEFAULT_SETTINGS, migrateSettings } from "../src/setting";
import { S3Uploader, mapConcurrent } from "../src/uploader";
import { updateDocument } from "../src/document";
import { downloadAllImageFiles } from "../src/download";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer;
const config = { ...DEFAULT_SETTINGS.s3, endpoint: "https://s3.example.com", region: "test", bucket: "images",
  accessKeyId: "key", secretAccessKey: "secret", publicBaseUrl: "https://cdn.example.com" };
const notices = Notice as unknown as { messages: string[] };
function makeFile(path: string): TFile {
  const name = path.split("/").pop();
  return Object.assign(new TFile(), { path, name, extension: name.split(".").pop(), basename: name.replace(/\.[^.]+$/, "") });
}

function editor(initial: string) {
  let value = initial;
  const offsetToPos = (offset: number) => {
    const lines = value.slice(0, offset).split("\n");
    return { line: lines.length - 1, ch: lines[lines.length - 1].length };
  };
  const posToOffset = (position: { line: number; ch: number }) => {
    const lines = value.split("\n");
    return lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.ch;
  };
  return {
    getValue: () => value,
    set: (next: string) => { value = next; },
    replaceSelection: (text: string) => { value += text; },
    replaceRange: (text: string, from: any, to: any) => { value = value.slice(0, posToOffset(from)) + text + value.slice(posToOffset(to)); },
    offsetToPos,
  };
}

function setup(content: string) {
  const note = makeFile("notes/note.md");
  const image = makeFile("notes/photo.png");
  const other = makeFile("other/photo.png");
  const notes = new Map([[note.path, content]]);
  const files = new Map([[note.path, note], [image.path, image], [other.path, other]]);
  const edit = editor(content);
  const view = Object.assign(new MarkdownView({} as any), { file: note, editor: edit });
  const events = new Map<string, (...args: any[]) => unknown>();
  const caches = new Map<TFile, any>();
  const cacheListeners = new Set<(...args: any[]) => unknown>();
  const app: any = {
    workspace: {
      getActiveViewOfType: () => view,
      getLeavesOfType: () => [{ view }],
      on: (name: string, callback: (...args: any[]) => unknown) => { events.set(name, callback); },
    },
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path),
      getMarkdownFiles: () => [note],
      readBinary: vi.fn(async () => png),
      cachedRead: vi.fn(async (file: TFile) => notes.get(file.path)),
      read: vi.fn(async (file: TFile) => notes.get(file.path)),
      process: vi.fn(async (file: TFile, transform: (value: string) => string) => { notes.set(file.path, transform(notes.get(file.path))); }),
      adapter: { exists: vi.fn(async () => true) },
      createFolder: vi.fn(),
      createBinary: vi.fn(async () => {}),
    },
    metadataCache: {
      getFileCache: vi.fn((file: TFile) => caches.get(file) || {}),
      on: vi.fn((_name: string, callback: (...args: any[]) => unknown) => { cacheListeners.add(callback); return callback; }),
      offref: vi.fn((callback: (...args: any[]) => unknown) => cacheListeners.delete(callback)),
      getFirstLinkpathDest: vi.fn((path: string, source: string) => path === "photo.png" && source === note.path ? image : files.get(path)),
    },
    fileManager: { trashFile: vi.fn(), getAvailablePathForAttachment: vi.fn(async () => "attachments/saved.png") },
  };
  const plugin = new ImageAutoUploadPlugin(app, {} as any);
  plugin.settings = { ...migrateSettings(null), s3: config, workOnNetWork: true };
  plugin.helper = new Helper(app);
  const emitCache = (file = note, data = edit.getValue(), cache: any = {}) => {
    notes.set(file.path, data);
    caches.set(file, cache);
    cacheListeners.forEach(callback => callback(file, data, cache));
  };
  return { app, plugin, note, image, edit, view, notes, files, events, emitCache, caches, cacheListeners };
}

beforeEach(() => {
  vi.restoreAllMocks(); vi.mocked(requestUrl).mockReset(); notices.messages.length = 0;
  (Notice as any).instances.length = 0;
});
afterEach(() => { vi.useRealTimers(); });

describe("S3 image workflows", () => {
  it("deduplicates local and remote sources, updates successes only and leaves code untouched", async () => {
    const state = setup('![[photo.png|300]] ![same](photo.png) ![](https://source.example/image?id=1) ![](https://cdn.example.com/own.png) ![](https://bad.example/image)\n`![](photo.png)`');
    vi.mocked(requestUrl).mockImplementation((async (options: any) => {
      if (options.url.includes("bad.example")) return { status: 404 } as any;
      return { status: 200, headers: { "Content-Type": "image/png" }, arrayBuffer: png } as any;
    }) as any);
    const upload = vi.spyOn(S3Uploader.prototype, "upload").mockImplementation(async image => ({ bucket: "images", key: image.name, url: `https://cdn.example.com/${encodeURIComponent(image.name)}` }));
    await state.plugin.uploadAllFile();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(state.app.vault.readBinary).toHaveBeenCalledWith(state.image);
    expect(state.edit.getValue()).toContain("![photo|300](https://cdn.example.com/photo.png)");
    expect(state.edit.getValue()).toContain("![same](https://cdn.example.com/photo.png)");
    expect(state.edit.getValue()).toContain("![](https://bad.example/image)");
    expect(state.edit.getValue()).toContain("`![](photo.png)`");
    expect(notices.messages.some(message => /Success 3, Failed 1, Skipped 1/.test(message))).toBe(true);
  });

  it("writes to the original note after switching files and preserves intervening edits", async () => {
    const state = setup("![](photo.png)");
    let complete: (value: any) => void;
    vi.spyOn(S3Uploader.prototype, "upload").mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const pending = state.plugin.uploadAllFile();
    await vi.waitFor(() => expect(complete).toBeDefined());
    state.notes.set(state.note.path, "new text\n![](photo.png)");
    state.view.file = makeFile("other.md");
    state.edit.set("unrelated note");
    complete({ bucket: "images", key: "saved", url: "https://cdn.example.com/saved.png" });
    await pending;
    expect(state.notes.get(state.note.path)).toBe("new text\n![](https://cdn.example.com/saved.png)");
    expect(state.edit.getValue()).toBe("unrelated note");
  });

  it("uploads multiple File objects without filesystem or Electron APIs", async () => {
    const state = setup("");
    vi.spyOn(S3Uploader.prototype, "upload").mockResolvedValue({ bucket: "images", key: "saved", url: "https://cdn.example.com/saved.png" });
    await state.plugin.uploadFiles({ file: state.note, editor: state.edit as any }, [
      new File([png], "first.png", { type: "image/png" }),
      new File([png], "second.png", { type: "image/png" }),
    ]);
    expect(state.edit.getValue()).toContain("![first.png](https://cdn.example.com/saved.png)");
    expect(state.edit.getValue()).toContain("![second.png](https://cdn.example.com/saved.png)");
    expect(state.edit.getValue()).not.toContain("Uploading file");
  });

  it("does not reinsert references removed while uploading", async () => {
    const state = setup("![](photo.png)");
    vi.spyOn(S3Uploader.prototype, "upload").mockImplementation(async () => {
      state.edit.set("User removed the image");
      return { bucket: "images", key: "saved", url: "https://cdn.example.com/saved.png" };
    });
    await state.plugin.uploadAllFile();
    expect(state.edit.getValue()).toBe("User removed the image");
  });

  it("preserves source files when another note still references them", async () => {
    const state = setup("![](photo.png)");
    state.plugin.settings.deleteSource = true;
    const otherNote = makeFile("other.md");
    state.app.vault.getMarkdownFiles = () => [state.note, otherNote];
    state.notes.set(otherNote.path, "[shared](notes/photo.png)");
    const replace = state.edit.replaceRange;
    state.edit.replaceRange = (...args: Parameters<typeof replace>) => { replace(...args); state.emitCache(); };
    vi.spyOn(S3Uploader.prototype, "upload").mockResolvedValue({ bucket: "images", key: "saved", url: "https://cdn.example.com/saved.png" });
    await state.plugin.uploadAllFile();
    expect(state.app.fileManager.trashFile).not.toHaveBeenCalled();
  });

  it("does not intercept paste when S3 configuration is incomplete", async () => {
    const state = setup("");
    await state.plugin.onload();
    const event = { preventDefault: vi.fn(), clipboardData: { files: [new File([png], "image.png", { type: "image/png" })], getData: () => "" } };
    state.events.get("editor-paste")(event, state.edit, state.view);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("transfers pasted network Markdown after inserting it, preserving surrounding text", async () => {
    const state = setup("before\n");
    vi.spyOn(state.plugin, "loadData").mockResolvedValue(state.plugin.settings);
    await state.plugin.onload();
    vi.mocked(requestUrl).mockResolvedValue({ status: 200, headers: {}, arrayBuffer: png } as any);
    vi.spyOn(S3Uploader.prototype, "upload").mockResolvedValue({ bucket: "images", key: "saved", url: "https://cdn.example.com/saved.png" });
    const event = { preventDefault: vi.fn(), clipboardData: { files: [], getData: () => "pasted ![alt](https://source.example/image?id=1) after" } };
    state.events.get("editor-paste")(event, state.edit, state.view);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(state.edit.getValue()).toContain("https://source.example/image?id=1");
    await vi.waitFor(() => expect(state.edit.getValue()).toBe("before\npasted ![alt](https://cdn.example.com/saved.png) after"));
  });

  it("honors frontmatter and Ctrl-drop without consuming the original files", async () => {
    const state = setup("");
    vi.spyOn(state.plugin, "loadData").mockResolvedValue(state.plugin.settings);
    await state.plugin.onload();
    const files = [new File([png], "photo.png", { type: "image/png" })];
    state.app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { "image-auto-upload": false } });
    const paste = { preventDefault: vi.fn(), clipboardData: { files, getData: () => "" } };
    state.events.get("editor-paste")(paste, state.edit, state.view);
    expect(paste.preventDefault).not.toHaveBeenCalled();
    state.app.metadataCache.getFileCache.mockReturnValue({});
    const drop = { ctrlKey: true, preventDefault: vi.fn(), dataTransfer: { files } };
    state.events.get("editor-drop")(drop, state.edit, state.view);
    expect(drop.preventDefault).not.toHaveBeenCalled();
  });

  it("turns a drop into binary uploads without using a file path", async () => {
    const state = setup("");
    vi.spyOn(state.plugin, "loadData").mockResolvedValue(state.plugin.settings);
    await state.plugin.onload();
    vi.spyOn(S3Uploader.prototype, "upload").mockResolvedValue({ bucket: "images", key: "saved", url: "https://cdn.example.com/saved.png" });
    const drop = { preventDefault: vi.fn(), dataTransfer: { files: [new File([png], "mobile.png", { type: "image/png" })] } };
    state.events.get("editor-drop")(drop, state.edit, state.view);
    expect(drop.preventDefault).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(state.edit.getValue()).toContain("![mobile.png](https://cdn.example.com/saved.png)"));
  });

  it("keeps network references unchanged when network transfer is disabled", async () => {
    const state = setup("![](https://source.example/image)");
    state.plugin.settings.workOnNetWork = false;
    const upload = vi.spyOn(S3Uploader.prototype, "upload");
    await state.plugin.uploadAllFile();
    expect(upload).not.toHaveBeenCalled();
    expect(state.edit.getValue()).toBe("![](https://source.example/image)");
  });

  it("does not delete a source file when the uploaded reference was removed", async () => {
    const state = setup("![](photo.png)");
    state.plugin.settings.deleteSource = true;
    vi.spyOn(S3Uploader.prototype, "upload").mockImplementation(async () => {
      state.edit.set("removed");
      return { bucket: "images", key: "saved", url: "https://cdn.example.com/saved.png" };
    });
    await state.plugin.uploadAllFile();
    expect(state.app.fileManager.trashFile).not.toHaveBeenCalled();
  });

  it("waits for downloaded attachments to be written before replacing references", async () => {
    const state = setup("![](https://source.example/image)");
    vi.mocked(requestUrl).mockResolvedValue({ status: 200, headers: {}, arrayBuffer: png } as any);
    let finishWrite: () => void;
    state.app.vault.createBinary.mockImplementation(() => new Promise<void>(resolve => { finishWrite = resolve; }));
    const pending = downloadAllImageFiles(state.plugin);
    await vi.waitFor(() => expect(finishWrite).toBeDefined());
    expect(state.edit.getValue()).toContain("https://source.example");
    finishWrite();
    await pending;
    expect(state.edit.getValue()).toBe("![](../attachments/saved.png)");
  });
});

describe("settings and document safety", () => {
  it("migrates generic options, disables legacy deletion and does not mutate defaults", () => {
    const settings = migrateSettings({ deleteSource: true, workOnNetWork: true, uploader: "PicGo" } as any);
    expect(settings.deleteSource).toBe(false);
    expect(settings.workOnNetWork).toBe(true);
    expect(settings).not.toHaveProperty("uploader");
    settings.s3.bucket = "changed";
    expect(DEFAULT_SETTINGS.s3.bucket).toBe("");
  });
  it("does not recreate a note that was deleted during upload", async () => {
    const state = setup("original");
    state.app.vault.getAbstractFileByPath = () => null;
    expect(await updateDocument(state.app, { file: state.note, editor: state.edit as any }, () => "changed")).toBe(false);
    expect(state.edit.getValue()).toBe("original");
  });
  it("limits concurrent loading and retains input order", async () => {
    let active = 0;
    let maximum = 0;
    const results = await mapConcurrent([0, 1, 2, 3, 4, 5, 6], async value => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--; return value * 2;
    });
    expect(maximum).toBe(3);
    expect(results).toEqual([0, 2, 4, 6, 8, 10, 12]);
  });
});

const uploaded = { bucket: "images", key: "saved", url: "https://cdn.example.com/saved.png" };
function deletingState() {
  const state = setup("![](photo.png)");
  state.plugin.settings.deleteSource = true;
  vi.spyOn(S3Uploader.prototype, "upload").mockResolvedValue(uploaded);
  const replace = state.edit.replaceRange;
  state.edit.replaceRange = (...args: Parameters<typeof replace>) => { replace(...args); state.emitCache(); };
  return state;
}

describe("source cleanup", () => {
  it("trashes an unreferenced, unchanged image after a matching metadata update", async () => {
    const state = deletingState();
    await state.plugin.uploadAllFile();
    expect(state.app.fileManager.trashFile).toHaveBeenCalledOnce();
    expect(state.app.fileManager.trashFile).toHaveBeenCalledWith(state.image);
    expect(notices.messages.at(-1)).toContain("Sources moved to trash 1");
    expect(state.cacheListeners.size).toBe(0);
  });

  it("waits for delayed metadata instead of trusting the old reference cache", async () => {
    vi.useFakeTimers();
    const state = deletingState();
    const cache = { embeds: [{ link: "photo.png" }] };
    state.caches.set(state.note, cache);
    // Use the raw editor to ensure the old cache really remains until the timer.
    const raw = editor("![](photo.png)");
    state.view.editor = raw as any;
    const rawReplace = raw.replaceRange;
    raw.replaceRange = (...args: Parameters<typeof rawReplace>) => {
      rawReplace(...args);
      setTimeout(() => state.emitCache(state.note, raw.getValue()), 100);
    };
    const pending = state.plugin.uploadAllFile();
    await vi.advanceTimersByTimeAsync(50);
    expect(state.app.fileManager.trashFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(state.app.fileManager.trashFile).toHaveBeenCalledOnce();
  });

  it("keeps a source after a metadata timeout and removes listeners", async () => {
    vi.useFakeTimers();
    const state = setup("![](photo.png)");
    state.plugin.settings.deleteSource = true;
    vi.spyOn(S3Uploader.prototype, "upload").mockResolvedValue(uploaded);
    const pending = state.plugin.uploadAllFile();
    await vi.waitFor(() => expect(notices.messages.some(message => message.includes("Checking source files"))).toBe(true));
    await vi.advanceTimersByTimeAsync(3100);
    await pending;
    expect(state.app.fileManager.trashFile).not.toHaveBeenCalled();
    expect(notices.messages.at(-1)).toContain("Kept: safety not verified 1");
    expect(state.cacheListeners.size).toBe(0);
  });

  it.each(["[keep](photo.png)", "[[photo.png]]", "![[photo.png]]"])("preserves remaining reference %s", async reference => {
    const state = deletingState();
    state.edit.set(`![](photo.png) ${reference}`);
    // Only request replacement of the first reference.
    await state.plugin.uploadReferences({ file: state.note, editor: state.edit as any }, [{ path: "photo.png", name: "", source: "![](photo.png)" }]);
    expect(state.app.fileManager.trashFile).not.toHaveBeenCalled();
    expect(notices.messages.at(-1)).toContain("Kept: still referenced 1");
  });

  it("preserves an image referenced in another unsaved editor", async () => {
    const state = deletingState();
    const note = makeFile("other.md");
    state.notes.set(note.path, "");
    const view = Object.assign(new MarkdownView({} as any), { file: note, editor: editor("[shared](notes/photo.png)") });
    state.app.workspace.getLeavesOfType = () => [{ view: state.view }, { view }];
    state.app.vault.getMarkdownFiles = () => [state.note, note];
    await state.plugin.uploadAllFile();
    expect(state.app.fileManager.trashFile).not.toHaveBeenCalled();
    expect(notices.messages.at(-1)).toContain("Kept: still referenced 1");
  });

  it("preserves changed source bytes", async () => {
    const state = deletingState();
    state.app.vault.readBinary.mockResolvedValueOnce(png).mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    await state.plugin.uploadAllFile();
    expect(state.app.fileManager.trashFile).not.toHaveBeenCalled();
    expect(notices.messages.at(-1)).toContain("Kept: safety not verified 1");
  });

  it("reports trash failures separately from upload success", async () => {
    const state = deletingState();
    state.app.fileManager.trashFile.mockRejectedValue(new Error("trash unavailable"));
    await state.plugin.uploadAllFile();
    expect(notices.messages.at(-1)).toContain("Success 1, Failed 0");
    expect(notices.messages.at(-1)).toContain("Source cleanup failed 1");
  });

  it("preserves files when reference checks cannot read a note", async () => {
    const state = deletingState();
    state.app.vault.read.mockRejectedValue(new Error("read unavailable"));
    await state.plugin.uploadAllFile();
    expect(state.app.fileManager.trashFile).not.toHaveBeenCalled();
    expect(notices.messages.at(-1)).toContain("Kept: safety not verified 1");
  });

  it("does not delete when disabled or upload fails", async () => {
    const state = deletingState();
    state.plugin.settings.deleteSource = false;
    await state.plugin.uploadAllFile();
    expect(state.app.fileManager.trashFile).not.toHaveBeenCalled();
    state.plugin.settings.deleteSource = true;
    state.edit.set("![](photo.png)");
    vi.mocked(S3Uploader.prototype.upload).mockRejectedValue(new Error("failed"));
    await state.plugin.uploadAllFile();
    expect(state.app.fileManager.trashFile).not.toHaveBeenCalled();
    expect(state.cacheListeners.size).toBe(0);
  });

  it("does not delete when the note cannot be written", async () => {
    const state = deletingState();
    state.edit.replaceRange = () => { throw new Error("read only"); };
    await expect(state.plugin.uploadAllFile()).rejects.toThrow("read only");
    expect(state.app.fileManager.trashFile).not.toHaveBeenCalled();
    expect(state.cacheListeners.size).toBe(0);
    expect((Notice as any).instances[0].hidden).toBe(true);
  });

  it("stops waiting and preserves the source on unload", async () => {
    const state = setup("![](photo.png)");
    state.plugin.settings.deleteSource = true;
    vi.spyOn(S3Uploader.prototype, "upload").mockResolvedValue(uploaded);
    const pending = state.plugin.uploadAllFile();
    await vi.waitFor(() => expect(state.cacheListeners.size).toBe(1));
    state.plugin.onunload();
    await pending;
    expect(state.app.fileManager.trashFile).not.toHaveBeenCalled();
    expect(state.cacheListeners.size).toBe(0);
    expect((Notice as any).instances.every((notice: any) => notice.hidden)).toBe(true);
  });

  it("preserves a source when metadata is missing in another note", async () => {
    const state = deletingState();
    const note = makeFile("other.md");
    state.notes.set(note.path, "no references");
    state.app.vault.getMarkdownFiles = () => [state.note, note];
    state.app.metadataCache.getFileCache.mockImplementation((file: TFile) => state.caches.get(file) || null);
    await state.plugin.uploadAllFile();
    expect(state.app.fileManager.trashFile).not.toHaveBeenCalled();
    expect(notices.messages.at(-1)).toContain("Kept: safety not verified 1");
  });

  it("preserves a source if the note changes after its matching metadata event", async () => {
    const state = deletingState();
    state.app.vault.read.mockImplementation(async () => {
      state.edit.set("[new reference](photo.png)");
      return state.notes.get(state.note.path);
    });
    await state.plugin.uploadAllFile();
    expect(state.app.fileManager.trashFile).not.toHaveBeenCalled();
  });
});

function menu() {
  const items: any[] = [];
  return {
    items,
    addItem: (configure: (item: any) => void) => {
      const item: any = {
        setTitle: (title: string) => { item.title = title; return item; },
        setIcon: (icon: string) => { item.icon = icon; return item; },
        onClick: (click: () => void) => { item.click = click; return item; },
      };
      configure(item); items.push(item);
    },
  };
}

describe("article more menu and progress", () => {
  it("uploads from a reading-mode view and handles missing configuration", async () => {
    const state = setup("![](photo.png)");
    vi.spyOn(state.plugin, "loadData").mockResolvedValue(state.plugin.settings);
    await state.plugin.onload();
    const more = menu();
    state.events.get("file-menu")(more, state.note, "more-options", { view: state.view });
    const upload = vi.spyOn(S3Uploader.prototype, "upload").mockResolvedValue(uploaded);
    state.plugin.settings.s3 = { ...config, bucket: "" };
    more.items[0].click();
    expect(upload).not.toHaveBeenCalled();
    expect(notices.messages.at(-1)).toContain("bucket");
    state.plugin.settings.s3 = { ...config };
    (state.view as any).getMode = () => "preview";
    more.items[0].click();
    await vi.waitFor(() => expect(state.edit.getValue()).toContain(uploaded.url));
    state.plugin.onunload();
  });

  it("uses the menu's note even after switching tabs, including reading mode", async () => {
    const state = setup("![](photo.png)");
    vi.spyOn(state.plugin, "loadData").mockResolvedValue(state.plugin.settings);
    await state.plugin.onload();
    const more = menu();
    state.events.get("file-menu")(more, state.note, "more-options", { view: state.view });
    expect(more.items.map(item => item.title)).toEqual(["Upload images in this note"]);
    state.notes.set(state.note.path, "![](photo.png)");
    state.view.file = makeFile("other.md");
    state.edit.set("unrelated note");
    vi.spyOn(S3Uploader.prototype, "upload").mockResolvedValue(uploaded);
    more.items[0].click();
    await vi.waitFor(() => expect(state.notes.get(state.note.path)).toContain(uploaded.url));
    expect(state.edit.getValue()).toBe("unrelated note");
    const unrelated = menu();
    state.events.get("file-menu")(unrelated, state.note, "tab-header", { view: state.view });
    expect(unrelated.items).toHaveLength(0);
  });

  it("counts deduplicated files, keeps one notice and reports reference totals", async () => {
    vi.useFakeTimers();
    const state = setup("![](photo.png) ![same](photo.png)");
    let finish: (value: any) => void;
    vi.spyOn(S3Uploader.prototype, "upload").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = state.plugin.uploadAllFile();
    await vi.advanceTimersByTimeAsync(0);
    expect(notices.messages.at(-1)).toContain("Files completed 0/1");
    await state.plugin.uploadAllFile();
    expect(notices.messages.at(-1)).toContain("already running");
    finish(uploaded);
    await pending;
    const persistent = (Notice as any).instances.filter((notice: any) => notice.duration === 0);
    expect(persistent).toHaveLength(1);
    expect(persistent[0].message).toContain("(references): Success 2");
    expect(notices.messages.some(message => message.includes("Files completed 1/1"))).toBe(true);
    await vi.advanceTimersByTimeAsync(6000);
    expect(persistent[0].hidden).toBe(true);
  });

  it("reports file progress with partial failures and no persistent notice for empty work", async () => {
    const state = setup("");
    vi.spyOn(S3Uploader.prototype, "upload").mockResolvedValueOnce(uploaded).mockRejectedValueOnce(new Error("failed"));
    await state.plugin.uploadFiles({ file: state.note, editor: state.edit as any }, [new File([png], "one.png"), new File([png], "two.png")]);
    expect(notices.messages.some(message => message.includes("Files completed 2/2, Success 1, Failed 1"))).toBe(true);
    expect(notices.messages.at(-1)).toContain("(files): Success 1, Failed 1");
    state.plugin.onunload();
    const empty = setup("");
    const count = (Notice as any).instances.length;
    await empty.plugin.uploadAllFile();
    expect((Notice as any).instances.slice(count).every((notice: any) => notice.duration !== 0)).toBe(true);
  });

  it("keeps concurrent operations independent and removes notices on unload", async () => {
    const state = setup("");
    const other = makeFile("other.md");
    state.files.set(other.path, other);
    state.notes.set(other.path, "");
    const otherEditor = editor("");
    const view = Object.assign(new MarkdownView({} as any), { file: other, editor: otherEditor });
    state.app.workspace.getLeavesOfType = () => [{ view: state.view }, { view }];
    const finish: ((value: any) => void)[] = [];
    vi.spyOn(S3Uploader.prototype, "upload").mockImplementation(() => new Promise(resolve => { finish.push(resolve); }));
    const first = state.plugin.uploadFiles({ file: state.note, editor: state.edit as any }, [new File([png], "one.png")]);
    const second = state.plugin.uploadFiles({ file: other, editor: otherEditor as any }, [new File([png], "two.png")]);
    await vi.waitFor(() => expect(finish).toHaveLength(2));
    const persistent = (Notice as any).instances.filter((notice: any) => notice.duration === 0);
    expect(persistent).toHaveLength(2);
    finish[0](uploaded);
    await first;
    expect(persistent[0].message).toContain("Success 1");
    expect(persistent[1].message).toContain("Files completed 0/1");
    state.plugin.onunload();
    finish[1](uploaded);
    await second;
    expect(persistent.every((notice: any) => notice.hidden)).toBe(true);
    expect(otherEditor.getValue()).not.toContain(uploaded.url);
  });

  it("counts a retried S3 upload once", async () => {
    const state = setup("![](photo.png)");
    vi.mocked(requestUrl).mockResolvedValueOnce({ status: 503, text: "" } as any)
      .mockResolvedValueOnce({ status: 200 } as any);
    await state.plugin.uploadAllFile();
    expect(requestUrl).toHaveBeenCalledTimes(2);
    expect(notices.messages.at(-1)).toContain("Success 1, Failed 0");
    expect(notices.messages.some(message => message.includes("Files completed 2/1"))).toBe(false);
    state.plugin.onunload();
  });

  it("shows progress but never deletes an image uploaded only to copy its URL", async () => {
    const state = setup("");
    state.plugin.settings.deleteSource = true;
    vi.spyOn(state.plugin, "loadData").mockResolvedValue(state.plugin.settings);
    await state.plugin.onload();
    vi.spyOn(S3Uploader.prototype, "upload").mockResolvedValue(uploaded);
    const context = menu();
    state.events.get("file-menu")(context, state.image, "file-explorer");
    context.items[0].click();
    await vi.waitFor(() => expect(notices.messages.some(message => message.includes("Success 1"))).toBe(true));
    expect(state.app.fileManager.trashFile).not.toHaveBeenCalled();
    state.plugin.onunload();
  });
});
