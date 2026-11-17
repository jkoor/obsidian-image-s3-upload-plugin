import { Notice } from "obsidian";
import { relative, dirname } from "path-browserify";
import type ImageAutoUploadPlugin from "./main";
import { downloadImage } from "./images";
import { imageFormat, isNetworkUrl } from "./utils";
import { replaceImageReferences } from "./helper";
import { updateDocument } from "./document";
import { t } from "./lang/helpers";

export async function downloadAllImageFiles(plugin: ImageAutoUploadPlugin) {
  const target = plugin.captureTarget();
  if (!target) return;
  const refs = plugin.helper.getImageLink(target.editor.getValue()).filter(ref => isNetworkUrl(ref.path));
  const replacements = new Map<string, string>();
  const downloads = new Map<string, string>();
  let failed = 0;
  for (const ref of refs) {
    try {
      let path = downloads.get(ref.path);
      if (!path) {
        const image = await downloadImage(ref.path);
        const format = imageFormat(image.data);
        const name = image.name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|\r\n]/g, "-") || "image";
        path = await plugin.app.fileManager.getAvailablePathForAttachment(`${name}.${format.ext}`, target.file.path);
        const parent = dirname(path);
        if (parent !== "." && !(await plugin.app.vault.adapter.exists(parent))) await plugin.app.vault.createFolder(parent);
        await plugin.app.vault.createBinary(path, image.data);
        downloads.set(ref.path, path);
      }
      const link = encodeURI(relative(dirname(target.file.path), path)).replace(/[()]/g, char => char === "(" ? "%28" : "%29");
      replacements.set(ref.source, plugin.markdown(ref.name, link));
    } catch { failed++; }
  }
  await updateDocument(plugin.app, target, value => replaceImageReferences(value, replacements));
  new Notice(`${t("Download result")}: ${t("Success")} ${refs.length - failed}, ${t("Failed")} ${failed}`);
}
