# Verification and manual acceptance

## Automated checks

Run `pnpm run lint`, `pnpm run test`, `pnpm run build`, and `pnpm run check:build`. The build includes type checking. ESLint uses the official Obsidian recommended rules and fails on warnings. The repeat-build check compares `main.js` with a fresh Rollup build and rejects runtime dependencies other than `obsidian`.

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

## New feature acceptance

On Obsidian 1.7.2, verify the fallback settings page displays all controls and connection-test status. On 1.13 or later, search for Endpoint, Bucket and source cleanup in settings, open the matching result, change a setting, restart, and confirm persistence. While a connection test is running, change the search or reopen settings; verify the current status and button recover when the test completes.

1. In settings, click **Test connection** with valid configuration. Verify separate upload and public-access success messages and locate the retained tiny PNG using the displayed key. No list or delete permission is needed. Try a wrong public base URL/read policy: upload must still report success while access fails. Try invalid credentials: access must not be tested. Rapid clicks must launch only one test; changing settings during a test must not change that test's configuration.
2. Open a note's top-right **More options → Upload images in this note**, in both reading and editing modes. Verify only that note is processed, including when another tab becomes active. Trigger again during upload and verify the existing-task message. Test desktop and mobile menus.
3. Upload several files, including repeated references and one failure. Verify one updating notice per operation, deduplicated file progress and reference-based final totals. Check notices during slow uploads and retries, tab switches and simultaneous operations on different notes. Dismissing a notice must not cancel the operation; unloading the plugin must remove notices.
4. With deletion enabled and a disposable image referenced only once, upload it and verify the note link is replaced before the unchanged original moves to the configured Obsidian trash. Repeat with a delayed metadata update: a matching update within three seconds should allow cleanup; timeout must preserve the image and explain why.
5. Verify deletion is blocked by ordinary Markdown/Wiki links, embeds in another note, unsaved references in another open editor, incomplete metadata and changed source bytes. Verify failed uploads, failed note writes, removed references and URL-copy-only uploads do not delete the image. Simulate trash failure and verify upload success plus a separate cleanup failure count. Restore disposable files from trash after acceptance.

## Android and iOS — run independently on each available device

1. Install the build, configure an HTTPS endpoint reachable from the phone and a synchronized device clock. No PicGo or other helper should be running.
2. Paste/share an image through available OS mechanisms. If the OS does not expose image File data, insert a local attachment, then run Upload all images.
3. Upload multiple local attachments, transfer a remote image, switch notes during upload and test offline failure.
4. Check that original image formats and dimensions remain, and that image links still render after restarting Obsidian.
5. Test Download all images against the mobile attachment directory. Test clipboard URL copying where supported.

## Verification boundary

Automated transport tests validate request construction, not a provider's policy, TLS/network behavior or a real device's paste integration. AWS/compatible-provider uploads and Android/iOS must be recorded as unverified until the above steps have been run with a real bucket and devices. This repository does not include credentials or a connected Obsidian mobile session.
