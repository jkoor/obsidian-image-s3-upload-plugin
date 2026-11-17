import { beforeEach, describe, expect, it, vi } from "vitest";
import { Setting } from "obsidian";
import { SettingTab, migrateSettings } from "../src/setting";
import { testConnection } from "../src/connection";

vi.mock("../src/connection", () => ({ testConnection: vi.fn() }));
const test = vi.mocked(testConnection);
const controls = Setting as unknown as { instances: { name: string; button: any }[] };

function setup(declarative = false) {
  const settings = migrateSettings(null);
  const plugin: any = { settings };
  const tab = new SettingTab({} as any, plugin);
  const paragraphs: any[] = [];
  (tab as any).containerEl = {
    isConnected: true,
    empty: () => {},
    createEl: (_tag: string, options: any) => {
      const el = { textContent: options.text, setAttribute: vi.fn(), setCssStyles: vi.fn() };
      paragraphs.push(el);
      return el;
    },
  };
  if (declarative) {
    const group = tab.getSettingDefinitions()[0];
    if (!("type" in group) || group.type !== "group") throw new Error("Expected settings group");
    for (const row of group.items) {
      const setting = new Setting((tab as any).containerEl).setName(row.name);
      if ("desc" in row && row.desc) setting.setDesc(row.desc);
      if ("render" in row) row.render?.(setting, undefined);
    }
  } else tab.display();
  return { tab, settings, button: controls.instances.find(item => item.name === "Test connection").button,
    result: paragraphs.find(el => el.setAttribute.mock.calls.length) };
}

beforeEach(() => { test.mockReset(); controls.instances.length = 0; });

describe("connection settings UI", () => {
  it("provides searchable definitions matching the legacy settings without creating controls during indexing", () => {
    const { tab } = setup();
    const names = controls.instances.map(row => row.name).slice(1);
    controls.instances.length = 0;
    const group = tab.getSettingDefinitions()[0];
    expect(controls.instances).toHaveLength(0);
    if (!("type" in group) || group.type !== "group") throw new Error("Expected settings group");
    expect(group.items.map(row => row.name)).toEqual(names);
  });

  it("runs the connection action rendered through Obsidian 1.13+ definitions", async () => {
    const state = setup(true);
    test.mockResolvedValue({ object: { key: "declarative" } as any, accessible: true });
    await state.button.click();
    expect(test).toHaveBeenCalledOnce();
    expect(state.result.textContent).toContain("Public access verified");
    expect(state.result.textContent).toContain("declarative");
    expect(state.button.disabled).toBe(false);
  });

  it("prevents duplicate tests, snapshots settings, and restores the button", async () => {
    const state = setup();
    let finish: (value: any) => void;
    test.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = state.button.click();
    expect(state.button.disabled).toBe(true);
    await state.button.click();
    expect(test).toHaveBeenCalledOnce();
    state.settings.s3.bucket = "changed";
    expect(test.mock.calls[0][0].bucket).toBe("");
    test.mock.calls[0][1]();
    expect(state.result.textContent).toContain("checking public access");
    finish({ object: { key: "test/key.png" }, accessible: true });
    await pending;
    expect(state.button.disabled).toBe(false);
    expect(state.result.textContent).toContain("Public access verified");
    expect(state.result.textContent).toContain("test/key.png");
  });

  it("shows upload success and public failure separately", async () => {
    const state = setup();
    test.mockResolvedValue({ object: { key: "kept" } as any, accessible: false, accessError: "HTTP 403" });
    await state.button.click();
    expect(state.result.textContent).toContain("S3 upload succeeded");
    expect(state.result.textContent).toContain("verification failed: HTTP 403");
    expect(state.button.disabled).toBe(false);
  });

  it("recovers from validation or upload exceptions", async () => {
    const state = setup();
    test.mockRejectedValue(new Error("S3: bucket is required"));
    await state.button.click();
    expect(state.result.textContent).toContain("bucket is required");
    expect(state.button.disabled).toBe(false);
  });

  it("restores a button recreated by a settings redraw while testing", async () => {
    const state = setup();
    let finish: (value: any) => void;
    test.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = state.button.click();
    state.button.buttonEl.isConnected = false;
    state.tab.display();
    expect(controls.instances.filter(item => item.button).at(-1).button.disabled).toBe(true);
    finish({ object: { key: "kept" }, accessible: true });
    await pending;
    expect(controls.instances.filter(item => item.button).at(-1).button.disabled).toBe(false);
  });
});

describe("untrusted saved settings", () => {
  it.each([null, undefined, false, 42, "invalid", []])("recovers defaults from %j", value => {
    expect(migrateSettings(value)).toEqual(migrateSettings(null));
  });

  it("copies only supported S3 fields with the correct types", () => {
    const settings = migrateSettings({ settingsVersion: 1, deleteSource: true,
      s3: { bucket: "images", endpoint: 42, secretAccessKey: null, forcePathStyle: "true", obsolete: "removed" },
      imageDesc: "invalid", uploadByClipSwitch: "false" });
    expect(settings.deleteSource).toBe(true);
    expect(settings.s3).toEqual({ ...migrateSettings(null).s3, bucket: "images" });
    expect(settings.imageDesc).toBe("origin");
    expect(settings.uploadByClipSwitch).toBe(true);
  });
});
