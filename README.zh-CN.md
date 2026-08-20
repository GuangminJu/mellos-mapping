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
没有构建步骤：`dist/` 是提交进仓库的，克隆即用——`dist/server.mjs`（MCP
服务器）、`dist/watch.mjs`（面板）、`dist/mmap.mjs`（`mmap` 开关）、
`dist/hook-session-start.mjs`（由 `hooks/hooks.json` 注册的 `SessionStart`
钩子），以及 `dist/store-paths.mjs`（存储的路径词汇；纯 node 的面板启动
脚本从这里导入，而不是自己抄一份文件名）。

装完之后的第一个会话只会问你**一个**问题——建图要多积极——并把答案记成
你以后打开的每一个项目的默认。此后钩子会自己把它带进每个新会话；再也没有
"每个项目设置一遍"这回事。见
[Setup：选择什么时候建图](#setup选择什么时候建图)。

想在自己的终端里直接敲 `mmap`，跑一次：

```
node "<插件目录>/scripts/install-mmap-command.mjs"
```

它会把 `mmap.cmd`（cmd、PowerShell）和 `mmap`（git-bash）写进
`%LOCALAPPDATA%\mellos-mapping\bin`，并把这一个目录追加进你的**用户**
PATH——写之前先把新值打出来；已经在里面就什么都不做；遇到 `setx` 会把
`%VARIABLE%` 展平、或者会被截断的过长 PATH，它干脆不碰，改为打印让你手动
添加的内容。之后开一个新终端。`--uninstall` 把这两件事都撤销。
`npm i -g mellos-mapping` 不用这一步就能得到同一个命令。

## 更新

```
claude plugin marketplace update mellos-mapping && claude plugin update mellos-mapping@mellos-mapping
```

要两步是因为 `plugin update` 只对比本地缓存的 marketplace 克隆——真正
拉取本仓库的是第一条命令。重启 Claude Code 生效。发布即 `master` 分支
上的版本号提升。（在对话里输入 `/plugin` 也能打开同一个管理界面。）

### 从 0.19 升级

0.20 把地图存储从 `.claude/` 挪到了 `.mellos/`——地图属于这个工具，不属于
某一个客户端。服务器和 watcher 都会在启动时做一次搬迁，并在 stderr 打**一行**
提示（`mellos-mapping: moved the legacy .claude map store to .mellos/ — commit
the move.`）：

| 0.19 及更早 | 0.20 及之后 |
| --- | --- |
| `.claude/mellos-mapping.json` | `.mellos/map.json` |
| `.claude/mellos-mapping.pages/` | `.mellos/pages/` |
| `.claude/mellos-mapping.config.json` | `.mellos/config.json` |

搬迁不合并、也不覆盖：`.mellos/` 里已经有东西（地图、页目录或配置）的项目
原样不动，无论旧目录里还剩什么。如果地图跟着 git 走，记得把这次搬迁提交
上去——`git add -A .claude .mellos` 会把它记成重命名，而不是一堆删除加一堆
未跟踪文件。

这一次搬迁是两个进程唯一会碰 `.claude/` 的时刻。此后工具只往 `.mellos/`
里写，也绝不会写到启动时解析出的项目目录之外。

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
`node <插件根>/dist/watch.mjs`。两者接受同一套参数，见
[面板参数](#面板参数)。

## 任意 MCP 客户端

服务器已发布到 npm，任何 MCP 客户端（Cursor、Windsurf、Zed、Gemini
CLI……）都能用标准 stdio 条目接入：

```
npx -y mellos-mapping
```

地图文件落在客户端会话的工作目录（`.mellos/map.json`）。在同
一项目里打开实况面板：

```
npx -y -p mellos-mapping mellos-mapping-watch
```

服务器按这个顺序确定项目目录：`MELLOS_MAPPING_CWD`（显式覆盖，给那些会
在固定目录里拉起服务器的客户端用）、`CLAUDE_PROJECT_DIR`（Claude Code 为
插件 MCP 服务器设置的约定），最后才是服务器进程自己的工作目录。如果你的
客户端会在你实际工作的项目之外启动服务器，就设 `MELLOS_MAPPING_CWD`。

技能/纪律层是 Claude Code 与 Codex 专属的；其他客户端获得五个 `mmap_*`
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
| 滚轮横向拨动 | 左右平移 |
| `hjkl` / 方向键 | 微移视口 |
| `Tab` / `Shift+Tab` / `1-9` / 点击标签 | 切换页（并行的多张地图） |
| 在标签行上滚轮 / 点击 `‹` `›` | 浏览放不下的标签栏，但不切页 |
| `f` | 开关自动跟随（见[页](#页)） |
| `x`，或点击当前标签上的 `×` | 请求删除屏幕上这一页；在确认窗口内再按一次，它的文件就被删掉（见[页](#页)） |
| 双击带 `⊞` 的节点 | 下潜进它的子图（一个子页面） |
| `Backspace` / `Esc` | 从上一次下潜爬回父图 |
| 拖动 `⋯` 分隔线 | 调整详情面板高度——向上拉，完整阅读长设计笔记 |
| `0` | 重置平移和缩放 |
| `q` / `Ctrl+C` | 退出面板 |

其他按键一律无效，这是有意的：面板不认识的转义序列（F 键、Home/End、
PgUp/PgDn、Insert/Delete、带修饰的方向键）会被整段吞掉、什么都不做，
而不是让它的载荷字节被当成热键读进来。

缩放先做几何缩小，只在阶梯两端才切换显示模式——每一级都能看到有意义的
数据：

```
细读+ ← 细读 ← 100% ← 85% ← 70% ← 55% ← 概览
```

- **放大过 100%**——`detail` 在盒子里展开验证证据和设计笔记的前三行；
  `detail+` 把盒子撑成一张阅读卡（最多十二行笔记）；
- **85–55%**——留白收紧、标签按比例截断，盒子还是盒子；
- **低于 55%**——标签已短到无意义，此时地图**聚合**：每个已声明的分组
  （层内的具名子系统）变成一个盒子，如 `地基子系统 1/2`，状态由成员推导，
  边收拢到分组上，未分组节点保持原样。就像真地图缩小后显示省名，而不是
  把城市变成无名光点。（没有声明分组的地图退化为纯字形星座 + 每层计数。）
  页脚始终显示当前级别。

地图下方、提示行之上，是一块**固定高度**的详情面板：一条可拖动的分隔线、
一行按状态着色的表头、焦点节点的验证证据、两个方向的连线（`uses → … ·
used by ← …`，每个邻居各带自己的状态字形），以及自动折行的设计笔记。没有
焦点时显示整图的仪表盘。高度固定——详情不会悬浮遮挡地图，版面也不会跳。

### 字形

一个状态一个字形，画地图的地方都一样——面板里的盒子、标签栏、详情面板，
以及任何读同一份存储的客户端：

| Unicode | ASCII | 含义 |
| --- | --- | --- |
| `·` | `.` | planned——已声明，未开工 |
| `⠿` | `*` | in-progress 的静止形态——能做动画的盒子转的是盲文帧 `⠋⠙⠹…`，ASCII 下是四帧的转杠 |
| `■` | `#` | done，且有证据 |
| `□` | `o` | done，但**没有**记录证据——同一个断言，背后空无一物 |
| `✗` | `X` | regressed：曾经 done，现在坏了 |
| `⊞` | `+` | 徽标：这个节点链着子图，双击下潜 |

图下方的图例列出四个状态；`□ done, no evidence` 只在这张图里真的出现了
这种节点时才加入——四个状态是词汇表，那一个是此时此地正在被违反的规则。
文档型图种用节点 kind 的字形取代状态图例。

### 面板参数

面板启动脚本（`scripts/open-pane.mjs <项目目录>`）和 watcher
（`dist/watch.mjs`）接受同一套 watcher 参数；启动脚本原样转发它们，遇到
不认识的参数会报错，而不是悄悄丢掉。

| 参数 | 作用 |
| --- | --- |
| `--page <slug>` | 打开时定位到这一页；已经有面板在跑时，改为让那个面板切过去，而不是再开一个 |
| `--ascii` | 纯 ASCII 字形，给缺制表符字形的字体用 |
| `--no-color` | 不输出 ANSI 颜色 |
| `--no-mouse` | 关闭鼠标上报，把鼠标留给你的终端复用器 |
| `--no-follow` | 启动时就关掉自动跟随 |
| `--interval <ms>` | 轮询间隔，缺省 250，下限 50 |

只属于启动脚本的：`--window` 直接开到专属的 "mellos-mapping" 窗口而不是
在会话窗口里分屏，`--force` 即使本项目已有面板在跑也再开一个。只属于
watcher 的：`--file <path>` 指定默认页的状态文件（启动脚本会从项目目录
自己推导出来）。

### mmap 命令

在任何终端里敲 `mmap`，它是一个**开关**：本项目还没有面板就开一个，已经
有面板就把它关掉。

| 你敲的 | 发生什么 |
| --- | --- |
| `mmap` | 本项目没有面板在跑 → 开一个；有 → 关掉它 |
| `mmap <页 slug>` | 打开时定位到这一页，或者让已开的面板切过去——永远不关 |
| `mmap --window` | 开到专属的 "mellos-mapping" 窗口，而不是把当前窗口分屏 |
| `mmap --force` | 即使已经有面板在跑也再开一个 |

项目是像 git 找仓库根那样找出来的：从当前目录往上走，找最近一个含
`.mellos/` 存储的目录。站在一个还没有地图的项目里也没问题——面板会开在
待机画面上，等第一次 `mmap_declare`。

关闭走的是存储，不是信号：`mmap` 在地图旁边写一份一次性请求，面板在下一次
轮询（缺省 250 毫秒）时消费掉它并退出，并把终端原样还回去——关掉鼠标上报、
恢复光标。还停在待机画面上的面板也一样关得掉。请求读到即删；上一个面板死掉
留下的残留会在下一个面板启动时被清扫，所以过期的请求永远关不掉新面板。

上面每一个 watcher 参数在这里同样有效，原样转发；不认识的参数会报用法错误，
绝不悄悄丢掉。除非你装的是 npm 包，否则 `mmap` 需要
[装一次](#安装)。在 Claude Code 对话里，`/mellos-mapping:mmap` 打开的是
同一个面板。

### 页

一个项目可以并排保有多张地图——**一个工作努力 = 一页**。Claude 在任何
`mmap_*` 工具里传 `page` 参数即可定向到某页；出现第二页时面板顶部自动长出
标签栏。当前页加粗、按整图状态着色。每页记住自己的平移/缩放/钉住状态。

面板默认**自动跟随正在被写入的那一页**——AI 此刻在操作哪张图，就看哪张图，
于是 declare 和 update 自己就把观众带过去了。按 `f` 开关，手动切页也会关掉
它，`--no-follow` 则是一开始就关着；跟随关掉之后，后台页有变化时它的标签会
亮起状态色提示你，而不是抢走你的视线。显式的 `--page` 优先级高于跟随；请求
一个还不存在的页会一直挂着，等它出现的那一刻显示出来。

**删除一页。** 一件事做完了，它那一页不必留着。在面板里按 `x`——或者点击
当前标签上的 `×`（开着鼠标时才画）——只是**发问**：页脚出现
`press x again to delete <页>`，三秒内再按一次，这一页的文件就被删掉。切页、
`Esc`、或者干脆等它过期，请求就收回了。`×` 只长在当前标签上，所以点一个
非当前标签是先切过去，下一帧它才带上自己的 `×`。工具那边是
`mmap_remove {pages: ["slug", …]}`，在这次调用的地图修改**之后**执行。两条
路都一样：文件是真的没了——地图是纯 JSON，提交进 git 是唯一的后悔药。

地图状态存在项目根目录下、属于本工具的 `.mellos/` 目录里：

| 路径 | 是什么 |
| --- | --- |
| `.mellos/map.json` | 默认页——可选；工作全在命名页上的项目根本没有这个文件 |
| `.mellos/pages/<slug>.json` | 一个命名页一个文件 |
| `.mellos/config.json` | 本项目的建图策略（见 [Setup](#setup选择什么时候建图)） |
| `.mellos/focus` | 启动脚本发给运行中面板的一次性"切到这一页"请求；面板在一个轮询周期内消费并删除它 |
| `<上面任一文件>.<pid>.<随机>.tmp` | 正在落盘的一次写入；它要么被改名覆盖目标，要么被删掉。留下来说明那次写入失败（并已被报告），连清理都没能跑成 |

地图文件是纯 JSON，想在 git 里留下地图的历史就把它们提交进去。

**并发模型，直说。** 每次保存都是原子的——先写进一个私有的同级临时文件，
再改名覆盖目标——所以轮询存储的读者要么看到上一张完整的地图，要么看到新的
那张，绝不会读到写了一半的。但**没有丢失更新保护**：两个写者保存*同一页*
就是在赛跑，最后那次改名赢，另一个基于旧读取算出来的东西被静默丢弃。页就是
隔离单位——不许互相覆盖的两个会话，就该在两页上，这也是同一项目里跑多个
Claude 会话的正确姿势。

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

子图是节点的内部细节，不是兄弟页：被*别的*页潜进去的页**不占标签栏**。
有两条修正保证标签栏不会把自己抹掉——节点指向自己所在页的，谁也不藏；
链接成环的一组页保留各自的标签，除非环外有页潜进来，因为环本身没有"外面"
可以爬回去。下潜
之后标签行变成面包屑——`⌫ 父图 ▸ 节点`——点击它（或按 `Backspace`）爬
回去。隐藏的子图在后台有变化时，底栏会提示。

## MCP 工具

| 工具 | 用途 |
| --- | --- |
| `mmap_declare` | 生长地图：标题（传 `null` 删掉）、图种、层级横条、泳道、分组（子系统）、节点（可带 `status`、`evidence`、`detail`、`kind`、`group`、`lane`、`submap`）、边（可带标签）；批量，全有或全无 |
| `mmap_update` | 记录进度**并修订**：状态（`planned → in-progress → done` 附证据、`regressed`）、改节点标签、把节点搬到另一层（`layer`）、加入/退出分组或泳道、设节点 kind 或 `submap`；给层改名和改 rank（`layers`）、给分组改标签（`groups`）、给泳道改标签（`lanes`）；任何可清空的字段传 `null` 即清空 |
| `mmap_remove` | 修订：删除边、节点、分组、泳道、空层——以及用 `pages` 删掉整页，连文件一起（永久；在本次调用的地图修改之后执行） |
| `mmap_view` | 把当前地图渲染成文本，直接在对话里看（可选 `zoom`，`-4`…`2`）；每次响应结尾都有一行 `pages:`，列出本项目有哪些页、以及你正在看哪一页 |
| `mmap_setup` | 查/设本项目的建图策略——什么时候开地图 |

一个批次的施加顺序是 层 → 分组 → 泳道 → 节点更新；同一条节点更新里
`layer` 先于其他字段生效，所以一个节点可以在一条更新里搬层并加入新层上的
分组。

边界会拒绝下面这些，好让账本不会记下它并不想记的东西：

- **不认识的键**，并把键名说出来——拼错的 `evidance` 是错误，不是被悄悄
  丢掉的字段；任何嵌套深度都一样；
- 文本字段里的**控制字符**——藏在标签里的 ESC 序列，会让这张图重绘每一个
  打开它的人的终端。`detail` 是例外：换行和制表符本来就是写笔记的方式，
  其余（ESC、BEL、单独的 CR）照样拒绝；
- 可选字段上的**空字符串**——清空字段用 `null`，而不是一个渲染出来跟真盒子
  分不清的空白；
- **`submap` 指向本次调用所针对的那一页的节点**——那是个没有底的环，不是
  指向父图的链接；
- **删页请求指向本次调用自己所针对的那一页，或者指向本项目根本没有的
  slug**——一次调用不能一边改一张图一边删掉它；而对不上任何一页的名字，
  是拼错的概率远大于"刚被别人删了"，拒绝时会把真实存在的页列出来。

没有落盘的写入回答 `save failed, nothing changed (retry)`：之前的文件完好
无损，重试一次就是全部的恢复手段。

### Setup：选择什么时候建图

建图要多积极，是一个人的工作习惯，不是某个仓库的属性——所以它**只为你选
一次**，就在你装完之后的第一个会话里：

- `always` —— 任何有结构的任务都建图：流程、设计、架构、技术依赖。AI 会
  主动开面板；你记下的这个答案就是它的长期授权，它不会再问。
- `complex` —— 同样的做法，但只用在中等或复杂任务上：牵涉多个模块、一个
  新子系统，大约一小时以上的活。
- `on-request` —— 只在你明确要求时建图。在还没有地图的项目里，插件对此
  一个字都不说——零噪音就是目的。

答案落在 `<你的用户目录>/.mellos/config.json`，并通过插件的 `SessionStart`
钩子进入每一个会话：钩子把它读出来，在你敲下第一个字之前就把对应的指令交给
AI。从此再也不需要按项目设置什么。

单个项目仍然可以不一样：`mmap_setup {policy, scope: "project"}` 把策略写进
那个项目的 `.mellos/config.json`，项目策略压过用户策略。想改主意时，
`/mmap setup` 会把这个问题按任一作用域重新问一遍。策略只是引导 AI；它从不
阻止工具本身——无论什么策略，明确要求建图永远有效。

没有钩子的宿主（Codex CLI、裸 MCP 客户端）用另一条路拿到这个问题：只要两个
作用域里都还没有策略，每一次 `mmap_declare` 的响应都会带一条提示，让 AI 来
问你。你在任何一个作用域答完之后，这条提示就永远闭嘴了——在每一个项目里。

工具强制的结构不变量：层按 rank 构成全序（rank 是 0..99 的整数，0 在最底，
一张图里不许重复）；每个节点恰好属于一层；边**严格向下**——因此图从构造上
就是无环的；节点不能依赖同层兄弟（如果 A 需要兄弟 B，要么 B 其实是更低层的
概念，要么 A 和 B 本来就是一个节点）；分组只在一层之内聚拢节点；节点 id 和
分组 id 共用**同一个命名空间**——一个 id 要么命名节点、要么命名分组，绝不
两者兼有，因为它们都渲染成盒子，一个 id 必须只意味着一个盒子。

## 开发

```
npm install
npm run verify
```

`verify` 是按顺序的五步：`typecheck`（本仓库自己的源码）、
`typecheck:packages`（dsh 插件包里不依赖框架的模块，且把 `mellos-mapping/*`
指向本仓库源码）、`test`、`build`（打包 `dist/`、产出带声明的 `lib/`，两个
目录都先清空），以及 `check:package`——它按真实的 `prepack` 生命周期打出
tarball，只要 `exports` 或 `bin` 里有任何目标没被打进去就失败。

这个仓库本身就是自下而上分层的，每一层都有自己的规格测试：

| 层 | 代码 | 规格 | 职责 |
| --- | --- | --- | --- |
| 0 domain | `src/domain/` | `ops.test.ts` | 地图值、结构不变量、纯操作 |
| 1 format | `src/store/format.ts` | `store.test.ts` | 状态文件格式：重放校验的解析与序列化，零 I/O |
| 1 store | `src/store/store.ts` | `store.test.ts`、`atomic-save.test.ts` | Node 上的原子化状态文件持久化 |
| 1 semantics | `src/semantics/` | `semantics.test.ts` | 媒介无关的视图语义：缩放阶梯、分组聚合、页集规则、时序翻转、共享字形词汇表 |
| 2 apply | `src/server/apply.ts` | `apply.test.ts` | 工具输入 → 事务性操作序列 |
| 3 server | `src/server/server.ts` | `server.test.ts`、`save-failure.test.ts` | stdio 上的五个 MCP 工具 |
| 4 render | `src/render/` | `render.test.ts`、`routing.test.ts` | ASCII 渲染器与它的走线 |
| 4 pane | `src/watch/` | `watch.test.ts`、`pane-state.test.ts`、`input.test.ts` | 轮询面板：页集、输入解析、详情面板与外框 |
| — 启动脚本 | `scripts/` | `open-pane.test.mjs`、`codex-register.test.mjs` | 纯 node 的入口 |
| — 打包 | `package.json`、`packages/` | `tests/lockfile.test.ts`、`tests/packages.test.ts`、`browser-safe.test.ts` | 发出去的是什么、发给谁 |

`dist/` 是刻意提交的：插件安装就是克隆本仓库、不运行任何东西，所以入口
文件以打包形式随仓库分发。CI 会把提交的 `dist/` 和一次全新构建做 diff，
所以改了源码却忘了重新构建会直接失败。

### dsh 插件包

`packages/dsh` 与 `packages/dsh-client` 是 DeepSeek Harness 的那一面：一个
读取并监视工作区 `.mellos/` 存储的宿主插件，加上用同一套语义作画的浏览器
地图面板。它们在 dsh workspace 检出里*开发*（由那边的工具链构建），从这里
*发布*——源码、规格测试和 `lib/` 都提交在这儿，用
`node scripts/sync-dsh-plugin.mjs <deepseek-harness 检出路径>` 刷新，该脚本
会把 dsh 内部包名改写成发布用的名字。本仓库构建不了它们，所以只证明它能
证明的：`typecheck:packages` 和不依赖框架的规格测试在 CI 里跑，
`tests/packages.test.ts` 守住 src↔lib 的结构、共享版本线和 MCP 行的拉起
方式。需要 `@deepseek-ai` 框架或 DOM 的规格测试连同理由一起写在
`vitest.config.ts` 里。详见
[`packages/dsh/README.md`](packages/dsh/README.md)。

### 库

底部各层同时是一个库（`npm run build` 产出带类型声明的 `lib/`，npm 打包
收录）。子路径导出与源码结构一一对应：

| 子路径 | 内容 | 浏览器安全 |
| --- | --- | --- |
| `mellos-mapping/domain/types` | 地图值、id、rank、状态、错误 | 是 |
| `mellos-mapping/domain/ops` | 地图上的纯操作 | 是 |
| `mellos-mapping/format` | 状态文件的解析/序列化、页 id | 是 |
| `mellos-mapping/semantics` | 缩放阶梯、分组聚合、焦点与页集规则、共享字形词汇表 | 是 |
| `mellos-mapping/render` | 终端渲染器 | 同样受门禁守护（它是纯的），但产出是字符格——给终端宿主 |
| `mellos-mapping/store` | 文件系统持久化、原子保存、focus 文件、策略 | 仅 Node |
| `mellos-mapping/server` | 打包好的 MCP 服务器入口——用来拉起的进程，不是拿来 import 的模块 | 仅 Node |

**浏览器安全**的意思是 import 闭包里没有任何 Node 内建模块，由测试门禁
守护——图形客户端（web 面板、编辑器视图）可以直接解析状态文件，并复用与
终端面板完全一致的聚合、缩放与字形语义。`packages/dsh-client` 就是这样一个
客户端。

## 许可证

MIT
