/** MCP metadata and schemas. Factories keep JSON Schema fields independent. */
import { z } from 'zod';
import { ID_RULE, ID_RULE_TEXT, NODE_STATUSES, MAP_KINDS, RANK_MIN, RANK_MAX, RANK_RULE_TEXT } from '../domain/types.js';
import { NO_CONTROLS, NO_CONTROLS_TEXT, NO_CONTROLS_BUT_BREAKS, NO_CONTROLS_BUT_BREAKS_TEXT } from '../domain/text.js';
import { MAPPING_POLICIES, POLICY_SCOPES, describeMappingPolicy } from '../store/policy.js';
import { ZOOM_MIN, ZOOM_MAX } from '../render/render.js';
// ---------------------------------------------------------------------------
// the advertised schema — what a model reads BEFORE it calls
// ---------------------------------------------------------------------------
//
// Every rule stated here is the domain's rule, imported rather than retyped:
// a schema that accepts what the domain refuses (or refuses what it accepts)
// teaches the caller a grammar the ledger does not have.
//
// Every field builds its OWN schema instance, which is not a style choice.
// The SDK converts these shapes with zod-to-json-schema, which dedupes
// identical instances into `$ref` pointers back to the first occurrence. One
// shared id instance therefore advertised sixteen id fields as pointers to
// `page` — a node id documented to the model as "the page this call targets".
// Factories cost one object per field and keep every description on the field
// it describes.

/** Length budgets of the free-text fields, in one place so no two surfaces drift. */
const TITLE_MAX = 120;
const LABEL_MAX = 60;
const DETAIL_MAX = 600;
const EVIDENCE_MAX = 200;
const EDGE_LABEL_MAX = 80;

/** A slug field — the shared id grammar of the whole system, with this field's own words. */
function id(description: string): z.ZodString {
  return z.string().regex(ID_RULE, ID_RULE_TEXT).describe(description);
}

const PAGE_DESCRIPTION =
  'page (parallel map) this call targets; omit for the default page. ' +
  'One effort = one page: start a NEW effort on its own page named after the effort, ' +
  'so concurrent sessions never write over each other and the pane can switch between pages.';

function page(): z.ZodOptional<z.ZodString> {
  return id(PAGE_DESCRIPTION).optional();
}

const STATUS_VOCABULARY =
  'planned = ghost on the map; in-progress = spinner; done = verified; regressed = was done, now broken';

/** @param note - what this particular field does with the shared vocabulary. */
function status(note: string) {
  return z.enum(NODE_STATUSES).describe(`${note}. ${STATUS_VOCABULARY}`);
}

function nodeKind(): z.ZodString {
  return id(
    'node kind rendered as a glyph prefix. Known: selector | sequence | parallel | decorator | ' +
      'condition | action (behavior trees); source | transform | sink (dataflow); ' +
      'service | db | queue | ui (architecture). Unknown kinds are kept and shown in the detail panel.',
  );
}

function mapKind() {
  return z
    .enum(MAP_KINDS)
    .describe(
      'diagram kind. dev (default) = the live progress ledger with status skins. ' +
        'The rest are documentation diagrams rendered neutrally: architecture (layered components; ' +
        'also fits call graphs and module dependencies), dataflow (source→transform→sink, stages as layers), ' +
        'behavior-tree (root on top, leaves at the bottom; also fits mind maps and WBS), ' +
        'sequence (classic call/return: rank = time step with rank 0 = EARLIEST, drawn top-down; ' +
        'declare lanes as participants and make every call AND every return its own event node in ' +
        "the acting participant's lane, edges labeled with the message). " +
        'State machines are unsupported: cycles cannot enter a Mellos map.',
    );
}

/**
 * A band's position. Range and integrality come from the domain (makeRank),
 * which refuses anything this schema lets through anyway; the schema only
 * lets the caller see the rule before it calls.
 */
function rank(): z.ZodNumber {
  return z
    .number()
    .int()
    .min(RANK_MIN)
    .max(RANK_MAX)
    .describe(`${RANK_RULE_TEXT}; must be unique among the map's bands`);
}

function edgeEnds(): { from: z.ZodString; to: z.ZodString } {
  return {
    from: id('the node that USES the other (must live on a higher layer)'),
    to: id('the node being used (must live on a strictly lower layer)'),
  };
}

/**
 * One line of free text — a title, a label, a band name, an evidence note.
 * An empty string is refused: an optional field is cleared with null (the
 * domain's rule for every clearable field), never with a blank that renders
 * as an anonymous box nobody can tell from a real one.
 */
