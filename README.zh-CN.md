# Mellos Mapping · 梅勒斯地图

[![CI](https://github.com/GuangminJu/mellos-mapping/actions/workflows/ci.yml/badge.svg)](https://github.com/GuangminJu/mellos-mapping/actions/workflows/ci.yml)

[English](README.md) | 简体中文

给 [Claude Code](https://claude.com/claude-code) 与 Codex CLI 的自下而上
开发实况地图，原生运行在终端里。

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="docs/demo-light.svg">
    <img alt="一张梅勒斯地图的自我构建：幽灵设计先行，spinner 逐层攀升，地基开裂向上传染，诚实修复" src="docs/demo.svg" width="620">
  </picture>
</p>

Claude 为你构建系统时，对话旁边的分屏实时显示这个系统的**分层依赖地图**：
最底层是原语，依赖边只允许向下指；虚线幽灵节点是已设计未实现的部分，
转圈的是此刻正在构建的模块，实心绿色代表已构建**且已验证**。

```
  梅勒斯地图 · mellos-mapping 插件

━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 编排层

  ╭╌╌╌╌╌╌╌╌╌╌╌╌╌╌╮
  ╎ · MCP Server ╎
  ╰╌╌╌┬┬╌╌╌╌┬╌╌╌╌╯
      ││    │
      └┼────┼───────────┐
       │    └───┐       │
       │        │       │
━━━━━━━┿━━━━━━━━┿━━━━━━━┿━━━ 契约层
       │        │       │
  ┏━━━━┷━━━━━━━┓│ ╭╌╌╌╌╌┴╌╌╌╌╌╮
  ┃ ■ 状态存储 ┃│ ╎ · Watcher ╎
  ┗━━━━━┯━━━━━━┛│ ╰╌╌╌╌╌╌┬╌╌╌╌╯
        │       │        │
        │ ┌─────┘        │
        │ │              │
━━━━━━━━┿━┿━━━━━━━━━━━━━━┿━━ 原语层
        │ │              │
  ┏━━━━━┷━┷━━━━━━┓  ╭────┴────────╮
  ┃ ■ 图领域模型 ┃  │ ⠋ ASCII渲染 │
  ┗━━━━━━━━━━━━━━┛  ╰─────────────╯

  · planned   ⠋ in-progress   ■ done   ✗ regressed
```

在真实终端里，连线和层级横条以暗色渲染，节点盒子按状态发光、标签加粗——
像一块黑色电路板，元件是亮的。跨层的边会从中间层的盒子缝隙里穿过去
（看上图 状态存储 和 Watcher 之间下潜的那根线）；互不重叠的走线段共享
轨道行，让层与层贴得更近。

*（这就是本插件自己的地图，开发中途的样子。转圈的 spinner 是真的在转。）*

## 为什么

大多数进度汇报是一张任务清单——那是自上而下的世界观。梅勒斯地图反过来生长：
上层节点只能站在下层节点之上，这张图让纪律变得可见：

- **代码写出来之前，幽灵设计先出现。** Claude 先把完整的设计声明成虚线
  幽灵节点；你可以在它还只是一张图的时候就否掉一个坏设计。
- **spinner 在哪，Claude 的注意力就在哪。** 一眼回答"它现在在做什么、
  站在什么之上？"
- **done 意味着已验证。** 节点只有带着证据（一次通过的测试）才会变成
  实心绿色。如果后续工作弄裂了地基，那个节点会变红——转圈的上层楼板
  下面压着一块红色地基，是最诚实的状态汇报。
- **地图是账本，不是法官。** 工具只拒绝结构性破坏（向上指的边、重复的
  rank）。工作流是 Claude 的纪律，写在随插件捆绑的 skill 里；违反纪律
  会被*看见*，而不是被悄悄拦截。

## 安装

在 Claude Code 对话里输入两行：

```
/plugin marketplace add GuangminJu/mellos-mapping
/plugin install mellos-mapping@mellos-mapping
```

或者在终端里一条命令装完：

```
claude plugin marketplace add GuangminJu/mellos-mapping && claude plugin install mellos-mapping@mellos-mapping
```

需要 PATH 上有 Node.js 18+（Claude Code 本身就依赖 Node，所以你已经有了）。
没有构建步骤：MCP 服务器和 watcher 都已预打包在 `dist/` 里，克隆即用。

## 更新

```
claude plugin marketplace update mellos-mapping && claude plugin update mellos-mapping@mellos-mapping
```

要两步是因为 `plugin update` 只对比本地缓存的 marketplace 克隆——真正
拉取本仓库的是第一条命令。重启 Claude Code 生效。发布即 `master` 分支
上的版本号提升。（在对话里输入 `/plugin` 也能打开同一个管理界面。）

## Codex CLI

同一个仓库也是 Codex 插件（codex-cli 0.147+）。三行装完：

```
codex plugin marketplace add GuangminJu/mellos-mapping
codex plugin add mellos-mapping@mellos-mapping
node ~/.codex/plugins/cache/mellos-mapping/mellos-mapping/<版本>/scripts/codex-register.mjs
```

前两行把技能（地图纪律）装成 Codex 插件。第三行在用户级注册 MCP
服务器——必须这么做，因为 Codex 把插件自带的 MCP 服务器拉起在插件缓存里，
且不给它任何感知工作区的途径，捆绑的服务器会把地图写进缓存。脚本写入的
用户级 `codex mcp add` 条目会继承每个会话的工作目录：状态文件落在你的
项目里，与 Claude Code 下行为一致。注册的是版本相关的绝对路径——插件
更新后重跑一次脚本即可。

要在 Codex 会话旁边看实况面板，Windows 上运行
`node <插件根>/scripts/open-pane.mjs <项目目录>`——它会在承载本会话的
终端窗口里分屏（识别不到就确定性地开到专属的 "mellos-mapping" 窗口；
`--window` 则是主动选择专属窗口）。加 `--page <slug>` 指定打开哪一页；
面板已经开着时，带 `--page` 重跑一次不会再开新面板，而是让现有面板
切到那一页。面板默认**自动跟随**正在被写入的页——AI 此刻操作哪张图，
就看哪张图；按 `f` 开关（手动切页也会关掉），或用 `--no-follow` 启动。
其他环境在项目目录下的第二个终端（或任意分屏）运行
`node <插件根>/dist/watch.mjs`（同样支持 `--page` / `--no-follow`）。

## 任意 MCP 客户端

服务器已发布到 npm，任何 MCP 客户端（Cursor、Windsurf、Zed、Gemini
CLI……）都能用标准 stdio 条目接入：

```
npx -y mellos-mapping
```

地图文件落在客户端会话的工作目录（`.claude/mellos-mapping.json`）。在同
一项目里打开实况面板：

```
npx -y -p mellos-mapping mellos-mapping-watch
```

技能/纪律层是 Claude Code 与 Codex 专属的；其他客户端获得四个 `mmap_*`
工具和面板，提示词自备。

## 使用

1. 让 Claude 构建一个非平凡的东西。捆绑的 skill 会让 Claude 先声明幽灵
   设计，并在工作过程中保持地图与现实一致。
2. 运行 `/mellos-mapping:mmap` 打开实况分屏（Windows 上是 Windows
   Terminal 分屏，tmux 里是 tmux 分屏，其他环境会打印一条命令让你在
   第二个终端里运行）。Windows 上即使开着多个终端窗口，分屏也会落在
   **你的会话所在的窗口**；想让地图独占一个窗口就加 `--window`。字体
   缺少制表符字形时用 `--ascii`。
3. 看着节点从底部一路亮起。图让你不安的时候就打断它——这正是它存在的
   意义。

分屏支持鼠标（xterm SGR any-event 协议——htop 和 tmux 说的同一种话）：

| 输入 | 动作 |
| --- | --- |
| 悬停节点 | 高亮它的关系线；在地图下方预览节点详情 |
| 点击节点 | 钉住——鼠标移开后详情仍然常驻 |
| 点击空白 / `Esc` | 取消钉住；无钉住时 `Esc` 从下潜返回 |
| 滚轮 / `+` `-` | 缩放，以焦点节点为锚（阶梯见下） |
| 按住左键拖动 | 地图超出面板时抓取平移 |
| shift+滚轮 | 垂直滚动 |
| `hjkl` / 方向键 | 微移视口 |
| `Tab` / `Shift+Tab` / `1-9` / 点击标签 | 切换页（并行的多张地图） |
| 双击带 `⊞` 的节点 | 下潜进它的子图（一个子页面） |
| `Backspace` / `Esc` | 从上一次下潜爬回父图 |
| 拖动 `⋯` 分隔线 | 调整详情面板高度——向上拉，完整阅读长设计笔记 |
| `0` | 重置平移和缩放 |
| `q` | 退出面板 |

缩放先做几何缩小，只在阶梯两端才切换显示模式——每一级都能看到有意义的
数据：

```
细读 ← 100% ← 85% ← 70% ← 55% ← 概览
```

- **放大过 100%**——验证证据和设计笔记直接在盒子里展开；
- **85–55%**——留白收紧、标签按比例截断，盒子还是盒子；
- **低于 55%**——标签已短到无意义，此时地图**聚合**：每个已声明的分组
  （层内的具名子系统）变成一个盒子，如 `地基子系统 1/2`，状态由成员推导，
  边收拢到分组上，未分组节点保持原样。就像真地图缩小后显示省名，而不是
  把城市变成无名光点。（没有声明分组的地图退化为纯字形星座 + 每层计数。）
  页脚始终显示当前级别。

详情面板固定在地图和提示行之间，显示焦点节点的状态、所在层、验证证据、
两个方向的连线（`uses → … · used by ← …`）以及设计笔记——任何东西都
不会悬浮遮挡地图。

`--no-mouse` 关闭鼠标上报，把鼠标留给你的终端复用器。

### 页

一个项目可以并排保有多张地图——**一个工作努力 = 一页**。Claude 在任何
`mmap_*` 工具里传 `page` 参数即可定向到某页；出现第二页时面板顶部自动长出
标签栏。当前页加粗、按整图状态着色；后台页的文件有变化时，它的标签会亮起
状态色提示你，而不是抢走你的视线。每页记住自己的平移/缩放/钉住状态。因为
每页就是一个独立文件，两个 Claude 会话各写各页永远不会互相覆盖——这也是
同一项目里跑多个 Claude 会话的正确姿势。

地图状态存在 `.claude/mellos-mapping.json`（默认页）和
`.claude/mellos-mapping.pages/<页名>.json`（命名页）——纯 JSON，想在 git
里留下地图的历史就把它们提交进去。

### 图种

缺省图种 `dev` 就是上文那本活的进度账本。同一套分层 DAG 机器也能画文档型
图：在 `mmap_declare` 里传 `kind`，该页即以中性方式渲染——素色实线盒子，
没有幽灵、没有 spinner、不数进度。

| 图种 | 读法 | 专属能力 |
| --- | --- | --- |
| `architecture` | 分层组件（也适合模块依赖、调用图） | 边标签标协议 |
| `dataflow` | 管线阶段即层，源头在最底 | 边标签标数据 |
| `behavior-tree` | 叶子（动作）在最底，根在顶（也适合思维导图、WBS） | 节点 kind `selector` `sequence` `parallel` `decorator` `condition` `action` 渲染为字形 |
| `sequence` | 经典的调用/返回时序：时间自上而下流，参与者是顶部泳道表头；每次进入和每次返回都是"当事参与者泳道里"的一个事件 | `lanes` 即参与者泳道；边标签即消息 |

节点 kind 和边标签在 `dev` 图上同样可用。状态机是有意不支持的：状态迁移
成环，而这里的边只许向下。

### 子图

节点可以用 `submap: <页名>` 链接一个子页面——面板给它戴上 `⊞` 徽标；双击
下潜进子图，`Backspace` 爬回父图。图中图，完全由页组合而成：没有新存储、
没有新不变量。一个节点值不值得配子图，由 AI 自行判断——大多数不需要。

子图是节点的内部细节，不是兄弟页：被引用为子图的页**不占标签栏**。下潜
之后标签行变成面包屑——`⌫ 父图 ▸ 节点`——点击它（或按 `Backspace`）爬
回去。隐藏的子图在后台有变化时，底栏会提示。

## MCP 工具

| 工具 | 用途 |
| --- | --- |
| `mmap_declare` | 生长地图：标题、图种、层级横条、泳道、分组（子系统）、节点、边（可带标签；批量，全有或全无） |
| `mmap_update` | 记录进度：`planned → in-progress → done`（附证据）、`regressed`、分组/泳道归属、节点 kind |
| `mmap_remove` | 修订：删除边、节点、分组、泳道、空层 |
| `mmap_view` | 把当前地图渲染成文本，直接在对话里看（可选 `zoom` 参数） |
| `mmap_setup` | 查/设本项目的建图策略——什么时候开地图 |

### Setup：选择什么时候建图

每个项目选一次建图的积极程度，用 `/mmap setup`（或 AI 第一次 declare 时，
工具响应会引导它来问你）：

- `always` —— 任何有结构的任务都建图：流程、设计、架构、技术依赖。
- `complex` —— 只在中等或复杂任务时建图（未配置时的默认行为）。
- `on-request` —— 只在你明确要求时建图。

选择保存在 `.claude/mellos-mapping.config.json`，用于引导 AI；它从不阻止
工具本身——无论什么策略，明确要求建图永远有效。

工具强制的结构不变量：层按 rank 构成全序；每个节点恰好属于一层；边**严格
向下**——因此图从构造上就是无环的；节点不能依赖同层兄弟（如果 A 需要
兄弟 B，要么 B 其实是更低层的概念，要么 A 和 B 本来就是一个节点）。

## 开发

```
npm install
npm run verify   # 类型检查 + 测试 + 打包
```

这个仓库本身就是自下而上分层的，每一层都有自己的规格测试：

| 层 | 代码 | 职责 |
| --- | --- | --- |
| 0 domain | `src/domain/` | 地图值、结构不变量、纯操作 |
| 1 format | `src/store/format.ts` | 状态文件格式：重放校验的解析与序列化，零 I/O |
| 1 store | `src/store/store.ts` | Node 上的原子化状态文件持久化 |
| 1 semantics | `src/semantics/` | 媒介无关的视图语义：缩放阶梯、分组聚合、时序翻转 |
| 2 apply | `src/server/apply.ts` | 工具输入 → 事务性操作序列 |
| 3 server | `src/server/server.ts` | stdio 上的四个 MCP 工具 |
| 4 render | `src/render/`、`src/watch/` | ASCII 渲染器和轮询面板 |

`dist/` 是刻意提交的：插件安装就是克隆本仓库、不运行任何东西，所以入口
文件以打包形式随仓库分发。

### 库

底部各层同时是一个库（`npm run build` 产出带类型声明的 `lib/`，npm 打包
收录）。子路径导出与源码结构一一对应：`mellos-mapping/domain/types`、
`/domain/ops`、`/format`、`/semantics` 是**浏览器安全**的——import 闭包中
没有任何 Node 内建模块，由测试门禁守护——图形客户端（web 面板、编辑器
视图）可以直接解析状态文件，并复用与终端面板完全一致的聚合与缩放语义。
`/store`（Node 文件系统持久化）与 `/render`（终端渲染器）补齐 Node 宿主
所需的完整表面。

## 许可证

MIT
