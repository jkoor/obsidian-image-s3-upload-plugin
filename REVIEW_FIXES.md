# Obsidian 5.0.2 审查意见处理记录

本次修改对应 5.0.3，最低支持版本仍为 Obsidian 1.7.2。以下按 5.0.2 的审查意见逐项记录处理结果。

| 审查项 | 处理情况 |
| --- | --- |
| 仓库 Issues 被禁用 | 发布前已通过 GitHub API 确认仓库 `has_issues: true`，问题反馈现已启用。 |
| description 缺少结尾标点 | `manifest.json` 已补句号；版本检查脚本加入校验。 |
| authorUrl 指向插件仓库 | 已改为作者主页 `https://github.com/jkoor`。 |
| 缺少 artifact attestations | 发布工作流加入 `actions/attest-build-provenance`，并配置 `id-token`、`attestations` 权限；实际证明需运行 GitHub Actions 才会生成。 |
| Release 中包含不支持的 ZIP | 工作流移除 ZIP 打包和上传，仅发布 `main.js`、`manifest.json`、`styles.css`。 |
| Vault Enumeration | 保留源文件删除前必需的引用检查；仅在用户开启默认关闭的删除选项后触发。中英文 README 已说明范围。 |
| Clipboard Access | 保留编辑器粘贴事件读取、文件菜单上传后复制 URL；不使用后台剪贴板读取。中英文 README 已说明范围。 |
| 手动创建设置标题 | 已改用 `Setting.setName().setHeading()`；新版使用设置定义的 group heading。 |
| 直接设置样式 | 已移至 `styles.css` 的专用 CSS 类。 |
| 非 window 定时器 | `cleanup.ts`、`progress.ts`、`uploader/s3.ts` 均使用 `window.setTimeout/clearTimeout`，并修正计时器类型。 |
| 多余正则转义 | 已清理 `helper.ts`、`main.ts`、`utils.ts` 中对应转义，保留解析行为并通过现有引用解析测试。 |
| 不安全返回值 | frontmatter 返回值显式为 `unknown`；图片 MIME 表显式包含不存在键的情况。 |
| 不安全赋值、参数、成员访问 | `loadData()` 结果按 `unknown` 校验；设置迁移只复制已知字段和正确类型；并发结果数组使用泛型构造。 |
| 设置无法被 1.13+ 搜索 | 实现 `getSettingDefinitions()`，所有控制项通过共享定义提供；保留 1.7.2 的 `display()` 路径，避免提高最低版本。 |
| 使用 globalThis | 运行时代码改用 `window.crypto` 检查。Node 测试通过适配层提供 window。 |
| 构建与发布 main.js 不一致 | 继续使用冻结锁文件安装，固定 Node/pnpm，移除内嵌 source map，并在 CI 和发布前比较重复构建结果；正式附件直接来自该次 CI 构建。是否消除服务端警告需新 release 扫描确认。 |

新增 `pnpm run lint` 使用官方 Obsidian 推荐 ESLint 规则，并将警告视为失败。现有传输、引用替换、清理安全性测试继续运行，新增设置定义和异常配置恢复测试。

## 本地验证结果

使用 Node.js 24.12.0、pnpm 9.12.3 完成：

- `pnpm install --frozen-lockfile`：通过，锁文件一致。
- `pnpm run lint`：零错误、零警告。
- `pnpm run test`：7 个测试文件、81 个测试全部通过。
- `pnpm run build`：版本校验、两组 TypeScript 检查及 Rollup 构建通过。
- `pnpm run check:build`：重复构建逐字一致，运行时外部依赖仅为 `obsidian`。

## 送审前剩余操作

1. 在真实 Obsidian 1.7.2 和 1.13+ 中按 `TESTING.md` 验证设置页、搜索和连接测试；桌面弹出窗口及移动端交互仍需真实环境验证。
2. 可使用 **Review branch** 扫描，或在 5.0.3 发布后检查自动审查结果。

正式附件和来源证明由 `5.0.3` 标签触发的 GitHub Actions 生成；发布状态以 [GitHub Release](https://github.com/jkoor/obsidian-image-s3-upload-plugin/releases/tag/5.0.3) 和对应工作流结果为准。
