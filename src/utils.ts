const FORMATS: Record<string, string | undefined> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  bmp: "image/bmp", svg: "image/svg+xml", tiff: "image/tiff", tif: "image/tiff",
  webp: "image/webp", avif: "image/avif",
};

export function isAnImage(ext: string): boolean {
  return ext.startsWith(".") && ext.slice(1).toLowerCase() in FORMATS;
}

export function isAssetTypeAnImage(path: string): boolean {
  return isAnImage(/\.[^./]+$/.exec(path)?.[0] || "");
}

export function mimeForName(name: string): string {
  return FORMATS[/\.([^./]+)$/.exec(name)?.[1]?.toLowerCase()] || "application/octet-stream";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Detect bytes rather than renaming every pasted file to PNG or trusting a URL. */
export function imageFormat(data: ArrayBuffer, _contentType = "", _name = ""): { ext: string; mime: string } | undefined {
  const bytes = new Uint8Array(data);
  const has = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  let ext: string;
  if (has(137, 80, 78, 71, 13, 10, 26, 10)) ext = "png";
  else if (has(255, 216, 255)) ext = "jpg";
  else if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) ext = "gif";
  else if (has(66, 77)) ext = "bmp";
  else if (has(73, 73, 42, 0) || has(77, 77, 0, 42)) ext = "tiff";
  else if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") ext = "webp";
  else if (ascii(4, 8) === "ftyp" && /avif|avis/.test(ascii(8, 64))) ext = "avif";
  else {
    const text = new TextDecoder().decode(bytes.slice(0, 8192)).replace(/^\uFEFF/, "").trim();
    if (/^(?:(?:<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->)\s*)*<svg(?:\s|>)/i.test(text)) ext = "svg";
    else return undefined;
  }
  return { ext, mime: FORMATS[ext] };
}

export function getUrlAsset(url: string): string {
  try { return new URL(url).pathname.split("/").pop() || "image"; }
  catch { return url.split("/").pop().split(/[?#]/)[0]; }
}

export function uuid(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function isNetworkUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function safeDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}