function line(max: number, description: string): z.ZodString {
  return z.string().min(1).max(max).regex(NO_CONTROLS, NO_CONTROLS_TEXT).describe(description);
}

/** A multi-line note, wrapped and re-indented by whatever panel shows it. */
function note(max: number, description: string): z.ZodString {
  return z.string().min(1).max(max).regex(NO_CONTROLS_BUT_BREAKS, NO_CONTROLS_BUT_BREAKS_TEXT).describe(description);
}

/**
 * An object that REFUSES unknown keys instead of silently dropping them.
 *
 * The advertised JSON Schema prints `additionalProperties: false` for every
 * object in this surface, but a raw shape is wrapped by the SDK in a
 * STRIPPING z.object — so a misspelled `evidance` used to vanish without a
 * word, and the ledger recorded a `done` with no evidence on it. Strict
 * objects make the runtime keep the promise the schema prints, and the
 * refusal names the offending key.
 */
function closed<T extends z.ZodRawShape>(shape: T): z.ZodObject<T, 'strict'> {
  return z.object(shape).strict();
}


export function declareTool() {
  return {
      title: 'Declare map structure',
      description:
        'Grow the Mellos map: set the title and diagram kind, add layer bands, lanes and groups ' +
        '(labeled subsystems within ONE band — declare them when a single band grows crowded, ' +
        'roughly five or more nodes in that band; a group must be a strict subset of its band, ' +
        'and a map spread thin across many bands needs none), add nodes, add dependency edges. Declare the ' +
        'whole ghost design up front, then grow it as understanding deepens. Edges must point ' +
        'strictly downward (a node may only use nodes on lower layers); the batch is all-or-nothing. ' +
        'The title lives here and only here: pass it again to replace it, or null to remove it. ' +
        'Revising what already exists (moving, renaming, relabeling, clearing) is mmap_update.',
      inputSchema: closed({
        page: page(),
        title: line(TITLE_MAX, 'map title, e.g. the feature being built; null removes it')
          .nullable()
          .optional(),
        kind: mapKind().optional(),
        lanes: z
          .array(
            closed({
              id: id('stable kebab-case identifier of the lane'),
              label: line(LABEL_MAX, 'column name, e.g. a sequence participant'),
            }),
          )
          .optional()
          .describe('vertical columns crossing all bands; declaration order = left-to-right'),
        layers: z
          .array(
            closed({
              id: id('stable kebab-case identifier of the band'),
              name: line(LABEL_MAX, 'display name of the band'),
              rank: rank(),
            }),
          )
          .optional(),
        groups: z
          .array(
            closed({
              id: id('stable kebab-case identifier of the group'),
              label: line(LABEL_MAX, 'subsystem name shown at the far zoom'),
              layer: id('band this group clusters; members must live on the same band'),
            }),
          )
          .optional(),
        nodes: z
          .array(
            closed({
              id: id('stable kebab-case identifier of the node'),
              label: line(LABEL_MAX, 'display label inside the box'),
              layer: id('id of the band this node lives in'),
              status: status('defaults to planned').optional(),
              evidence: line(
                EVIDENCE_MAX,
                'how an already-verified node was verified; for regressed: what broke. ' +
                  'Declaring a node straight to done needs it as much as updating one does.',
              ).optional(),
              detail: note(
                DETAIL_MAX,
                'design notes shown in the pane detail panel: responsibility, contract, key decisions',
              ).optional(),
              group: id('same-band group this node belongs to').optional(),
              kind: nodeKind().optional(),
              lane: id('lane (column) this node belongs to').optional(),
              submap: id(
                'page slug of this node\'s child map — the pane badges the node ⊞ and double-click ' +
                  'dives in. Declare the child page separately. Create a sub-map only when the ' +
                  "node's internals genuinely deserve their own picture; most nodes need none.",
              ).optional(),
            }),
          )
          .optional(),
        edges: z
          .array(
            closed({
              ...edgeEnds(),
              label: line(EDGE_LABEL_MAX, 'what flows along the edge').optional(),
            }),
          )
          .optional(),
      }),
    };
}

