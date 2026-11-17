import { requestUrl } from "obsidian";
import type { S3Settings } from "./setting";
import { S3Uploader } from "./uploader";
import type { UploadedObject } from "./uploader";
import { t } from "./lang/helpers";

export interface ConnectionResult {
  object: UploadedObject;
  accessible: boolean;
  accessError?: string;
}

/** A complete 1×1 PNG, not just a file signature. */
function testImage(): ArrayBuffer {
  const bytes = atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=");
  return Uint8Array.from(bytes, char => char.charCodeAt(0)).buffer;
}

export async function testConnection(settings: S3Settings, checkingAccess: () => void = () => {}): Promise<ConnectionResult> {
  const uploader = new S3Uploader({ ...settings });
  const data = testImage();
  const object = await uploader.upload({ name: "connection-test.png", contentType: "image/png", data });
  checkingAccess();
  try {
    const response = await requestUrl({ url: object.url, method: "GET", throw: false });
    if (response.status < 200 || response.status >= 300) {
      return { object, accessible: false, accessError: `HTTP ${response.status}` };
    }
    const expected = new Uint8Array(data);
    const actual = new Uint8Array(response.arrayBuffer);
    if (actual.length !== expected.length || actual.some((byte, i) => byte !== expected[i])) {
      return { object, accessible: false, accessError: t("Test content mismatch") };
    }
    return { object, accessible: true };
  } catch {
    return { object, accessible: false, accessError: t("Test access network error") };
  }
}
