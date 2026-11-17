import { beforeEach, describe, expect, it, vi } from "vitest";
import { Setting } from "obsidian";
import { SettingTab, migrateSettings } from "../src/setting";
import { testConnection } from "../src/connection";

vi.mock("../src/connection", () => ({ testConnection: vi.fn() }));
const test = vi.mocked(testConnection);
const controls = Setting as unknown as { instances: { name: string; button: any }[] };

function setup() {
  const settings = migrateSettings(null);
  const plugin: any = { settings };
  const tab = new SettingTab({} as any, plugin);
  const paragraphs: any[] = [];
  (tab as any).containerEl = {
    isConnected: true,
    empty: () => {},
    createEl: (_tag: string, options: any) => {
      const el = { textContent: options.text, setAttribute: vi.fn() };
      paragraphs.push(el);
      return el;
    },
  };
  tab.display();
  return { tab, settings, button: controls.instances.find(item => item.name === "Test connection").button,
    result: paragraphs.find(el => el.setAttribute.mock.calls.length) };
}

beforeEach(() => { test.mockReset(); controls.instances.length = 0; });

describe("connection settings UI", () => {
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
