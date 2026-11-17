import { App, PluginSettingTab, Setting } from "obsidian";
import type { ButtonComponent, SettingDefinitionItem } from "obsidian";
import type ImageAutoUploadPlugin from "./main";
import { t } from "./lang/helpers";
import { testConnection } from "./connection";
import { isRecord } from "./utils";

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
export function migrateSettings(data: unknown): PluginSettings {
  const saved = isRecord(data) ? data : {};
  const settings: PluginSettings = {
    ...DEFAULT_SETTINGS,
    s3: { ...DEFAULT_SETTINGS.s3 },
  };
  if (isRecord(saved.s3)) {
    for (const key of ["endpoint", "region", "bucket", "accessKeyId", "secretAccessKey", "sessionToken", "prefix", "publicBaseUrl"] as const) {
      if (typeof saved.s3[key] === "string") settings.s3[key] = saved.s3[key];
    }
    if (typeof saved.s3.forcePathStyle === "boolean") settings.s3.forcePathStyle = saved.s3.forcePathStyle;
  }
  for (const key of ["uploadByClipSwitch", "workOnNetWork", "applyImage"] as const) {
    if (typeof saved[key] === "boolean") settings[key] = saved[key];
  }
  for (const key of ["imageSizeSuffix", "newWorkBlackDomains"] as const) {
    if (typeof saved[key] === "string") settings[key] = saved[key];
  }
  if (saved.imageDesc === "origin" || saved.imageDesc === "none" || saved.imageDesc === "removeDefault") settings.imageDesc = saved.imageDesc;
  settings.deleteSource = saved.settingsVersion === 1 && saved.deleteSource === true;
  return settings;
}

type SettingRow = {
  name: string;
  desc?: string;
} & ({ render: (setting: Setting) => void } | { render?: never });

export class SettingTab extends PluginSettingTab {
  private testing = false;
  private testStatus = "";
  private testButton?: ButtonComponent;
  private testResult?: HTMLElement;
  constructor(app: App, private plugin: ImageAutoUploadPlugin) { super(app, plugin); }

  // Obsidian 1.13+ renders and indexes these; older versions call display().
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [{ type: "group", heading: t("S3 upload"), items: this.getRows() }];
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName(t("S3 upload")).setHeading();
    for (const row of this.getRows()) {
      const setting = new Setting(containerEl).setName(row.name);
      if (row.desc) setting.setDesc(row.desc);
      row.render?.(setting);
    }
  }

  private getRows(): SettingRow[] {
    const rows: SettingRow[] = [{ name: t("S3 credentials warning") }];
    const fields: [Exclude<keyof S3Settings, "forcePathStyle">, Parameters<typeof t>[0], string, boolean?][] = [
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
      rows.push({ name: t(label), render: setting => { setting.addText(text => {
        if (secret) text.inputEl.type = "password";
        text.setPlaceholder(placeholder).setValue(String(this.plugin.settings.s3[key]))
          .onChange(async value => {
            this.plugin.settings.s3[key] = value.trim();
            await this.plugin.saveSettings();
          });
      }); } });
    }
    rows.push({ name: t("Path style"), desc: t("Path style description"),
      render: setting => { setting.addToggle(toggle => toggle.setValue(this.plugin.settings.s3.forcePathStyle)
        .onChange(async value => {
          this.plugin.settings.s3.forcePathStyle = value;
          await this.plugin.saveSettings();
        })); } });
    rows.push({ name: t("Public URL description") });
    rows.push({ name: t("Test connection"), desc: t("Test connection description"),
      render: setting => this.renderConnection(setting) });
    const toggles = [
      ["uploadByClipSwitch", "Auto pasted upload"],
      ["workOnNetWork", "Work on network"],
      ["applyImage", "Upload when clipboard has image and text together"],
      ["deleteSource", "Delete source file after you upload file"],
    ] as const;
    for (const [key, label] of toggles) {
      rows.push({ name: t(label),
        desc: key === "deleteSource" ? t("Safe deletion description")
          : key === "workOnNetWork" ? t("Work on network Description") : undefined,
        render: setting => { setting.addToggle(toggle => toggle.setValue(this.plugin.settings[key])
          .onChange(async value => {
            this.plugin.settings[key] = value;
            await this.plugin.saveSettings();
          })); } });
    }
    rows.push({ name: t("Network Domain Black List"), desc: t("Network Domain Black List Description"),
      render: setting => { setting.addTextArea(text => text.setValue(this.plugin.settings.newWorkBlackDomains)
        .onChange(async value => {
          this.plugin.settings.newWorkBlackDomains = value;
          await this.plugin.saveSettings();
        })); } });
    rows.push({ name: t("Image desc"), render: setting => { setting.addDropdown(dropdown => dropdown.addOption("origin", t("reserve"))
      .addOption("none", t("remove all")).addOption("removeDefault", t("remove default"))
      .setValue(this.plugin.settings.imageDesc)
      .onChange(async value => {
        if (value !== "origin" && value !== "none" && value !== "removeDefault") return;
        this.plugin.settings.imageDesc = value;
        await this.plugin.saveSettings();
      })); } });
    rows.push({ name: t("Image size suffix"), desc: t("Image size suffix Description"),
      render: setting => { setting.addText(text => text.setValue(this.plugin.settings.imageSizeSuffix)
        .onChange(async value => {
          this.plugin.settings.imageSizeSuffix = value;
          await this.plugin.saveSettings();
        })); } });
    return rows;
  }

  private renderConnection(setting: Setting) {
    const result = setting.descEl.createEl("p", { text: this.testStatus, cls: "image-s3-upload-connection-result" });
    this.testResult = result;
    result.setAttribute("aria-live", "polite");
    setting.addButton(button => {
      this.testButton = button;
      button.setButtonText(t("Test connection")).setDisabled(this.testing)
      .onClick(async () => {
        if (this.testing) return;
        this.testing = true;
        const settings = { ...this.plugin.settings.s3 };
        const show = (text: string) => {
          this.testStatus = text;
          if (this.testResult) this.testResult.textContent = text;
        };
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
          // A search result or redraw may have replaced the original controls.
          this.testButton?.setDisabled(false);
        }
      });
    });
  }
}
