# 梅勒斯地图 · Claude Code

[English](README.md) | 简体中文

在 Claude 计划与开发时展示实时分层依赖图：设计中的模块显示为虚线，正在开发的
模块显示动态标记，完成验证的模块带证据变为绿色。

## 一次安装

先装好 Node.js 18+ 和 Claude Code，并确保命令在 PATH 中。在克隆或解压目录运行：

```sh
node install.mjs
```

无需 npm 依赖或构建。安装器检查文件校验值和六个工具的真实 MCP 连接，将成品
保留在 `~/.mellos/installations/claude/`，通过 Claude 插件命令完成安装。
开启新 Claude Code 对话，输入 `/mellos-mapping:mmap` 或要求展示分层计划。
首次使用时选择何时自动开图。

Windows Terminal 和 Linux/macOS 上已连接的 tmux 会话支持在 Claude 终端旁
自动分屏；显式打开会复用并显示已有 tmux 地图。其他终端中，在交互式分屏或
终端运行随包提供的 `dist/watch.mjs`，传入 `--file <项目>/.mellos/map.json`
和 `--page <页面名>`。本版包含 Claude 专用技能、斜杠命令和 SessionStart 钩子，
不会安装 ChatGPT App 技能或修改 Codex 配置。

## 操作与更新

滚轮、`+`、`-` 缩放，拖动平移，单击固定节点详情，双击进入子图，`0` 重置，
`q` 退出。地图随工具写入自动刷新。宿主支持显示文件或网页时，也可以通过
`mmap_open` 使用 Markdown/SVG 或交互网页。

新版下载后再次运行 `node install.mjs`，然后开启新对话、重启已有地图进程。
`node install.mjs --check` 只检查发行包与前置软件，不改宿主配置。

升级会先完整复制并校验新版，再切换安装目录；升级验收失败则恢复旧文件并重新
检查宿主注册。安装器还会核对 Claude 实际缓存的运行文件。内容发生变化必须
提升版本号，避免版本号相同却仍在运行旧缓存。

如果已有名为 `mellos-mapping` 的市场指向其他位置，安装器会停止。可继续通过
原市场更新，或先在 Claude 插件管理中移除该市场，再切换为本克隆版。

卸载：`claude plugin uninstall mellos-mapping@mellos-mapping`。
项目地图与使用偏好均保留。

`main` 维护共用源码；`claude` 是本成品；`chatgpt-app` 用于 ChatGPT 桌面 App
的 Codex 模式。修改统一维护在 `main`，再生成两个宿主版本。
