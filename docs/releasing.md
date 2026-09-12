# 发布与分支维护

本仓库提供 `main`、`claude`、`chatgpt-app` 三个分支。`chatgpt-app` 指 ChatGPT
桌面 App 的 **Codex 模式**；普通网页聊天不是这个本地运行时的安装目标。

| 分支 | 内容 | 克隆后的入口 |
| --- | --- | --- |
| `main` | 共用源码、测试、两个宿主适配器、预构建运行文件 | `node install.mjs claude` 或 `node install.mjs chatgpt-app` |
| `claude` | Claude 技能、命令、钩子、MCP 与运行文件 | `node install.mjs` |
| `chatgpt-app` | 桌面专用技能、专用市场、MCP 注册器与运行文件 | `node install.mjs` |

安装前需要 Node.js 18+、对应宿主 CLI，以及该宿主正常工作的账户/环境。
无需依赖开发机路径、Python 技能脚本、npm 安装或本地构建。安装器检查文件校验值
和真实 MCP 握手，再将运行时保留到用户目录并注册插件。安装后开启新对话。
桌面宿主没有终端输入工具时，首次开图仍需粘贴 AI 给出的启动命令一次。

## 生成可发布版本

源码开发使用 Node.js 22.12+（成品运行仍为 Node.js 18+）。在主源码的开发分支
修改和验证，避免直接编辑生成的宿主分支。

```sh
npm ci
npm run verify
node scripts/check-host-install.mjs chatgpt-app
node scripts/check-host-install.mjs claude
```

最后两条需本机已安装对应 CLI。它们使用临时用户目录和独立宿主配置，检查首次
安装、重复安装、移除克隆后运行；不会使用真实账户配置，也不会调用模型。
`npm run verify` 检查源码、发行包内容、六工具 MCP、MD/SVG、网页与项目隔离。

正式升版用 `node scripts/release.mjs <版本>`，它同步所有版本字段并运行验证。
`npm run package:release` 从已构建文件生成 `artifacts/release/claude/` 和
`artifacts/release/chatgpt-app/`。每份包含 `release.json` 校验清单和独立安装说明。
Git 发行保留 LF 换行，避免 Windows 克隆改变校验值。

在发布准备分支运行：

```sh
node scripts/prepare-branches.mjs
```

脚本创建三个本地分支、对应 ZIP、Git bundle 与 `branches.json`，不推送远端。
它从当前工作文件生成白名单快照，保留原 Git 历史；不切换当前分支、不动用户索引。
项目 `.mellos` 地图、旧开发市场、临时产物、依赖和本地配置不会进入新快照。
现有非生成分支或已检出的同名分支会被拒绝，防止覆盖其他工作。
已有生成分支的后续发布使用新提交向前推进，不改写历史。

产物在 `artifacts/release/`。主分支 ZIP 包含完整源码，两个宿主 ZIP 是直接安装包。
Git bundle 包含三个分支，可用于另一个目录或机器恢复这些分支。

## 上传 GitHub

先用 `git remote -v` 确认 `origin` 是你准备发布的仓库；如果不是，先设置正确远端。
在当前仓库运行（无需切换工作区）：

```sh
git push origin main claude chatgpt-app
```

然后在 GitHub 仓库 **Settings → Default branch** 将默认分支改为 `main`。
旧 `master` 或其他分支可以先保留；本流程不删除远端分支，也不需要强制推送。
如果远端已有不兼容的同名分支，先比较并合并，不要用强推覆盖。

可将三个 ZIP 作为 GitHub Release 附件。公开安装示例：

```sh
git clone -b chatgpt-app https://github.com/GuangminJu/mellos-mapping.git
cd mellos-mapping
node install.mjs
```

Claude 用户把分支换成 `claude`。如果发布到自己的 fork，替换仓库地址。
GitHub 发布不会自动发布 npm 包、MCP Registry 或 OpenAI 公共插件目录。

## 发布证据与限制

主分支 CI 检查源码和提交的构建文件；两个宿主分支 CI 在 Windows/macOS/Linux
检查无需 npm 依赖的发行文件与 MCP 握手。跨平台 CI 成功前，不能把本地 Windows
验证当作三平台实机通过。自动打开 Windows Terminal 分屏只属于终端客户端；
桌面右侧终端的打开、输入权限与字体由 ChatGPT App 决定。
