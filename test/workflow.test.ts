import { beforeEach, describe, expect, it, vi } from "vitest";
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
  return Object.assign(new TFile(), { path, name: path.split("/").pop() });
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
      process: vi.fn(async (file: TFile, transform: (value: string) => string) => { notes.set(file.path, transform(notes.get(file.path))); }),
      adapter: { exists: vi.fn(async () => true) },
      createFolder: vi.fn(),
      createBinary: vi.fn(async () => {}),
    },
    metadataCache: {
      getFileCache: vi.fn(() => ({})),
      getFirstLinkpathDest: vi.fn((path: string, source: string) => path === "photo.png" && source === note.path ? image : files.get(path)),
    },
    fileManager: { trashFile: vi.fn(), getAvailablePathForAttachment: vi.fn(async () => "attachments/saved.png") },
  };
  const plugin = new ImageAutoUploadPlugin(app, {} as any);
  plugin.settings = { ...migrateSettings(null), s3: config, workOnNetWork: true };
  plugin.helper = new Helper(app);
  return { app, plugin, note, image, edit, view, notes, events };
}

beforeEach(() => { vi.restoreAllMocks(); vi.mocked(requestUrl).mockReset(); notices.messages.length = 0; });

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
    state.app.metadataCache.getFileCache.mockReturnValue({ links: [{ link: "notes/photo.png" }] });
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
