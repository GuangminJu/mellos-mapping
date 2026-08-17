# mellos-mapping-dsh-client

The browser half of Mellos Mapping's [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
surface: the live map panel (`./client` is the bundle the dsh web loader
serves to the browser; the root export is the inert host loader entry).

Not installed directly — [`mellos-mapping-dsh`](../dsh/README.md) mounts it:

```sh
dsh plugin --profile web add mellos-mapping-dsh
```

The panel renders the workspace's `.mellos` map store with the exact
semantics of the terminal pane (shared through the `mellos-mapping` library):
continuous zoom over the semantic ladder, group aggregation at the far end,
pages and sub-map dives, per-session viewpoints, and the terminal's wire
routing — straight drops, packed track rows, threaded descents. On web
frames carrying the generic `aux` slot it is a side-by-side column; on stock
dsh it is a right-edge drawer owned by the Map header button.

Sources are the publishing copy; the build runs in a dsh workspace checkout
and `lib/` is committed — see
[`scripts/sync-dsh-plugin.mjs`](../../scripts/sync-dsh-plugin.mjs).
