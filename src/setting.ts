import { App, PluginSettingTab, Setting } from "obsidian";
import type ImageAutoUploadPlugin from "./main";
import { t } from "./lang/helpers";
import { testConnection } from "./connection";

export interface S3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  forcePathStyle: boolean;
  prefix: string;
  publicBaseUrl: string;
}

export interface PluginSettings {
  settingsVersion: number;
  s3: S3Settings;
  uploadByClipSwitch: boolean;
  imageSizeSuffix: string;
  workOnNetWork: boolean;
  newWorkBlackDomains: string;
  applyImage: boolean;
  deleteSource: boolean;
  imageDesc: "origin" | "none" | "removeDefault";
}

export const DEFAULT_SETTINGS: PluginSettings = {
  settingsVersion: 1,
  s3: {
    endpoint: "", region: "", bucket: "", accessKeyId: "",
    secretAccessKey: "", sessionToken: "", forcePathStyle: false,
    prefix: "obsidian", publicBaseUrl: "",
  },
  uploadByClipSwitch: true,
  imageSizeSuffix: "",
  workOnNetWork: false,
  applyImage: true,
  newWorkBlackDomains: "",
  deleteSource: false,
  imageDesc: "origin",
};

/** Copy supported settings without mutating defaults or carrying PicGo fields. */
export function migrateSettings(data: Partial<PluginSettings> | null): PluginSettings {
  const saved = data || {};
  const settings: PluginSettings = {
    ...DEFAULT_SETTINGS,
    s3: { ...DEFAULT_SETTINGS.s3, ...saved.s3 },
  };
  for (const key of ["uploadByClipSwitch", "workOnNetWork", "applyImage"] as const) {
    if (typeof saved[key] === "boolean") settings[key] = saved[key];
  }
  for (const key of ["imageSizeSuffix", "newWorkBlackDomains"] as const) {
    if (typeof saved[key] === "string") settings[key] = saved[key];
  }
  if (["origin", "none", "removeDefault"].includes(saved.imageDesc)) settings.imageDesc = saved.imageDesc;
  settings.deleteSource = saved.settingsVersion === 1 && saved.deleteSource === true;
  return settings;
}

export class SettingTab extends PluginSettingTab {
  private testing = false;
  private testStatus = "";
  constructor(app: App, private plugin: ImageAutoUploadPlugin) { super(app, plugin); }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: t("S3 upload") });
    containerEl.createEl("p", { text: t("S3 credentials warning") });
    const fields: [keyof S3Settings, Parameters<typeof t>[0], string, boolean?][] = [
      ["endpoint", "Endpoint", "https://s3.ap-southeast-1.amazonaws.com"],
      ["region", "Region", "ap-southeast-1"],
      ["bucket", "Bucket", "my-images"],
      ["accessKeyId", "Access Key ID", ""],
      ["secretAccessKey", "Secret Access Key", "", true],
      ["sessionToken", "Session Token", "", true],
      ["publicBaseUrl", "Public base URL", "https://images.example.com"],
      ["prefix", "Object prefix", "obsidian"],
    ];
    for (const [key, label, placeholder, secret] of fields) {
      new Setting(containerEl).setName(t(label)).addText(text => {
        if (secret) text.inputEl.type = "password";
        text.setPlaceholder(placeholder).setValue(String(this.plugin.settings.s3[key]))
          .onChange(async value => {
            (this.plugin.settings.s3[key] as string) = value.trim();
            await this.plugin.saveSettings();
          });
      });
    }
    new Setting(containerEl).setName(t("Path style"))
      .setDesc(t("Path style description"))
      .addToggle(toggle => toggle.setValue(this.plugin.settings.s3.forcePathStyle)
        .onChange(async value => {
          this.plugin.settings.s3.forcePathStyle = value;
          await this.plugin.saveSettings();
        }));
    containerEl.createEl("p", { text: t("Public URL description") });
    const connection = new Setting(containerEl).setName(t("Test connection"))
      .setDesc(t("Test connection description"));
    const result = containerEl.createEl("p", { text: this.testStatus });
    result.setAttribute("aria-live", "polite");
    result.setAttribute("style", "white-space: pre-wrap");
    connection.addButton(button => button.setButtonText(t("Test connection")).setDisabled(this.testing)
      .onClick(async () => {
        if (this.testing) return;
        this.testing = true;
        const settings = { ...this.plugin.settings.s3 };
        const show = (text: string) => { this.testStatus = text; result.textContent = text; };
        button.setDisabled(true);
        show(t("Test uploading"));
        try {
          const checked = await testConnection(settings, () => show(t("Test checking access")));
          show(`${t("Test upload success")}\n${checked.accessible ? t("Test access success")
            : `${t("Test access failed")}: ${checked.accessError}. ${t("Test access hint")}`}\n${t("Test retained key")}: ${checked.object.key}`);
        } catch (error) {
          show(`${t("Test upload failed")}: ${error instanceof Error ? error.message : t("Operation failed")}`);
        } finally {
          this.testing = false;
          button.setDisabled(false);
          // A settings redraw may have replaced the original button while awaiting network I/O.
          if (!button.buttonEl.isConnected && this.containerEl.isConnected) this.display();
        }
      }));
    const toggles: [keyof PluginSettings, Parameters<typeof t>[0]][] = [
      ["uploadByClipSwitch", "Auto pasted upload"],
      ["workOnNetWork", "Work on network"],
      ["applyImage", "Upload when clipboard has image and text together"],
      ["deleteSource", "Delete source file after you upload file"],
    ];
    for (const [key, label] of toggles) {
      const setting = new Setting(containerEl).setName(t(label));
      if (key === "deleteSource") setting.setDesc(t("Safe deletion description"));
      if (key === "workOnNetWork") setting.setDesc(t("Work on network Description"));
      setting.addToggle(toggle => toggle.setValue(Boolean(this.plugin.settings[key]))
        .onChange(async value => {
          (this.plugin.settings[key] as boolean) = value;
          await this.plugin.saveSettings();
        }));
    }
    new Setting(containerEl).setName(t("Network Domain Black List"))
      .setDesc(t("Network Domain Black List Description"))
      .addTextArea(text => text.setValue(this.plugin.settings.newWorkBlackDomains)
        .onChange(async value => {
          this.plugin.settings.newWorkBlackDomains = value;
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl).setName(t("Image desc"))
      .addDropdown(dropdown => dropdown.addOption("origin", t("reserve"))
        .addOption("none", t("remove all")).addOption("removeDefault", t("remove default"))
        .setValue(this.plugin.settings.imageDesc)
        .onChange(async (value: PluginSettings["imageDesc"]) => {
          this.plugin.settings.imageDesc = value;
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl).setName(t("Image size suffix"))
      .setDesc(t("Image size suffix Description"))
      .addText(text => text.setValue(this.plugin.settings.imageSizeSuffix)
        .onChange(async value => {
          this.plugin.settings.imageSizeSuffix = value;
          await this.plugin.saveSettings();
        }));
  }
}
