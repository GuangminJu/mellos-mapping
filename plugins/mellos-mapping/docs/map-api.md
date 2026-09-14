# Persistent maps and the MCP API

Maps survive process restarts and new conversations. Begin with `mmap_read
{resource: "pages"}`, match the effort to a saved page, then read only relevant
records. A conversation is not a page identity. `mmap_view` remains the visual
representation; `mmap_read` is the editable data contract.

## Read

`mmap_read` returns JSON text and the same object in `structuredContent`:
`resource`, `project`, `page`, `revision`, `total`, `items`, `nextCursor`.
The default page is represented by a null `page` and the record ID `_default`.
Named page slugs and resource IDs remain stable; change display titles/labels
instead of renaming identity. Edge IDs are `from->to`.

| resource | Records |
| --- | --- |
| pages (default) | Page IDs, titles, kind, counts, context and each page's revision; a broken page is listed with its error |
| map | One page's metadata/context/counts; it does not embed the entire graph |
| nodes | Node IDs, labels, status and membership; request detail, evidence and sources through fields |
| edges | ID, from, to and optional label |
| layers / groups / lanes | The stored editable records |
| neighborhood | Related nodes selected by id/ids, direction (dependencies/consumers/both) and depth (0–4) |
| changes | Source-file verification state for selected nodes and up to 100 affected consumer IDs |

Use `id` for exact lookup (missing is `NOT_FOUND`), `ids` for a selection,
`query` for text matching, and status/layer/group/lane for node filtering.
`fields` projects records while always retaining identity and edge endpoints.
The default limit is 30, maximum 100. Repeat the same query with nextCursor;
if the graph changes, the cursor returns `CONFLICT` instead of skipping records.
An absent page is `NOT_FOUND`; an empty list is successful. The legacy view's
empty-map behavior is retained for compatibility.

Use a page or record response's revision for that page's next write. The top-level
revision of a pages listing describes the listing, not any individual page.
`ifRevision` can avoid resending unchanged graph data. It does not suppress
source checks: files may change without a graph edit. Pagination checks graph
revisions, not a filesystem snapshot of source files changing during the query.

```json
{"resource":"nodes","page":"payments","status":"in-progress","fields":["label","detail","evidence"],"limit":20}
```

## Create, update and delete

The existing tools and fields remain supported. New writes return a revision
and structured outcome in addition to the existing summary.

- `mmap_declare`: create pages, layers, groups, lanes, nodes and edges. Existing
  IDs are refused. Pass expectedRevision: "absent" to require a new page.
- `mmap_update`: existing node fields, layer names/ranks, group labels/layers,
  lane labels, complete laneOrder, map title/kind/context and edge patches.
  An edge patch identifies from/to, with optional label, newFrom and newTo.
  A null label clears it. A laneOrder contains every lane exactly once.
- `mmap_remove`: existing per-resource deletion and cascades. Use deletePage:
  true to delete the targeted page, including the default page. Inbound submap
  references are refused unless references: "keep" is explicit. Unlink nodes
  first when the references should disappear. This form cannot include edits
  or legacy pages batches.

Optional fields are unchanged when omitted and removed when set to null where
the schema permits. context and sources are replaced as whole values. Moving
a group does not silently move members: include their intended node moves in
the same update or transaction. Normal single-field changes keep the old graph
constraints; use a batch for changes that require a coordinated final graph.

Every graph writer in the current MCP, HTTP viewer and watcher uses a cooperative
cross-process project lock. MCP expectedRevision is compared inside that lock
before loading the proposed changes into the saved map. `CONFLICT` requires a
fresh read and reconsideration of the edit. `BUSY` means another transaction is
active; retry after it completes. There is no background lock polling. Locks are
released on normal completion/error; a confirmed dead PID can be recovered.
An incomplete owner file after an abrupt crash is refused for manual inspection,
not guessed stale from its age.

Low-level library saveMapFile, hand edits, and older running processes do not
participate in this contract. Restart MCP processes and native watchers after
upgrading. Opening a Web surface upgrades services that lack format-2 support;
existing tabs must reconnect with the newly returned URL. Atomic file
replacement alone does not make a caller's stale read/modify/write safe.

Legacy `mmap_remove {pages:[...]}` remains a separately documented batch of file
deletions, with explicit partial success and historical reference behavior. It
does not accept expectedRevision; use per-page deletePage for checked deletion.
It is not a multi-page transaction.

## One-page mixed transactions

`mmap_batch` accepts page, expectedRevision and 1–100 ordered operations. Each
operation is `{op: "declare" | "update" | "remove", data: {...}}`, with the
same per-page fields as that tool. Per-operation page, expectedRevision and
page deletion are excluded. Changes are drafted, the final graph is validated,
and the page is saved once; a refusal preserves the original file bytes.

```json
{
  "page":"payments",
  "expectedRevision":"<revision returned by mmap_read>",
  "operations":[
    {"op":"remove","data":{"edges":[{"from":"api","to":"old-store"}]}},
    {"op":"declare","data":{"nodes":[{"id":"new-store","label":"Store","layer":"base"}]}},
    {"op":"declare","data":{"edges":[{"from":"api","to":"new-store"}]}},
    {"op":"update","data":{"context":{"summary":"Payment services","next":"Verify the new store contract"}}}
  ]
}
```

Machine-readable error codes include NOT_FOUND, INVALID_STORE, REFUSED,
CONFLICT, BUSY, INVALID_CURSOR, INVALID_ARGUMENT, REFERENCED and SAVE_FAILED.
Malformed schema inputs remain MCP invalid-argument errors. Read calls do not
open panels or create page files.

## Checkpoints and source changes

Map context has optional summary and next fields (up to 2,000 characters each).
Save concise decisions and next actions, rather than copying the conversation.
Nodes can hold up to 100 sources: `{path: "src/store.ts", sha256: "..."}`.
Paths are project-relative, forward-slash paths with no traversal. SHA256 is
optional so sources can be linked before verification.

`mmap_read {resource:"changes", page, id}` hashes only the selected node's
listed files, reports currentSha256 and unchanged/changed/unknown node state,
and identifies affected consumers. Missing files count as changed. Missing
baselines, inaccessible files, files over 8 MiB and paths resolving outside
the project remain unverified. There is no whole-repository source scan and
no automatic status change. After verification, copy the current hashes into
sources[].sha256 with a revision-checked update.

Classic maps continue to serialize as format 1. Maps containing context or
source references serialize as format 2; this runtime reads both. Older runtimes
must refuse format 2 instead of silently dropping its new fields. Removing all
extension fields allows serialization as format 1 again. Both formats preserve
the same graph, statuses and existing evidence.

## Project identity

Without an explicit MELLOS_MAPPING_CWD or CLAUDE_PROJECT_DIR, the server walks
up from cwd to the nearest existing map store or Git root. An explicit override
stays explicit. The mmap command and watcher use the same resolver. Nested
repositories and worktrees are boundaries; separate branches are not silently
redirected to a shared writable graph. Carry maps through Git or deliberate
workspace setup when a new worktree needs them, and recheck source baselines.

Codex CLI and App skills both start by reading existing pages. MCP initialization
also advertises the restore workflow, including for MCP-only installations.
Viewer selection follows host capabilities; the CLI does not try to use a
desktop panel tool. After context compaction, repeat the lightweight page/context
read, then load only the affected resources.
