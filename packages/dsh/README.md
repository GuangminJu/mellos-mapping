# mellos-mapping-dsh

Mellos Mapping for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`),
as one installable plugin bundle:

```sh
dsh plugin --profile web add mellos-mapping-dsh
```

The bundle's [`cordis.patch.yml`](cordis.patch.yml) mounts three rows:

| Row | What it is |
| --- | --- |
| `mmap-host` | This package's own plugin: reads and watches each session workspace's `.mellos` map store, serves it over the `mmap` Remote namespace |
| `mmap-view` | [`mellos-mapping-dsh-client`](../dsh-client/README.md): the live map panel in the web view |
| `mcp-mellos-mapping` | The [`mellos-mapping`](https://www.npmjs.com/package/mellos-mapping) MCP server bridged into the model plane — the five `mmap_*` tools |

The panel probes the web frame at load: on frames carrying the generic `aux`
slot it renders as a side-by-side column; on stock dsh it is a right-edge
drawer owned by the Map header button. Live refresh rides the forwarded
`mmap/changed` event where the host forwards it, with a slow visibility-gated
poll backing it up everywhere else.

Framework packages (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-*`) are
deliberately **not** declared as dependencies: the dsh loader supplies them
from the installation, and a profile-local copy would split framework
identity. Declared dependencies are the leaf libraries this plugin truly owns
(`mellos-mapping`, `chokidar`, `zod`) plus `mellos-mapping-dsh-client` — a
patch row names a plugin, it does not install one, so the browser half has to
arrive as this bundle's own dependency for the one-command install to
resolve. Both mellos packages are pinned to the shared version line.

Known limitation: the stock `dsh-mcp-client` spawns the MCP server in the dsh
process working directory, so maps land in the project `dsh web` was started
from. Single-project usage (start dsh in your project directory) is exactly
right; multi-workspace routing needs a dsh whose mcp-client supports
`workspaceScoped: true` — add it in a user patch layer when available.

## Development

Sources here are the publishing copy. The build runs inside a dsh workspace
checkout (the framework's own toolchain: tsc project references and the
tsdown client-bundle preset); `lib/` is committed, mirroring the root
package's committed `dist/`. Refresh both packages with:

```sh
node scripts/sync-dsh-plugin.mjs <path-to-deepseek-harness-checkout>
```

which copies `src/` + `lib/` and rewrites the dsh-internal package names —
including the client bundle's baked module id — to the published ones.
