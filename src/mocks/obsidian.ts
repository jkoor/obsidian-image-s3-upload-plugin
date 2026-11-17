import { vi } from "vitest";

export class App {
  workspace = {
    getActiveFile: () => ({ path: "mock/path" }),
    getActiveViewOfType: () => ({
      editor: {
        getValue: () => "",
        setValue: (value: string) => {},
        getScrollInfo: () => ({ left: 0, top: 0 }),
        scrollTo: (left: number, top: number) => {},
        getCursor: () => ({ line: 0, ch: 0 }),
        setCursor: (pos: { line: number; ch: number }) => {},
      },
    }),
  };
  metadataCache = {
    getCache: (path: string) => ({
      frontmatter: {
        key: "value",
      },
    }),
  };
}

export class MarkdownView {
  file: TFile;
  editor: any;
  constructor(_leaf?: unknown) {}
}

export class TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  constructor(path = "") {
    this.path = path;
    this.name = path.split("/").pop() || "";
    this.extension = this.name.split(".").pop() || "";
    this.basename = this.name.replace(/\.[^.]+$/, "");
  }
}

export class Plugin {
  constructor(public app: any, public manifest: any = {}) {}
  loadData = vi.fn(async () => null);
  saveData = vi.fn(async (_value: unknown) => {});
  addSettingTab = vi.fn();
  addCommand = vi.fn();
  registerEvent = vi.fn();
}

export class PluginSettingTab {
  constructor(_app: any, _plugin: any) {}
}

export class Setting {}
export const requestUrl = vi.fn();
export const getBlobArrayBuffer = (blob: Blob) => blob.arrayBuffer();
export const moment = { locale: () => "en" };
export class Notice {
  static messages: string[] = [];
  constructor(message: string, _duration?: number) { Notice.messages.push(message); }
}
