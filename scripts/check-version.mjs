import { readFileSync } from "node:fs";

const readJson = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
const pkg = readJson("package.json");
const manifest = readJson("manifest.json");
const versions = readJson("versions.json");
const tag = process.argv[2];

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version)) {
  fail("manifest.json version must use Obsidian's major.minor.patch format (for example, 5.0.0).");
}
if (pkg.version !== manifest.version) {
  fail("package.json and manifest.json versions must match.");
}
if (versions[manifest.version] !== manifest.minAppVersion) {
  fail("versions.json must map the current version to manifest.json minAppVersion.");
}
if (!/^[a-z]+(?:-[a-z]+)*$/.test(manifest.id) || manifest.id.includes("obsidian") || manifest.id.endsWith("plugin")) {
  fail("manifest.json id must contain only lowercase letters and hyphens, must not contain 'obsidian', and must not end with 'plugin'.");
}
if (tag !== undefined && tag !== manifest.version) {
  fail(`Release tag must be exactly ${manifest.version}, without a v prefix; received ${tag}.`);
}

console.log(`Version ${manifest.version} verified (Obsidian >= ${manifest.minAppVersion}).`);
