import { AwsClient } from "aws4fetch";
import { requestUrl } from "obsidian";
import type { S3Settings } from "../setting";
import type { ImageData } from "../types";
import type { UploadedObject, Uploader } from "./types";
import { imageFormat, uuid } from "../utils";

function parseBase(value: string, label: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${label}: invalid URL`); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label}: use an HTTP(S) URL without credentials, query or fragment`);
  }
  return url;
}

export function validateS3(settings: S3Settings): void {
  for (const key of ["endpoint", "region", "bucket", "accessKeyId", "secretAccessKey", "publicBaseUrl"] as const) {
    if (!settings[key]?.trim()) throw new Error(`S3: ${key} is required`);
  }
  parseBase(settings.endpoint, "Endpoint");
  parseBase(settings.publicBaseUrl, "Public base URL");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(settings.bucket)) throw new Error("S3: invalid bucket name");
  if (settings.prefix.split("/").some(part => part === "." || part === "..")) {
    throw new Error("S3: object prefix cannot contain . or .. segments");
  }
}

export function encodeKey(key: string): string {
  return key.split("/").map(part => encodeURIComponent(part).replace(/[!'()*]/g,
    char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
}

export function objectUrls(settings: S3Settings, key: string) {
  const endpoint = parseBase(settings.endpoint, "Endpoint");
  const prefix = endpoint.pathname.replace(/\/$/, "");
  if (settings.forcePathStyle) {
    endpoint.pathname = `${prefix}/${encodeURIComponent(settings.bucket)}/${encodeKey(key)}`;
  } else {
    endpoint.hostname = `${settings.bucket}.${endpoint.hostname}`;
    endpoint.pathname = `${prefix}/${encodeKey(key)}`;
  }
  const publicBase = parseBase(settings.publicBaseUrl, "Public base URL");
  publicBase.pathname = `${publicBase.pathname.replace(/\/$/, "")}/${encodeKey(key)}`;
  return { uploadUrl: endpoint.href, publicUrl: publicBase.href };
}

export function isOwnImage(value: string, settings: S3Settings): boolean {
  try {
    const url = new URL(value);
    const base = new URL(settings.publicBaseUrl);
    const path = `${base.pathname.replace(/\/$/, "")}/`;
    return url.origin === base.origin && url.pathname.startsWith(path);
  } catch { return false; }
}

export function createKey(settings: S3Settings, image: ImageData, now = new Date()): string {
  const format = imageFormat(image.data, image.contentType, image.name);
  if (!format) throw new Error("Unsupported image format");
  const prefix = settings.prefix.replace(/^\/+|\/+$/g, "");
  return [prefix, now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), `${uuid()}.${format.ext}`]
    .filter(part => part !== "").join("/");
}

class HttpError extends Error {
  constructor(readonly status: number, text: string) {
    // Never show a server's echo of signed headers or credentials.
    const code = /<Code>([A-Za-z0-9_.-]+)<\/Code>/.exec(text)?.[1];
    super(`S3 upload failed (HTTP ${status}${code ? `, ${code}` : ""})`);
  }
}

export class S3Uploader implements Uploader {
  private settings: S3Settings;
  constructor(settings: S3Settings) {
    this.settings = { ...settings };
    validateS3(this.settings);
    if (!window.crypto?.subtle || !window.crypto?.getRandomValues || typeof Request === "undefined" || typeof Headers === "undefined") {
      throw new Error("S3 upload requires Web Crypto, Request and Headers support in this Obsidian runtime");
    }
  }

  async upload(image: ImageData): Promise<UploadedObject> {
    const settings = this.settings;
    const key = createKey(settings, image);
    const { uploadUrl, publicUrl } = objectUrls(settings, key);
    const format = imageFormat(image.data, image.contentType, image.name);
    const hash = await crypto.subtle.digest("SHA-256", image.data);
    const payloadHash = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
    const client = new AwsClient({
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
      sessionToken: settings.sessionToken || undefined,
      service: "s3", region: settings.region,
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      let retry = false;
      try {
        const signed = await client.sign(uploadUrl, {
          method: "PUT", body: image.data,
          headers: { "Content-Type": format.mime, "x-amz-content-sha256": payloadHash },
        });
        const headers: Record<string, string> = {};
        signed.headers.forEach((value, name) => {
          if (name !== "host" && name !== "content-length") headers[name] = value;
        });
        const response = await requestUrl({
          url: signed.url, method: "PUT", headers, body: image.data, throw: false,
        });
        if (response.status >= 200 && response.status < 300) return { bucket: settings.bucket, key, url: publicUrl };
        retry = response.status === 429 || response.status >= 500;
        throw new HttpError(response.status, response.text);
      } catch (error) {
        if (!(error instanceof HttpError)) retry = true;
        if (!retry || attempt === 2) {
          if (error instanceof HttpError) throw error;
          throw new Error("S3 network or signing request failed. Check endpoint, connection and device clock.");
        }
      }
      await new Promise<void>(resolve => window.setTimeout(resolve, 400 * 2 ** attempt + Math.random() * 200));
    }
    throw new Error("S3 upload failed");
  }
}
