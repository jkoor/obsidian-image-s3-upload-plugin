[中文文档](readme-zh.md)

# Obsidian Image Auto Upload — S3

Upload images directly to AWS S3 or S3-compatible object storage. No PicGo, desktop helper, or upload server is required. Requires Obsidian **1.7.2 or later**.

## Setup

Install this plugin's `main.js` and `manifest.json` in `.obsidian/plugins/obsidian-image-auto-upload-plugin/`, enable it, and open its settings.

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

## Features

- Paste screenshots or multiple image files to upload and insert Markdown links. Enable the mixed text/image clipboard option for applications that provide both representations.
- Drag image files into the editor. Hold Ctrl to retain Obsidian's normal drop behavior. Mixed image/non-image drops use Obsidian's normal behavior.
- Run **Upload all images** to process image references in the **current note**, including Markdown and Wiki embeds. It does not upload the entire vault.
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

**Delete source file after upload** is off by default and reset to off when migrating from PicGo. When enabled, deletion uses Obsidian's trash only after link replacement and reference checks. Incomplete or stale metadata preserves the original. Non-Markdown consumers such as Canvas are not covered by these checks; keep deletion off when sharing attachments with them.

## Mobile support

The runtime uses Obsidian Vault/request APIs, File/Blob and Web Crypto; it does not require Node, Electron or absolute file paths. Paste/drop uploads work when the OS exposes image files to Obsidian. Otherwise save the image as a local attachment and run Upload all images. On mobile, use an endpoint reachable by the phone; `localhost` refers to the phone itself. Device clock errors can cause signature failures.

Android/iOS behavior still requires device testing. See [TESTING.md](TESTING.md) for acceptance steps and verification limits.

## Migration and development

The plugin ID, command IDs, and frontmatter key are unchanged. General preferences are retained; old PicGo settings and remote-delete records are removed during migration. Existing note links are not rewritten. Remote object deletion is not part of this version.

```sh
pnpm install --frozen-lockfile
pnpm run test
pnpm run typecheck
pnpm run build
```

Build output: `main.js` and the source `manifest.json`. Restart Obsidian after replacing plugin files. Never commit a vault's `data.json` or real test credentials.
