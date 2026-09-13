# 项目结构与 Git 维护

`main` 是共用源码的开发入口。功能与修复先进入 `main`，再按
[发布流程](releasing.md)生成两个宿主的发行候选。源码、发行包和本地实验分别维护。

## 目录职责

| 目录 | 职责与边界 |
| --- | --- |
| `src/domain/` | 地图数据与纯操作，不依赖文件系统或宿主 |
| `src/store/`、`src/semantics/` | 持久化和跨显示媒介复用的语义；展示层不要重新实现这些规则 |
| `src/render/`、`src/preview/` | 终端字符、Markdown、SVG 表示 |
| `src/watch/`、`src/web/` | 终端面板和浏览器交互，组合底层能力 |
| `src/server/`、`src/hook/` | MCP 工具与宿主生命周期入口 |
| `scripts/` | 启动、安装、打包、发布；CLI 入口与可测试逻辑分开 |
| `skills/`、`commands/`、`hooks/`、`.claude-plugin/` | Claude 宿主配置与说明 |
| `integrations/codex/`、`.codex-plugin/` | Codex 适配说明与配置，复用共用运行时 |
| `tests/`、源码旁的 `*.test.*` | 跨模块约束与各层的行为规格 |
| `dist/` | 必须提交的预构建入口，插件安装不执行构建 |
| `lib/`、`node_modules/` | 可重建的库输出与依赖，不提交 |
| `docs/` | 用户、开发与发布说明；双语 README 的结构保持一致 |
| `artifacts/` | 本地验证证据、安装包和原型，不提交 |

核心边界：`server/tool-definitions.ts` 只定义 MCP 协议；`map-service.ts` 负责
读取、应用和保存地图；`pane-launcher.ts` 管理启动进程与可见性回执；`presence.ts`
解释心跳。`server.ts` 组合这些模块，不让终端或宿主规则进入领域操作。

`store/store.ts` 是兼容公共入口，内部按 `atomic`、`pages`、`maps`、`channels`、
`viewers`、`policy`、`migration` 分工，内部模块不反向依赖入口。
`watch/pane-state.ts` 决定显示哪个页面，`watch/view-state.ts` 管理页面视图与手势；
终端主循环负责执行 I/O。新增交互优先补充状态事件及事件序列测试。

`npm run typecheck` 同时检查 TypeScript 和启用 `@ts-check` 的七个安装关键脚本：
`install-release`、`release-files`、`release-transaction`、`host-installation`、
`host-cli`、`codex-register`、`verify-runtime`。其他历史脚本按修改范围逐步纳入，
不以放宽这些边界的类型要求代替迁移。类型声明只服务于源码检查，发行版仍直接运行 JavaScript。
| `.mellos/` | 此项目的地图及本地运行状态，不是产品发行文件 |

现有模块边界优先于移动文件。共享规则放在能承担职责的最低层；宿主分支不维护
另一份业务实现。具体依赖与测试入口见 [README 开发表](../README.md#development)。

## 分支与工作区

| 分支 | 用途 |
| --- | --- |
| `main` | 当前源码，日常 PR 的目标 |
| `claude`、`chatgpt-app` | 已发布的宿主快照，只接收经过验证的发行候选 |
| `codex/<任务>`、`fix/*`、`feature/*`、`refactor/*` | 有明确范围的开发工作，完成后归档清理 |
| `release/<版本>/claude`、`release/<版本>/chatgpt-app` | 从已提交源码生成，分别向对应宿主分支提 PR |
| 旧 `master` | 历史引用；若远端保护规则禁止删除则保留，不作为新开发入口 |

开始工作前先检查 `git status`、`git branch -vv`、`git worktree list`，保存已有修改。
主目录保持在 `main`；并行任务使用仓库外的独立 worktree，例如：

```sh
git fetch --prune origin
git worktree add ../mellos-mapping-my-task -b codex/my-task origin/main
```

不要在 `artifacts/` 中放 worktree，以免清理构建输出时影响开发分支。
未提交文件必须先提交到独立分支，或保存包含未跟踪文件的 stash 并为它建立归档引用。
Git bundle 不包含未提交文件、忽略的日志和依赖；需要保留的证据单独复制并核验。

地图可按团队需求显式纳入 Git。只在本机保留时，将 `/.mellos/*.json` 和
`/.mellos/pages/` 写入 `.git/info/exclude`；运行通道仍由 `.gitignore` 忽略。

## 完成后的归档与恢复

先确认 PR 的合并状态并比较分支内容。普通合并可检查祖先关系；squash 合并还需
比较补丁或最终文件树，不能只凭“ahead”计数删除。存在独立改动的分支继续保留。

下面的日期和分支名是示例，执行前替换成实际已核验分支：

```sh
git tag archive/2026-09-14/branches/codex/my-task codex/my-task
git bundle create ../mellos-mapping-before-cleanup.bundle --all
git bundle verify ../mellos-mapping-before-cleanup.bundle
```

确认工作区没有未保存内容，单独保存忽略的证据文件，再移除该 worktree 和分支。
默认使用 `git branch -d`；squash 分支只有在确认内容已合入且备份可恢复后才能强制删除。
远端保护规则拒绝删除时保留该分支，不通过修改保护规则完成普通清理。
归档标签默认只留本地，不批量推送可能包含个人地图或实验内容的标签。

从本地归档恢复到一个新分支：

```sh
git switch -c codex/recovered-task archive/2026-09-14/branches/codex/my-task
```

从仓库外的 bundle 恢复：

```sh
git fetch ../mellos-mapping-before-cleanup.bundle refs/tags/archive/2026-09-14/branches/codex/my-task:refs/heads/codex/recovered-task
git worktree add ../mellos-mapping-recovered codex/recovered-task
```

## 交付判断

整理分支不会自动完成发行。Issue 关闭、PR 合并、源码 CI 通过与用户安装到新版本
是不同证据。发布前检查真实安装来源、版本是否递增，以及已有安装能否更新到新文件。
tmux 之类的宿主集成还要验证实际显示位置、重复调用和错误反馈；已知缺口保留复现报告，
不要因为分支清理而标记解决。所有必要检查见 [发布流程](releasing.md)。
