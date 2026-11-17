import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { requestUrl } from "obsidian";
import { DEFAULT_SETTINGS } from "../src/setting";
import { createKey, isOwnImage, objectUrls, S3Uploader, validateS3 } from "../src/uploader/s3";
import type { S3Settings } from "../src/setting";

export const settings: S3Settings = {
  ...DEFAULT_SETTINGS.s3, endpoint: "https://s3.example.com", region: "test-region",
  bucket: "pictures", accessKeyId: "test-key", secretAccessKey: "test-secret",
  publicBaseUrl: "https://cdn.example.com/assets", prefix: "中文 + (图片)",
};
export const png = { name: "hello.png", contentType: "image/png", data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer };
const request = vi.mocked(requestUrl);
const reply = (status: number, text = "") => ({ status, text, headers: {}, arrayBuffer: new ArrayBuffer(0), json: {} });

beforeEach(() => request.mockReset());

describe("S3 transport", () => {
  it("builds virtual-host and path URLs without double encoding", () => {
    const key = "中文/a b+(1)%2F.png";
    const virtual = objectUrls(settings, key);
    expect(virtual.uploadUrl).toBe("https://pictures.s3.example.com/%E4%B8%AD%E6%96%87/a%20b%2B%281%29%252F.png");
    expect(virtual.publicUrl).toBe("https://cdn.example.com/assets/%E4%B8%AD%E6%96%87/a%20b%2B%281%29%252F.png");
    expect(objectUrls({ ...settings, endpoint: "http://localhost:9000/storage", forcePathStyle: true }, key).uploadUrl)
      .toBe("http://localhost:9000/storage/pictures/%E4%B8%AD%E6%96%87/a%20b%2B%281%29%252F.png");
  });

  it("validates required configuration and unsafe URL components", () => {
    expect(() => validateS3({ ...settings, secretAccessKey: "" })).toThrow("secretAccessKey");
    expect(() => validateS3({ ...settings, endpoint: "https://user:password@example.com" })).toThrow("credentials");
    expect(() => validateS3({ ...settings, prefix: "a/../b" })).toThrow("prefix");
  });

  it("generates unique keys while preserving the actual format", () => {
    const first = createKey(settings, { ...png, name: "wrong.jpg" }, new Date(2026, 10, 16));
    expect(first).toMatch(/^中文 \+ \(图片\)\/2026\/11\/[a-f0-9]{32}\.png$/);
    expect(createKey(settings, png)).not.toBe(createKey(settings, png));
  });

  it("skips only images inside its own public URL path", () => {
    expect(isOwnImage("https://cdn.example.com/assets/a.png", settings)).toBe(true);
    expect(isOwnImage("https://cdn.example.com/assets-other/a.png", settings)).toBe(false);
    expect(isOwnImage("https://cdn.example.com.evil/assets/a.png", settings)).toBe(false);
  });

  it("sends bytes with a verifiable SigV4 signature, including temporary credentials", async () => {
    request.mockResolvedValue(reply(200));
    const credentials = { ...settings, sessionToken: "temporary-token" };
    const uploaded = await new S3Uploader(credentials).upload(png);
    const options = request.mock.calls[0][0] as any;
    expect(options.body).toBe(png.data);
    expect(options.method).toBe("PUT");
    expect(options.headers["content-type"]).toBe("image/png");
    expect(options.headers["x-amz-security-token"]).toBe("temporary-token");
    expect(options.headers.host).toBeUndefined();
    expect(options.headers["content-length"]).toBeUndefined();
    const url = new URL(options.url);
    const authorization: string = options.headers.authorization;
    const signedHeaders = /SignedHeaders=([^,]+)/.exec(authorization)[1];
    const date: string = options.headers["x-amz-date"];
    const scope = `${date.slice(0, 8)}/${credentials.region}/s3/aws4_request`;
    const canonicalHeaders = signedHeaders.split(";").map(name => `${name}:${name === "host" ? url.host : options.headers[name]}\n`).join("");
    const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
    const canonical = ["PUT", url.pathname, "", canonicalHeaders, signedHeaders, hash(new Uint8Array(png.data))].join("\n");
    const toSign = ["AWS4-HMAC-SHA256", date, scope, hash(canonical)].join("\n");
    let key: any = `AWS4${credentials.secretAccessKey}`;
    for (const value of [date.slice(0, 8), credentials.region, "s3", "aws4_request"]) key = createHmac("sha256", key).update(value).digest();
    const expected = createHmac("sha256", key).update(toSign).digest("hex");
    expect(authorization).toContain(`Signature=${expected}`);
    expect(uploaded.url).toBe(objectUrls(credentials, uploaded.key).publicUrl);
  });

  it("reports authorization errors without retrying or leaking response text", async () => {
    request.mockResolvedValue(reply(403, "<Code>AccessDenied</Code><Secret>test-secret</Secret>"));
    await expect(new S3Uploader(settings).upload(png)).rejects.toThrow("HTTP 403, AccessDenied");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures using exactly the same object key", async () => {
    request.mockResolvedValueOnce(reply(503)).mockResolvedValueOnce(reply(429)).mockResolvedValue(reply(200));
    await new S3Uploader(settings).upload(png);
    expect(request).toHaveBeenCalledTimes(3);
    expect(new Set(request.mock.calls.map(([options]: any[]) => options.url)).size).toBe(1);
  });
});
