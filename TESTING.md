# Verification and manual acceptance

## Automated checks

Run `pnpm run test`, `pnpm run typecheck`, and `pnpm run build`.

Tests use fake credentials and mocked Obsidian transport. The outgoing SigV4 request is independently checked with Node's crypto primitives, including a Unicode/special-character object prefix, payload hash and temporary credentials. Workflow tests cover source deduplication, partial failure, editor changes, binary File input and awaited attachment writes. No test uses real storage credentials.

The final bundle must only require `obsidian`. Inspect with:

```sh
node -e "const fs=require('node:fs');const s=fs.readFileSync('main.js','utf8');console.log([...s.matchAll(/require\(([^)]*)\)/g)].map(m=>m[1]))"
```

## Storage integration — requires a user-provided test bucket

1. Use a disposable prefix, stable public read URL and write-only test credentials. Do not put credentials in test files.
2. Paste a PNG, JPEG, GIF, SVG and WebP. Verify remote bytes, extensions, Content-Type and rendered note links. Use a prefix with Chinese characters, spaces and `+()`.
3. Verify both supported addressing styles with the appropriate provider. Check a custom public URL with a path, not just a root hostname.
4. With network transfer enabled, paste a Markdown image URL with no extension and a query string; verify it downloads and renders from the new URL. A login/HTML response must fail without replacing the original reference.
5. Run Upload all images on a note with repeated references, same-named images in different folders, Wiki dimensions, local and remote images, excluded domains, own-CDN links and code examples.
6. While uploading, type additional text, switch to another note, remove an image reference, and delete a source note in separate runs. Check that unrelated content is preserved and deleted references/notes are not recreated.
7. Revoke write permission, expire a session token, choose an incorrect region, and interrupt the network. Verify errors contain no credentials; failed references remain. Already-uploaded objects may remain after an editor reference is removed.
8. Download remote images to each attachment-location mode. Verify only successfully written files replace note references.
9. Leave source deletion off initially. If testing it, use disposable attachments and verify other Markdown references and unavailable metadata prevent deletion.

## Android and iOS — run independently on each available device

1. Install the build, configure an HTTPS endpoint reachable from the phone and a synchronized device clock. No PicGo or other helper should be running.
2. Paste/share an image through available OS mechanisms. If the OS does not expose image File data, insert a local attachment, then run Upload all images.
3. Upload multiple local attachments, transfer a remote image, switch notes during upload and test offline failure.
4. Check that original image formats and dimensions remain, and that image links still render after restarting Obsidian.
5. Test Download all images against the mobile attachment directory. Test clipboard URL copying where supported.

## Verification boundary

Automated transport tests validate request construction, not a provider's policy, TLS/network behavior or a real device's paste integration. AWS/compatible-provider uploads and Android/iOS must be recorded as unverified until the above steps have been run with a real bucket and devices. This repository does not include credentials or a connected Obsidian mobile session.
