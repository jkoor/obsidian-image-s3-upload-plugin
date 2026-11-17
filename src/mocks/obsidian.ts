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
  containerEl: HTMLElement;
  constructor(_app: any, _plugin: any) {}
}

export class Setting {
  static instances: Setting[] = [];
  name: string;
  description: string;
  button: any;
  constructor(_container: unknown) { Setting.instances.push(this); }
  setName(name: string) { this.name = name; return this; }
  setDesc(description: string) { this.description = description; return this; }
  addButton(callback: (button: any) => unknown) {
    const button: any = {
      buttonEl: { isConnected: true }, disabled: false,
      setButtonText: (text: string) => { button.text = text; return button; },
      setDisabled: (disabled: boolean) => { button.disabled = disabled; return button; },
      onClick: (click: () => unknown) => { button.click = click; return button; },
    };
    this.button = button;
    callback(button);
    return this;
  }
  private control(callback: (control: any) => unknown) {
    const control: any = {
      inputEl: {}, setPlaceholder: () => control, setValue: () => control,
      onChange: () => control, addOption: () => control,
    };
    callback(control);
    return this;
  }
  addText(callback: (control: any) => unknown) { return this.control(callback); }
  addTextArea(callback: (control: any) => unknown) { return this.control(callback); }
  addToggle(callback: (control: any) => unknown) { return this.control(callback); }
  addDropdown(callback: (control: any) => unknown) { return this.control(callback); }
}
export const requestUrl = vi.fn();
export const getBlobArrayBuffer = (blob: Blob) => blob.arrayBuffer();
export const moment = { locale: () => "en" };
export class Notice {
  static messages: string[] = [];
  static instances: Notice[] = [];
  hidden = false;
  duration: number;
  constructor(public message: string, duration?: number) {
    this.duration = duration;
    Notice.messages.push(message);
    Notice.instances.push(this);
  }
  setMessage(message: string) { this.message = message; Notice.messages.push(message); return this; }
  hide() { this.hidden = true; }
}
