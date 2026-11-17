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

点击设置中的**测试连接**，插件会上传一张极小 PNG，并验证公开访问地址返回的内容是否一致。上传和公开访问分别显示结果；读取权限或 CDN 生效延迟可能导致上传成功但访问失败。每次测试会在当前前缀下保留一个小对象，并显示 Key 供手动清理，不要求列举或删除权限。

## 使用

- **粘贴图片**：支持截图和多张图片，逐张显示上传占位符。对于同时提供文本和图片的应用，可调整相应剪贴板选项。
- **拖拽图片**：直接读取文件内容，不依赖桌面绝对路径。按住 Ctrl 保留 Obsidian 默认行为；混合图片与其他文件时也保留默认行为。
- **一键上传**：点击文章右上角“更多选项 → 上传本文图片”，或执行命令 `Upload all images`，上传该笔记引用的图片，不会扫描上传整个库。支持 Markdown 和 Wiki 嵌入格式；菜单操作绑定原文章，切换标签页不会上传其他文章。
- **上传进度**：每个操作使用一条持续更新的通知，显示已完成文件数、成功和失败数量，结束后显示汇总。同一文件的重复引用只算一个文件任务，批量结果按引用计数；不显示字节百分比。手动关闭通知不会取消上传。
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

“上传后移除源文件”默认关闭，从旧版本迁移时也会关闭。开启后在链接替换成功后，最多等待 3 秒获取与更新后内容匹配的元数据，再检查其他 Markdown 笔记及打开编辑器中的普通链接和嵌入引用，并确认源图片内容仍与上传内容一致后移入 Obsidian 回收站。元数据缺失、内容尚未保存或不一致、源文件已变化时保留原文件。结果区分已回收、仍被引用、无法确认安全和回收失败；回收失败不影响上传成功。仅上传并复制链接时不删除源文件，外部粘贴/拖拽文件也不会被删除。Canvas 等非 Markdown 消费者不在检查范围内，共用这些附件时请保持关闭。

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

## 发布插件

使用 Node.js 24 和 `package.json` 中锁定的 pnpm 版本。推送分支或提交 PR 后，**Check plugin** 工作流会执行测试、版本检查、类型检查和构建，并保留插件构建产物供下载。

1. 将 `package.json` 和 `manifest.json` 的版本号统一为 `主版本.次版本.修订版本`（当前为 `5.0.0`），在 `versions.json` 中添加对应的最低 Obsidian 版本，并更新 `CHANGELOG.md`。
2. 执行 `pnpm run test` 和 `pnpm run build`，提交并推送修改。
3. 创建并推送与版本号完全一致的标签，**不要添加 `v` 前缀**：

   ```sh
   git tag 5.0.0
   git push origin 5.0.0
   ```

4. **Release plugin** 工作流会创建 GitHub Release **草稿**，附带 `main.js`、`manifest.json`、可选的 `styles.css` 和 `obsidian-image-auto-upload-plugin-5.0.0.zip`。在 GitHub Releases 检查说明后，点击 **Publish release** 正式发布。

也可以进入 **Actions → Release plugin → Run workflow**，填写已存在的版本标签手动运行。工作流会检出该标签并验证版本一致性；重复执行可以更新草稿附件，已发布版本的附件禁止覆盖。发布权限使用仓库自带的 `GITHUB_TOKEN`，无需配置个人 Token 或额外 Secret，但需要在仓库中启用 GitHub Actions。

手动安装时，将 Release 的 `main.js` 和 `manifest.json` 下载到插件目录，或将 ZIP 解压到 `.obsidian/plugins/`。插件目录名保持为 `obsidian-image-auto-upload-plugin`。
