# Project locking

Map writes have three separate guarantees: atomic file replacement keeps a
reader from seeing half a saved map, a project lock serializes cooperating
writers, and an optional revision check rejects edits computed from stale
data. None of these replaces the others.

## One stable lock for every page

The default page and all named pages use the same fixed regular file,
`.mellos/.write-lock`, for their project.
`withStoreLock` acquires an OS exclusive lock without waiting before reading
the current graph. MCP graph mutations, HTTP viewer mutations and watcher
mutations all use this boundary. A competing writer receives `BUSY` and can
retry after the active operation completes; acquisition does not start a
background poll or queue.

The lock file is independent of the map JSON files. A successful map save
replaces its target through a private sibling temporary file, while the lock
file keeps the same identity. Do not delete, rename or replace the lock file:
doing so can leave processes locking different files for the same project.
Keeping the file after an operation is deliberate; its presence is not proof
that a writer is active.

Normal completion and errors release the lock. When the owning process exits,
including a crash, the OS releases its lock. The new protocol does not use
directory creation, an `owner.json` PID, a `.reap` directory, or elapsed time
to decide ownership or reclaim a lock. Failure to acquire the required OS lock
must not cause a write to continue without it.

## A lock does not validate an earlier read

Each operation loads the current map, checks a supplied `expectedRevision`,
applies its changes and saves while holding the project lock. This prevents
two cooperating writers from both saving independently loaded copies at once.
The lock does not remain held across separate MCP read and write calls.

When an edit depends on data returned by `mmap_read`, include that page's
revision in the write. If another operation changed the map in between, the
write returns `CONFLICT` without applying the edit. Read again, reconsider the
change, and submit it with the new revision. Use `expectedRevision: "absent"`
when declaring a page that must not already exist.

Omitting `expectedRevision` preserves compatibility, but skips that comparison.
For example, if two sessions read the same `context`, revise different parts,
and then write their complete objects without a revision, the later write
replaces the earlier one. The project lock serializes both writes; it cannot
infer which fields the caller intended to preserve.

## Scope

The lock is a contract among participating writers. Hand edits, direct calls
to low-level `saveMapFile`, and older running processes do not acquire this
new lock. A filesystem must support the OS lock used by the runtime; file
replacement alone is not an alternative locking protocol.

The bundled native bindings require Node.js `^18.17.0 || >=20.3.0` (N-API 9).
Releases include bindings for Windows 10+ (Server 2016+ on x64), macOS 13.0+
and Linux with glibc 2.28+, each on x64 and arm64; users do not compile them
during installation. A missing binding or unsupported platform returns
`LOCK_UNAVAILABLE` instead of falling back to directory locks or continuing
without a lock.

macOS 13.0 is the deployment target recorded in both shipped Mach-O addons.
The OS must also meet the selected Node.js version's requirements: for example,
[Node.js 24 requires macOS 13.5+](https://github.com/nodejs/node/blob/v24.0.0/BUILDING.md#platform-list).
The Linux addons require only `libc.so.6`, with maximum symbol versions
`GLIBC_2.14` on x64 and `GLIBC_2.17` on arm64; they have no `GLIBCXX` or `CXXABI`
dependency. The higher glibc 2.28 baseline comes from the supported official
Node.js binaries, which also require kernel 4.18+ and libstdc++ providing
`GLIBCXX_3.4.25`; see the [Node.js 18.17 platform requirements](https://github.com/nodejs/node/blob/v18.17.0/BUILDING.md#platform-list).
The Windows addons import system `KERNEL32.dll` and `ntdll.dll`; the supported
Windows floor follows Node.js, rather than the older PE header version.

Pages organize separate efforts, but share the project lock. This does not
turn legacy `mmap_remove {pages:[...]}` into a multi-page transaction: that API
still reports partial deletion and does not accept `expectedRevision`. Use
per-page `deletePage` for revision-checked deletion. See the
[persistent-map API guide](map-api.md) for the data contract.

## Upgrade from directory locks

Earlier runtimes used a directory named `.mellos/.write-lock`, containing
`owner.json` and sometimes `.reap`. New writers use a regular file at that same
path. If they find a directory there, they return `LOCK_MIGRATION_REQUIRED`.
They do not reclaim it automatically, even when the recorded PID appears dead
or its timestamp is old.

1. Stop every old MCP server, HTTP viewer service and native watcher using this
   project. Updating files or opening a new browser tab does not stop those
   processes. Stop and restart existing HTTP services explicitly; there is no
   hot upgrade of the locking protocol.
   New clients check the viewer's health response for `lockProtocol:
   "os-file-v1"`; an older service returns a migration error on reuse rather
   than silently providing a viewer with different write semantics. Use
   `mellos-mapping-web <project-directory> --stop` before reopening it.
2. Inspect `.mellos/.write-lock`. If it is a **directory**, and all old writers
   have stopped, move that directory to a separate backup location. Preserve
   it for diagnosis. If it is already a **regular file**, leave it in place:
   it belongs to the new protocol and must not be deleted or renamed. If the
   path is absent, no old directory needs moving.
3. Start the updated runtime and retry the operation. It creates the permanent
   regular file if absent, acquires the OS lock and then performs the write.
   Reconnect viewer tabs using the URL returned by the restarted service.

Using the same path prevents old and new writers from silently choosing
different locks. The new runtime's atomic file creation competes with the old
runtime's directory creation. If the old directory wins, the new runtime
requires migration. If the regular file wins, an old writer cannot create its
directory or read `owner.json` beneath the file and returns `BUSY` instead of
writing. Do not remove the new file to make an old client proceed; upgrade and
restart that client.

Do not automate this migration by deleting everything named `.write-lock`.
The old directory and the new permanent file require different treatment.
