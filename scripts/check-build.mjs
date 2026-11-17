import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { rollup } from "rollup";
import config from "../rollup.config.js";

// Compare the on-disk release bundle with a fresh build using the same config.
const released = readFileSync("main.js", "utf8");
const { output, ...input } = config;
const bundle = await rollup(input);
try {
  const generated = await bundle.generate(output);
  const chunk = generated.output.find(file => file.type === "chunk" && file.isEntry);
  if (!chunk || chunk.code !== released) {
    throw new Error("main.js differs from a fresh build. Run pnpm run build before releasing.");
  }
  const imports = [...released.matchAll(/\brequire\(["']([^"']+)["']\)/g)].map(match => match[1]);
  if (imports.some(name => name !== "obsidian")) {
    throw new Error(`Unexpected runtime dependency: ${imports.join(", ")}`);
  }
  console.log(`Reproducible main.js verified (SHA-256 ${createHash("sha256").update(released).digest("hex")}).`);
} finally {
  await bundle.close();
}