export function updateTool() {
  return {
      title: 'Record progress and revise the map',
      description:
        'The revision tool, all-or-nothing. Record progress on nodes: in-progress when starting a ' +
        'node (the pane spins), done with evidence when its verification passes, regressed with ' +
        'evidence when a done node breaks. Revise what the ghost design got wrong: move a node to ' +
        'another band, join or leave a group or lane, rename a band (or re-rank it, which reorders ' +
        'the whole map), relabel a group or a lane. Every clearable field takes null to empty it — ' +
        'that is how a field is cleared, never an empty string. Bands, groups and lanes are applied ' +
        'before the node updates, and within one node update `layer` moves the node before its ' +
        'other fields. The map is a ledger: report honestly, it never blocks you.',
      inputSchema: closed({
        page: page(),
        updates: z
          .array(
            closed({
              id: id('id of the node to update'),
              status: status('the status to record').optional(),
              label: line(LABEL_MAX, 'new display label inside the box').optional(),
              evidence: line(EVIDENCE_MAX, 'for done: how it was verified; for regressed: what broke; null clears it')
                .nullable()
                .optional(),
              detail: note(
                DETAIL_MAX,
                'design notes shown in the pane detail panel: responsibility, contract, key decisions; ' +
                  'null clears them',
              )
                .nullable()
                .optional(),
              layer: id(
                "move the node to this band; applied before this item's other fields, so a node can " +
                  'move and join a group on the new band in one item. Every edge touching it must still ' +
                  "point strictly downward, and a grouped node may only move to its group's band.",
              ).optional(),
              group: id('join this same-band group; null leaves the current group').nullable().optional(),
              kind: nodeKind().nullable().optional(),
              lane: id('join this lane; null leaves the current lane').nullable().optional(),
              submap: id('link a child map page by slug; null unlinks it').nullable().optional(),
            }),
          )
          .min(1)
          .optional(),
        layers: z
          .array(
            closed({
              id: id('id of the band to revise'),
              name: line(LABEL_MAX, 'new display name of the band').optional(),
              rank: rank().optional(),
            }),
          )
          .min(1)
          .optional()
          .describe('rename and/or re-rank existing bands; an item must carry a name, a rank, or both'),
        groups: z
          .array(closed({ id: id('id of the group to relabel'), label: line(LABEL_MAX, 'new subsystem name') }))
          .min(1)
          .optional()
          .describe('relabel existing groups; membership and band are untouched'),
        lanes: z
          .array(closed({ id: id('id of the lane to relabel'), label: line(LABEL_MAX, 'new column name') }))
          .min(1)
          .optional()
          .describe('relabel existing lanes; order and membership are untouched'),
      }),
    };
}

export function removeTool() {
  return {
      title: 'Revise the map',
      description:
        'Remove edges, nodes, groups and empty layer bands (in that order, all-or-nothing). ' +
        'Removing a node also removes every edge touching it; removing a group merely ungroups ' +
        'its members. Use when the ghost design turns out wrong — the map is a hypothesis, ' +
        'revising it is honest work. ' +
        '`pages` is the other scale: it DELETES whole page files, so a finished effort can be ' +
        'cleaned up instead of accumulating tabs forever. A bare `{pages: ["slug"]}` with no ' +
        'other field is the normal form; combined with map edits, the edits are applied first ' +
        'and the pages are deleted after. The deletion is permanent and cannot be undone, so ' +
        'delete only pages whose effort is over — and only ever with the user behind it. ' +
        'An unknown slug is refused with the project\'s real page list (naming a page that does ' +
        'not exist is a typo, not a request). The default page has no slug and is not deletable ' +
        'here. A node elsewhere still pointing at a deleted page with `submap` stays legal — a ' +
        'submap reference has no existence invariant — but it has nowhere to dive until the ' +
        'page comes back.',
      inputSchema: closed({
        page: page(),
        edges: z.array(closed(edgeEnds())).optional(),
        nodes: z.array(id('id of the node to remove, with every edge touching it')).optional(),
        groups: z.array(id('id of the group to remove; members stay, merely ungrouped')).optional(),
        lanes: z.array(id('id of the lane to remove; members stay, merely off-lane')).optional(),
        layers: z.array(id('id of the band to remove; it must hold no nodes and no groups')).optional(),
        pages: z
          .array(
            id(
              'slug of a page whose WHOLE map file is deleted — the page and everything drawn on ' +
                'it. Not the page this same call targets with `page`.',
            ),
          )
          .optional()
          .describe('pages to delete entirely, after this call\'s map edits; permanent'),
      }),
    };
}

