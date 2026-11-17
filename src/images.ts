import { getBlobArrayBuffer, requestUrl } from "obsidian";
import type { App, TFile } from "obsidian";
import type { ImageData } from "./types";
import { getUrlAsset, imageFormat, mimeForName, safeDecode } from "./utils";

export async function readBlob(file: File): Promise<ImageData> {
  const data = await getBlobArrayBuffer(file);
  return checkedImage(data, file.type, file.name || "image");
}

export async function readVaultImage(app: App, file: TFile): Promise<ImageData> {
  return checkedImage(await app.vault.readBinary(file), mimeForName(file.name), file.name);
}

export function checkedImage(data: ArrayBuffer, contentType: string, name: string): ImageData {
  const format = imageFormat(data, contentType, name);
  if (!format) throw new Error("Unsupported image data");
  return { data, contentType: format.mime, name };
}

export async function downloadImage(url: string): Promise<ImageData> {
  let response: Awaited<ReturnType<typeof requestUrl>>;
  try { response = await requestUrl({ url, throw: false }); }
  catch { throw new Error("Image download failed: network error"); }
  if (response.status < 200 || response.status >= 300) throw new Error(`Image download failed (HTTP ${response.status})`);
  const contentType = Object.entries(response.headers).find(([key]) => key.toLowerCase() === "content-type")?.[1] || "";
  return checkedImage(response.arrayBuffer, contentType, safeDecode(getUrlAsset(url)));
}
