[中文文档](readme-zh.md)

# image-s3-upload

Upload images directly to AWS S3 or S3-compatible object storage. No PicGo, desktop helper, or upload server is required. Requires Obsidian **1.7.2 or later**.

## Setup

Install this plugin's `main.js`, `manifest.json` and `styles.css` in `.obsidian/plugins/image-s-three-upload/`, enable **image-s3-upload**, and open its settings. On Obsidian 1.13 or later, plugin settings also appear in settings search.

| Setting | Example / meaning |
| --- | --- |
| Endpoint | `https://s3.ap-southeast-1.amazonaws.com` — S3 API base, without the bucket |
| Region | `ap-southeast-1`; use the region required by your provider |
| Bucket | Your existing image bucket |
| Access Key ID / Secret Access Key | Credentials allowed to write to that bucket/prefix |
| Session Token | Optional, for temporary credentials; update manually when they expire |
| Public base URL | `https://images.example.com` — a stable URL mapping to the **bucket root**, including any CDN path |
| Object prefix | `obsidian` by default |
| Path-style addressing | Off for `bucket.endpoint/key`; on for `endpoint/bucket/key` |

For MinIO on a local host, use its S3 API endpoint, its configured region, and enable path style. Use HTTPS for public services. S3-compatible services differ; verify your provider with a test image.

Objects are stored as `obsidian/YYYY/MM/<random-id>.<actual-format>`. A public base URL of `https://images.example.com` produces links such as `https://images.example.com/obsidian/2026/11/<id>.png`. Include the bucket in the public base URL if your serving endpoint requires it.

Uploading **does not make an object publicly readable**. Configure a read policy for the image prefix or a CDN that can access your bucket. A private object URL returns 403. Expiring presigned GET URLs are not used as permanent image links; object ACLs are not set.

Credentials are stored **unencrypted** in the plugin's `data.json` and may be included in vault synchronization or backups. Use a dedicated credential limited to `s3:PutObject` on your image prefix. Remote deletion/listing is not required. Some encryption configurations, such as SSE-KMS, need additional permissions. Password fields only hide the value on screen.

Click **Test connection** in settings to upload a tiny PNG and check that the public URL returns the same bytes. Upload and public-access results are reported separately: CDN propagation or read-policy failures do not mean the upload failed. Each test retains a small object under the configured prefix and displays its key for manual cleanup. It does not require list or delete permission.

## Features

- Paste screenshots or multiple image files to upload and insert Markdown links. Enable the mixed text/image clipboard option for applications that provide both representations.
- Drag image files into the editor. Hold Ctrl to retain Obsidian's normal drop behavior. Mixed image/non-image drops use Obsidian's normal behavior.
- Open the note's top-right **More options → Upload images in this note**, or run **Upload all images**, to process image references in that note, including Markdown and Wiki embeds. It does not upload the entire vault. The menu action stays bound to its original note if you switch tabs.
- Uploads show one updating notice per operation, with completed files, successes and failures, followed by a summary. Duplicate references count as one file task; batch summaries count references. Progress reports file counts rather than byte percentages. Dismissing a notice does not cancel the upload.
- Enable **Work on network** to transfer HTTP(S) images when pasting Markdown image links or running Upload all images. This is off by default. Excluded domains and their subdomains are skipped; your configured public image URL path is also skipped.
- Repeated references to the same source upload once per batch. Failures keep the original note references. Code examples, inline code, comments and frontmatter are excluded.
- Right-click an image file to upload references in the current note; if there are none, upload and copy its URL. If clipboard access is unavailable, the URL is displayed instead.
- **Download all images** saves network images to the attachment location configured in Obsidian, then replaces their references after successful writes.
- Image descriptions and Wiki size suffixes are preserved according to settings.

Disable automatic paste/drop upload for an individual note:

```yaml
---
image-auto-upload: false
---
```

If S3 is not configured, ordinary paste/drop remains available. Each pasted image gets its own upload placeholder. On failure, paste the original image again to retry. Successful uploads may remain in the bucket if their note reference was removed before completion.