export function setupTool() {
  return {
      title: 'Configure when maps open',
      description:
        'Get or set the mapping policy — WHEN the assistant opens a Mellos map. ' +
        'Call with no arguments to read it: the reply names the policy chosen for the USER ' +
        '(every project), the one this PROJECT overrides it with if any, and which of them is ' +
        'in effect. If it reports "not set", ask the USER to choose (never pick for them): ' +
        'always = ' +
        describeMappingPolicy('always') +
        '; complex = ' +
        describeMappingPolicy('complex') +
        '; on-request = ' +
        describeMappingPolicy('on-request') +
        '. Then call again with their choice to persist it. It defaults to user scope, which ' +
        'is the normal one — the question is about how someone works, so it is asked once ever, ' +
        'not once per repository. Pass scope: "project" only when the user wants THIS project ' +
        'to differ from that habit. The policy guides you; it never blocks the tools, and an ' +
        'explicit user request for a map always wins.',
      inputSchema: closed({
        policy: z
          .enum(MAPPING_POLICIES)
          .optional()
          .describe("the user's choice to persist; omit to read the current policy"),
        scope: z
          .enum(POLICY_SCOPES)
          .optional()
          .describe(
            'where to record the choice: "user" (default) applies to every project this user ' +
              'opens; "project" overrides that for this project alone. Ignored when reading.',
          ),
      }),
    };
}

export function viewTool() {
  return {
      title: 'View the current map',
      description:
        'Render the current Mellos map as monochrome text — the same picture the split-pane ' +
        'watcher shows live. Use it to check the map state or to show it inline in conversation. ' +
        'Every response ends with a `pages:` line naming the pages this project actually has and ' +
        'which one you are looking at, so this is also how you discover whether a map exists at ' +
        'all and under which slugs — never probe the files.',
      inputSchema: closed({
        page: page(),
        zoom: z
          .number()
          .int()
          .min(ZOOM_MIN)
          .max(ZOOM_MAX)
          .optional()
          .describe('zoom ladder: 1 = detail (notes unfold), 0 = standard (default), -1..-3 = scaled down, -4 = overview glyphs'),
      }),
    };
}

export function openTool() {
  return {
      title: 'Open the map pane',
      description:
        'For automatic display beside the current ChatGPT desktop conversation in Codex mode, use surface: "web-terminal", then call open_in_codex with the returned browser hostOpen object. No paste or Computer Use is needed. For the native host terminal, use surface: "codex-terminal": prepare absolute watcher commands for the current project, then ask the host to open its right terminal. This does not launch the watcher or type into that terminal. Agent exec PTYs cannot be attached using their numeric session ids. ' +
        'For a document panel, use surface: "markdown": generate MD + SVG files, ' +
        'enable automatic preview updates after successful map writes, then use the HOST file-opening ' +
        'tool to display the returned absolute Markdown path on the right of the current conversation. ' +
        'Generated does not mean visible: this server cannot open or observe the desktop side panel. ' +
        'For interactive maps, choose surface: "web": start or reuse a project-local web viewer and pass the returned URL to the host browser-opening tool. Markdown and terminal remain available. ' +
        'The default surface is "terminal", preserving the terminal workflow. ' +
        'Put the live map on the user\'s screen: a terminal pane beside this conversation that ' +
        'redraws on every write. Call it whenever a result says `pane: CLOSED` — and do NOT ask ' +
        'permission first, because a user who has set a mapping policy has already said they ' +
        'want to see the map. With a pane already open this RETARGETS it to `page` instead of ' +
        'opening a second one, so it is also how you show the user a particular page when they ' +
        'ask for one. It never closes a pane: taking the map off the screen belongs to the user ' +
        '(the `q` key in the pane, or typing `mmap` in a terminal). The reply says whether a ' +
        'pane actually reported itself in afterwards, not merely that a command was run. ' +
        'Automatic terminal opening supports Windows Terminal and tmux on Linux/macOS. ' +
        'If opening fails, relay the reason and copyable command; retry only after the environment changes or the user asks.',
      inputSchema: closed({
        surface: z.enum(['terminal', 'codex-terminal', 'markdown', 'web', 'web-terminal']).optional().describe('web-terminal = automatically started mmap terminal in a local browser page; codex-terminal = prepare a command for the desktop host terminal; web = local browser viewer; markdown = MD/SVG; terminal = Windows Terminal or tmux launcher (default)'),
        page: id(
          'page to show first — the page THIS effort lives on, the same slug you pass to the ' +
            'other tools. Omit only for the default page: without it a fresh pane opens on ' +
            'whichever page was written last, which after a gap is rarely the one under discussion.',
        ).optional(),
        window: z
          .boolean()
          .optional()
          .describe(
            'open the map in its own "mellos-mapping" window (a new tmux window on Linux/macOS) instead of splitting this ' +
              'conversation\'s window. Pass it only when the user asked for the map separate ' +
              '(a second monitor, a small screen); the split is the default because the map is ' +
              'meant to sit beside what it describes.',
          ),
      }),
    };
}
