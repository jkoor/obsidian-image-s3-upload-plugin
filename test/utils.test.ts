import { describe, expect, it } from "vitest";
import { getUrlAsset, imageFormat, isAnImage, isAssetTypeAnImage, safeDecode } from "../src/utils";

describe("portable image utilities", () => {
  it("recognizes supported image extensions case-insensitively", () => {
    expect(isAnImage(".PNG")).toBe(true);
    expect(isAnImage(".txt")).toBe(false);
    expect(isAssetTypeAnImage("folder/image.avif")).toBe(true);
    expect(isAssetTypeAnImage("folder.png/note.md")).toBe(false);
  });
  it("extracts names without query strings or fragments", () => {
    expect(getUrlAsset("https://example.com/path/image.png?query=123#fragment")).toBe("image.png");
    expect(safeDecode("image%20name.png")).toBe("image name.png");
    expect(safeDecode("bad%name.png")).toBe("bad%name.png");
  });
  it("detects binary image types instead of trusting extensions and MIME", () => {
    expect(imageFormat(new Uint8Array([255, 216, 255, 0]).buffer, "image/png", "wrong.png")).toEqual({ ext: "jpg", mime: "image/jpeg" });
    expect(imageFormat(new TextEncoder().encode("GIF89a...").buffer)).toEqual({ ext: "gif", mime: "image/gif" });
    expect(imageFormat(new TextEncoder().encode("RIFFxxxxWEBP").buffer)?.ext).toBe("webp");
    expect(imageFormat(new TextEncoder().encode("\uFEFF<?xml version='1.0'?><svg xmlns='http://www.w3.org/2000/svg'></svg>").buffer)?.ext).toBe("svg");
    expect(imageFormat(new TextEncoder().encode("<html>login required</html>").buffer, "image/png", "fake.png")).toBeUndefined();
    expect(imageFormat(new ArrayBuffer(0))).toBeUndefined();
  });
});
