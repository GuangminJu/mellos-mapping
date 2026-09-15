# 发布与分支维护

本仓库使用 `main` 开发源码，`claude`、`chatgpt-app` 分发宿主快照。`chatgpt-app` 指 ChatGPT
桌面 App 的 **Codex 模式**；普通网页聊天不是这个本地运行时的安装目标。

| 分支 | 内容 | 克隆后的入口 |
| --- | --- | --- |
| `main` | 共用源码、测试、两个宿主适配器、预构建运行文件 | `node install.mjs claude` 或 `node install.mjs chatgpt-app` |
| `claude` | Claude 技能、命令、钩子、MCP 与运行文件 | `node install.mjs` |
| `chatgpt-app` | 桌面专用技能、专用市场、MCP 注册器与运行文件 | `node install.mjs` |

安装前需要 Node.js 18+、对应宿主 CLI，以及该宿主正常工作的账户/环境。
无需依赖开发机路径、Python 技能脚本、npm 安装或本地构建。安装器检查文件校验值
和真实 MCP 握手，再将运行时保留到用户目录并注册插件。安装后开启新对话。
桌面默认通过 web-terminal 在浏览器面板自动开图；显式选择原生终端且宿主缺少
终端输入工具时，首次启动需要粘贴给出的命令一次。

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
安装、从旧版升级、升级失败后回退、重复安装及移除克隆后运行；不会使用真实账户
配置，也不会调用模型。验收读取宿主报告的安装路径，核对运行文件校验值，再做 MCP 握手。
正式发行时可传入真实旧版及候选目录：
`node scripts/check-host-install.mjs <宿主> <旧版目录> <候选目录>`。
省略目录时使用源码打包及合成旧版测试夹具；验收记录会明确标出旧版来源。

安装器先在同级临时目录准备并校验整份发行包，再切换稳定路径；复制失败不会覆盖
正在使用的文件。切换后验收失败则恢复旧目录，并重新注册和检查已有的宿主安装。
如果宿主自身无法恢复，错误会明确区分「旧文件已恢复」与「宿主注册未通过验收」。
并行安装通过独占锁互斥；异常中断留下锁时，先确认没有安装进程，再处理锁和保留的恢复目录。
同版本不同内容会被拒绝，需要提升版本号，以免宿主继续使用旧缓存。
`npm run verify` 检查源码、发行包内容、八工具 MCP、MD/SVG、网页与项目隔离。

正式升版用 `node scripts/release.mjs <版本>`，它同步两个插件清单、Claude 市场条目、
`package.json`、`server.json` 的两个版本字段和服务版本常量，并运行验证。
`package-lock.json` 只更新顶层和根包的版本字段，保留已解析的依赖图及各平台可选包；
升版不执行依赖重新解析。
`npm run package:release` 从已构建文件生成 `artifacts/release/claude/` 和
`artifacts/release/chatgpt-app/`。每份包含 `release.json` 校验清单和独立安装说明。
Git 发行保留 LF 换行，避免 Windows 克隆改变校验值。

先将升版和构建提交通过 PR 合入 `main`，工作区必须干净。同步源码与发行基线：

```sh
git fetch --prune origin
git switch main
git merge --ff-only origin/main
node scripts/prepare-branches.mjs
```

脚本只创建 `release/<版本>/claude` 和 `release/<版本>/chatgpt-app` 两个本地候选分支。
`main`、`claude`、`chatgpt-app` 和用户索引保持原样，脚本不推送远端。
所有输入固定在当前 `HEAD` 提交，宿主内容复用打包白名单。未提交或未跟踪的工作文件
会导致拒绝；忽略的项目地图、依赖和临时输出不会被打进宿主快照。

每个候选以 `origin/<宿主>` 为父提交；离线且没有远程引用时使用对应本地宿主分支。
必须已有发行基线，且新版本严格高于两个宿主的 `release.json` 版本，避免宿主缓存把
同版本修复误判为已经安装。已有候选分支或同版本产物不会被覆盖，重试前需自行保存归档。

产物位于 `artifacts/release/candidates/<版本>/`，包含源码 ZIP、两个宿主 ZIP、
Git bundle 与 `branches.json`。源码 ZIP 来自原始 `HEAD`；JSON 记录源码提交、
发行基线和候选提交，可追溯包与源码的对应关系。bundle 包含源码 HEAD 和两个候选引用。

## 审核与上传 GitHub

先用 `git remote -v` 确认 `origin` 正确。将下面 `0.24.0` 替换为实际待发布版本，
只推送两个候选，并分别对对应宿主分支打开 PR：

```sh
git push origin release/0.24.0/claude release/0.24.0/chatgpt-app
gh pr create --base claude --head release/0.24.0/claude
gh pr create --base chatgpt-app --head release/0.24.0/chatgpt-app
```

