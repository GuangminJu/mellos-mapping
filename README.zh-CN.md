# 梅勒斯地图 · ChatGPT App（Codex 模式）

[English](README.md) | 简体中文

在当前桌面对话旁边展示实时分层计划。本版用于 **ChatGPT 桌面 App 的 Codex
模式**（也称 Codex App），使用本机文件、Node.js MCP 服务和右侧终端。
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

> 用梅勒斯地图制定当前任务的分层计划，并在当前对话右侧终端展示，持续更新实现与验证进度。

## 在右侧展示

AI 声明计划并请求打开当前对话右侧终端。如果 App 只提供打开和读取终端的工具、
没有输入工具，AI 会给出一行已正确处理路径的命令，你粘贴运行一次即可。
这是宿主接口的限制，不能承诺首次启动完全自动；启动后地图会随工具更新自动刷新。

| 操作 | 效果 |
| --- | --- |
| 滚轮、`+`、`-` | 从总览缩放到模块细节 |
| 按住左键拖动 | 平移地图 |
| 单击节点 | 固定详情和依赖高亮 |
| 双击带子图的节点 | 进入子图 |
| `0` | 重置视图 |
| `q` | 退出地图 |

字体跟随 App 的代码/终端设置。悬停只改变高亮颜色；鼠标模式恢复和输出缓冲优化
已经包含在本版。也可以要求右侧打开 **Markdown/SVG 文件**或**交互网页**，
三种展示共用同一份地图。详见[桌面使用说明](plugins/mellos-mapping/docs/codex.md)。

## 更新、检查与移除

下载新版后再次运行 `node install.mjs`。开启新对话，并用 `q` 退出仍在运行的旧
地图，再重新启动。`node install.mjs --check` 只检查文件、前置软件和 MCP，
不修改宿主配置。

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
