# 梅勒斯地图 · ChatGPT App（Codex 模式）

[English](README.md) | 简体中文

在当前桌面对话旁边展示实时分层计划。本版用于 **ChatGPT 桌面 App 的 Codex
模式**（也称 Codex App），使用本机文件、Node.js MCP 服务和右侧浏览器中的 mmap 终端。
普通网页聊天不是本发行包的安装目标。

## 一次安装

先装好 Node.js 18+，以及支持 `codex plugin add` 的 Codex CLI（实测版本
0.153.4）；确保终端能找到 `node` 和 `codex`。在克隆或解压后的目录运行：

```sh
node install.mjs
```

不需要 `npm install`、构建、Python 或手改 JSON/TOML。安装器会检查文件校验值和
真实 MCP 连接，将运行文件复制到 `~/.mellos/installations/chatgpt-app/`，注册专用
插件市场、安装技能并注册六个工具。其他插件、项目地图和既有使用偏好均保留。
完成后可移动或删除克隆目录。缺少前置软件时会明确报错。

安装后在 Codex 模式开启**新对话**，直接说：

> 用梅勒斯地图制定当前任务的分层计划，用 web-terminal 自动在当前对话右侧展示，持续更新实现与验证进度。

## 在右侧展示

AI 声明计划、启动本地服务并把 URL 打开到当前对话右侧浏览器。
页面直接运行原有 mmap 终端，不需要粘贴命令，也不使用 Computer Use。
地图会随工具更新自动刷新。浏览器资源和运行程序均已打包，不需要本机编译。

| 操作 | 效果 |
| --- | --- |
| 滚轮、`+`、`-` | 从总览缩放到模块细节 |
| 按住左键拖动 | 平移地图 |
| 单击节点 | 固定详情和依赖高亮 |
| 双击带子图的节点 | 进入子图 |
| `0` | 重置视图 |
| `q` | 退出地图 |

网页右上角可单独调整字号，不影响 App 全局终端字体。点击「图形地图」可切换
到同一张图的 SVG 网页。原生终端和 Markdown/SVG 文件展示继续保留；仅当
主动选择原生终端且宿主没有输入接口时，才可能需要粘贴一次命令。
详见[桌面使用说明](plugins/mellos-mapping/docs/codex.md)。

## 更新、检查与移除

下载新版后再次运行 `node install.mjs`。开启新对话，让 AI 停止旧本地网页
服务后重新打开地图，以加载新运行程序。`node install.mjs --check` 只检查文件、前置软件和 MCP，
不修改宿主配置。

升级会先完整复制并校验新版，再切换安装目录；升级验收失败则恢复旧文件并重新
检查宿主注册。安装器会核对 Codex 报告的插件路径及 MCP 运行文件。内容发生
变化必须提升发行版本号。

```sh
codex plugin remove mellos-mapping@mellos-mapping-codex
codex mcp remove mellos-mapping
codex plugin marketplace remove mellos-mapping-codex
```

这些命令不删除项目地图和使用偏好。如果之前通过个人市场安装过旧版，请先用
Codex 移除旧的 Mellos 插件，避免出现两份技能。

## 分支

`main` 维护共用源码及两个适配器；`claude` 提供 Claude Code 成品；`chatgpt-app`
提供本桌面成品。两个宿主版本由同一版本的源码生成。上传 GitHub 与提交到
OpenAI 公共插件目录是不同的发布流程。