两个候选的跨平台发行 CI 和真实安装检查通过后再合并。合并后重新核对远端发行文件
与候选 ZIP 的内容一致，再归档清理候选分支。默认开发分支始终为 `main`。
如果基线在准备期间改变，脚本会拒绝创建引用；重新同步并准备，不强推覆盖。
分支清理与恢复方法见[项目维护指南](project-maintenance.md)。

将版本标签（例如 `v0.24.0`）固定到 `branches.json` 记录的 `sourceCommit`，核对后
单独推送该标签，再创建对应的 GitHub Release；不要用此时可能已经前进的 `main`
代替记录的源码提交。可将三个 ZIP 作为附件。公开安装示例：

```sh
git clone -b chatgpt-app https://github.com/GuangminJu/mellos-mapping.git
cd mellos-mapping
node install.mjs
```

Claude 用户把分支换成 `claude`。如果发布到自己的 fork，替换仓库地址。
GitHub 发布不会自动发布 npm 包、MCP Registry 或 OpenAI 公共插件目录。

## npm 发布与安装验收

以下命令以 `0.24.0` 展示版本、文件名和安装目录的对应关系；执行时统一替换为尚未
发布的候选版本。先确认源码提交已合入 `main`、CI 通过，并且工作区与该提交一致。
记录源码提交及本地 tarball 的 `integrity`，后续从同一份 tarball 发布。

所有 npm 账户和发布验收命令都显式指定官方源。`package.json` 的 `publishConfig`
约束发布目的地，不会替 `npm whoami`、`npm login`、`npm view` 或安装命令选择源。
如果用户默认使用 npmmirror 等镜像，对镜像执行 `whoami` 失败不能证明官方源未登录，
镜像暂时查不到新版本也不能证明官方发布失败。无需修改用户的全局 npm 配置。

```sh
npm whoami --registry=https://registry.npmjs.org/
```

仅在官方源确认需要登录时执行：

```sh
npm login --registry=https://registry.npmjs.org/
```

登录与发布可能分别要求浏览器或安全密钥验证，按 npm 当前请求完成。打包前已运行
`npm run verify`；`npm pack` 还会执行项目的 `prepack` 构建。下面的输出目录由前面的
发行打包步骤创建：

```sh
npm pack --json --pack-destination artifacts/release --registry=https://registry.npmjs.org/
npm publish artifacts/release/mellos-mapping-0.24.0.tgz --registry=https://registry.npmjs.org/
```

`npm publish` 成功返回表示发布请求已被接受。还需确认官方源的版本元数据、tarball
和实际安装都可用，再说明“npm 已发布且可安装”：

```sh
npm view mellos-mapping@0.24.0 version dist.integrity dist.tarball --json --registry=https://registry.npmjs.org/
npm dist-tag ls mellos-mapping --registry=https://registry.npmjs.org/
npm install --prefix artifacts/audit/npm-install-0.24.0 --package-lock=false --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org/ mellos-mapping@0.24.0
node -p "require('./artifacts/audit/npm-install-0.24.0/node_modules/mellos-mapping/package.json').version"
```

使用尚不存在的隔离安装目录，核对精确版本、`latest` 标签，以及官方 `dist.integrity`
与本地打包结果一致。安装核验只使用 npm 官方源，不用本地 `.tgz` 替代下载验收。
如果发布已接受但版本查询或下载尚未成功，记录为“官方源尚未确认可安装”，保留原始错误，
区分版本暂不可用、网络错误和认证失败。先核实状态，不重复上传同一版本或据此提升版本号。

## MCP Registry 同步

npm 官方源安装验收通过后，再运行 `.github/workflows/publish-mcp-registry.yml`。
该工作流使用 GitHub Actions OIDC 发布所选引用中的 `server.json`，不会发布 npm 包。
确认该文件的顶层版本、npm 包版本与已发布包一致，且发布标签指向记录的源码提交：

```sh
gh workflow run publish-mcp-registry.yml --ref v0.24.0
```

记录本次工作流的运行 ID，检查该次运行结果与官方 MCP Registry 中的精确版本条目。
只有两者都确认成功，才说明 MCP Registry 已同步；GitHub Release 创建成功或 npm
安装成功都不能替代这项证据。

## 发布证据与限制

除首次安装外，必须从上一版升级，核对宿主实际使用的缓存文件确实更新，不能只看
安装命令退出码。记录所测源码提交、候选提交、宿主版本和平台；源码修复合入后，
发行分支和 npm 等安装渠道仍需要各自完成发布，关闭 Issue 不代表所有渠道已更新。

主分支 CI 检查源码和提交的构建文件；两个宿主分支 CI 在 Windows/macOS/Linux
检查无需 npm 依赖的发行文件与 MCP 握手。跨平台 CI 成功前，不能把本地 Windows
验证当作三平台实机通过。自动打开 Windows Terminal 分屏只属于终端客户端；
桌面右侧终端的打开、输入权限与字体由 ChatGPT App 决定。