**Delete source file after upload** is off by default and reset to off when migrating from PicGo. When enabled, deletion uses Obsidian's trash only after link replacement and reference checks. The plugin waits up to three seconds for matching note metadata, checks other Markdown notes and open editors for ordinary links and embeds, and verifies that the local image still matches the uploaded bytes. Missing metadata, unsaved/conflicting content or changed source files preserve the original. The summary distinguishes trashed files, remaining references, unverified safety and cleanup failures. Uploading a file only to copy its URL does not delete it; external paste/drop files are never deleted. Non-Markdown consumers such as Canvas are not covered by these checks; keep deletion off when sharing attachments with them.

## Data access

Clipboard image/text data is read only from paste events in an eligible Markdown editor. The plugin does not poll or read the system clipboard in the background. A user-triggered image file upload can write the uploaded URL to the clipboard when no image references are being replaced in the current note.

Vault-wide Markdown enumeration and reads occur only during source cleanup when **Delete source file after upload** is enabled. They check for remaining references before moving an attachment to the trash. This option is off by default. Normal note uploads process the selected note and its referenced images. Image data is sent to your configured S3 endpoint; remote-image transfers and public-access tests also contact the corresponding image URLs.

## Mobile support

The runtime uses Obsidian Vault/request APIs, File/Blob and Web Crypto; it does not require Node, Electron or absolute file paths. Paste/drop uploads work when the OS exposes image files to Obsidian. Otherwise save the image as a local attachment and run Upload all images. On mobile, use an endpoint reachable by the phone; `localhost` refers to the phone itself. Device clock errors can cause signature failures.

Android/iOS behavior still requires device testing. See [TESTING.md](TESTING.md) for acceptance steps and verification limits.

## Migration and development

Starting with 5.0.2, this fork uses the plugin ID `image-s-three-upload`; the display name remains `image-s3-upload`. Obsidian community plugin IDs cannot contain digits. When moving from the original plugin or version 5.0.1 (ID `image-s3-upload`), disable the old plugin and install this version in the new directory. To retain general preferences, copy the original plugin's `data.json` to the new directory before enabling it. Old PicGo settings and remote-delete records are removed when settings are loaded; configure S3 separately. Command IDs and the `image-auto-upload` frontmatter key are retained. Existing note links are not rewritten. Remote object deletion is not part of this version.

```sh
pnpm install --frozen-lockfile
pnpm run lint
pnpm run test
pnpm run typecheck
pnpm run build
pnpm run check:build
```

Plugin files: built `main.js`, source `manifest.json` and `styles.css`. Restart Obsidian after replacing plugin files. Never commit a vault's `data.json` or real test credentials.

## Releasing

Use the exact Node.js version in `.node-version` (24.12.0) and the pnpm version pinned in `package.json`. Pushes and pull requests run the official Obsidian lint rules, tests, version validation, type checks, a build and a repeat-build comparison; the **Check plugin** workflow also stores the plugin files as a build artifact. Production bundles omit embedded source maps to avoid machine-dependent source paths.

1. Set the same `major.minor.patch` version in `package.json` and `manifest.json` (currently `5.0.3`). Add that version and its minimum Obsidian version to `versions.json`, and update `CHANGELOG.md`.
2. Run `pnpm run lint`, `pnpm run test`, `pnpm run build` and `pnpm run check:build`, then commit and push the changes.
3. Create and push a tag matching the version exactly, **without a `v` prefix**:

   ```sh
   git tag 5.0.3
   git push origin 5.0.3
   ```

4. The **Release plugin** workflow publishes a **GitHub Release** after checks pass with only `main.js`, `manifest.json` and `styles.css`. It creates GitHub build-provenance attestations for these files before uploading them. Release notes come from the matching entry in `CHANGELOG.md`.

You can also run **Actions → Release plugin → Run workflow**, entering an existing version tag. Manual runs create a draft by default; select **publish** to publish immediately. The workflow checks out that tag and verifies it against the version files. Reruns can replace assets on a draft; published releases are protected from replacement. The repository's built-in `GITHUB_TOKEN` supplies release permissions; no personal token or additional secret is needed. GitHub Actions must be enabled in the repository.

For manual installation, download `main.js`, `manifest.json` and `styles.css` from the release into the plugin directory. Keep the plugin directory named `image-s-three-upload`.

Enable **Settings → General → Features → Issues** in the GitHub repository before requesting another community review. After publishing 5.0.3, the review service can scan the new release, or you can use **Review branch** first. See [REVIEW_FIXES.md](REVIEW_FIXES.md) for the item-by-item review checklist and checks that still require GitHub or a real Obsidian session.
