# Obsidian 图片 S3 直传插件

直接将图片上传到 AWS S3 或兼容 S3 的对象存储，无需 PicGo、桌面助手或额外上传服务器。要求 **Obsidian 1.7.2 及以上**。

## 配置

将构建的 `main.js` 和 `manifest.json` 放入库内 `.obsidian/plugins/obsidian-image-auto-upload-plugin/`，启用插件并打开设置。

| 配置 | 说明 |
| --- | --- |
| S3 接口地址 | 例如 `https://s3.ap-southeast-1.amazonaws.com`，不含存储桶名称 |
| Region | 存储服务要求的签名区域；AWS 示例为 `ap-southeast-1` |
| Bucket | 已创建的图片存储桶 |
| Access Key ID / Secret Access Key | 仅授予图片目录写入权限的独立凭据 |
| Session Token | 临时凭据可选，过期后需手动更新 |
| 图片访问基础 URL | 对应**存储桶根目录**的稳定访问地址，可包含 CDN 路径 |
| 对象路径前缀 | 默认 `obsidian` |
| 路径寻址 | 关闭为 `bucket.endpoint/key`，开启为 `endpoint/bucket/key`；本地 MinIO 通常需开启 |

例如对象 Key 为 `obsidian/2026/11/<随机ID>.png`，图片访问基础 URL 为 `https://images.example.com`，笔记将写入 `https://images.example.com/obsidian/2026/11/<随机ID>.png`。访问服务要求带桶名时，在访问基础 URL 中包含桶名。

上传成功不代表图片可以公开访问。请配置指定图片目录的读取策略，或通过有权限访问私有源站的 CDN 提供图片。插件不设置公开 ACL，也不会把有有效期的预签名 GET 链接写成永久图片链接。

密钥以**未加密**形式保存在插件的 `data.json` 中，可能随库同步或备份。设置框隐藏显示不等于加密存储。建议使用仅允许指定前缀 `s3:PutObject` 的凭据；无需授予删除或列举权限。SSE-KMS 等加密配置可能需要额外权限。

## 使用

- **粘贴图片**：支持截图和多张图片，逐张显示上传占位符。对于同时提供文本和图片的应用，可调整相应剪贴板选项。
- **拖拽图片**：直接读取文件内容，不依赖桌面绝对路径。按住 Ctrl 保留 Obsidian 默认行为；混合图片与其他文件时也保留默认行为。
- **一键上传**：命令面板执行 `Upload all images`，上传**当前笔记**引用的图片，不会扫描上传整个库。支持 Markdown 和 Wiki 嵌入格式。
- **网络图片转存**：开启“应用网络图片”后，一键上传和粘贴 Markdown 网络图片链接都会下载原图并转存到 S3。默认关闭；域名排除同时匹配该域名和其子域名。自己的图床访问路径自动跳过。
- **去重和失败处理**：同批次相同来源只上传一次；成功项替换链接，失败项保留原引用并提示。代码块、行内代码、注释及 frontmatter 中的示例不处理。
- **右键上传**：图片文件右键上传会更新当前笔记内对应引用；没有引用时上传并复制链接。系统不允许访问剪贴板时显示链接。
- **下载图片**：执行 `Download all images`，按 Obsidian 附件设置保存网络图片，等待写入成功后替换链接。

单篇笔记禁用自动粘贴/拖拽上传：

```yaml
---
image-auto-upload: false
---
```

S3 配置不完整时不拦截普通粘贴/拖拽。粘贴图片失败后，请重新粘贴原图片重试。若在上传期间删除了原引用，插件不会重新插入它，已上传的对象可能留在桶中。

“上传后移除源文件”默认关闭，从旧版本迁移时也会关闭。开启后仅在替换引用、检查其他 Markdown 笔记后移入回收站；元数据不完整或未更新时保留原文件。Canvas 等非 Markdown 消费者不在检查范围内，共用这些附件时请保持关闭。

## 移动端

上传链路使用 Obsidian Vault/网络接口、File/Blob 和 Web Crypto，不使用 Node、Electron 或本地绝对路径。系统能向 Obsidian 提供图片文件时可直接上传；无法提供时，先保存为本地附件，再执行一键上传。

手机必须能够访问配置的 Endpoint，手机上的 `localhost` 指手机自身。设备时间不准确也可能造成签名失败。Android/iOS 真机验收步骤及验证边界见 [TESTING.md](TESTING.md)。

## 迁移与构建

保留插件 ID、原命令 ID 和 frontmatter 字段。保留通用偏好，迁移时移除 PicGo 专用配置和历史删除记录，不改写已有笔记链接。本版本不提供 S3 远程删除。

```sh
pnpm install --frozen-lockfile
pnpm run test
pnpm run typecheck
pnpm run build
```

更新插件文件后重启 Obsidian。不要提交真实凭据或库内 `data.json`。
