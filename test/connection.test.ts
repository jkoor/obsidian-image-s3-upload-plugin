import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { testConnection } from "../src/connection";
import { DEFAULT_SETTINGS } from "../src/setting";
import { inflateSync } from "node:zlib";

const settings = {
  ...DEFAULT_SETTINGS.s3, endpoint: "https://s3.example.com", region: "test", bucket: "images",
  accessKeyId: "key", secretAccessKey: "secret", publicBaseUrl: "https://cdn.example.com",
};
const request = vi.mocked(requestUrl);
beforeEach(() => { request.mockReset(); });

describe("connection test", () => {
  it("PUTs a valid PNG then verifies the public GET without listing or deleting", async () => {
    let uploaded: ArrayBuffer;
    request.mockImplementation((async (options: any) => {
      if (options.method === "PUT") {
        uploaded = options.body;
        return { status: 200 };
      }
      expect(options.url).toContain("https://cdn.example.com/obsidian/");
      return { status: 200, arrayBuffer: uploaded };
    }) as any);
    const result = await testConnection(settings);
    expect(result.accessible).toBe(true);
    expect(result.object.key).toMatch(/obsidian\/\d{4}\/\d{2}\/[a-f0-9]{32}\.png/);
    expect(new Uint8Array(uploaded).length).toBeGreaterThan(60);
    expect([...inflateSync(new Uint8Array(uploaded).slice(41, 52))]).toEqual([0, 0, 0, 0, 0]);
    expect(request.mock.calls.map(([options]: any[]) => options.method)).toEqual(["PUT", "GET"]);
  });

  it("rejects missing configuration without a request", async () => {
    await expect(testConnection({ ...settings, bucket: "" })).rejects.toThrow("bucket");
    expect(request).not.toHaveBeenCalled();
  });

  it("stops after an upload failure and sanitizes server errors", async () => {
    request.mockResolvedValue({ status: 403, text: "<Code>AccessDenied</Code><Secret>secret</Secret>" } as any);
    await expect(testConnection(settings)).rejects.toThrow("HTTP 403, AccessDenied");
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([403, 404, 500])("separates public HTTP %i from upload success", async status => {
    request.mockResolvedValueOnce({ status: 200 } as any).mockResolvedValueOnce({ status } as any);
    const result = await testConnection(settings);
    expect(result.accessible).toBe(false);
    expect(result.accessError).toBe(`HTTP ${status}`);
    expect(result.object.key).toBeTruthy();
  });

  it("detects public content mismatch", async () => {
    request.mockResolvedValueOnce({ status: 200 } as any)
      .mockResolvedValueOnce({ status: 200, arrayBuffer: new Uint8Array([1, 2]).buffer } as any);
    expect((await testConnection(settings)).accessError).toContain("different content");
  });

  it("reports a public network failure without exposing the original exception", async () => {
    request.mockResolvedValueOnce({ status: 200 } as any).mockRejectedValueOnce(new Error("sensitive request"));
    const result = await testConnection(settings);
    expect(result.accessible).toBe(false);
    expect(result.accessError).toBe("Could not reach the public URL");
  });
});
