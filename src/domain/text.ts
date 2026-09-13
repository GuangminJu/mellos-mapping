/** Text remains data at every input and display boundary. No host dependencies. */
import type { MellosMap } from './types.js';

// Explicit ranges also work in the JSON Schema published by the MCP adapter.
export const NO_CONTROLS = /^[^\u0000-\u001f\u007f-\u009f]*$/;
export const NO_CONTROLS_TEXT = 'one line of text; control characters (ESC, newline, tab) are not allowed';
export const NO_CONTROLS_BUT_BREAKS = /^[^\u0000-\u0008\u000b-\u001f\u007f-\u009f]*$/;
export const NO_CONTROLS_BUT_BREAKS_TEXT =
  'text with optional newlines (\\n) and tabs; other control characters (ESC, BEL, CR) are not allowed';

export function mapTextError(map: MellosMap): string | undefined {
  const check = (field: string, value: string | undefined, multiline = false): string | undefined =>
    value === undefined || (multiline ? NO_CONTROLS_BUT_BREAKS : NO_CONTROLS).test(value)
      ? undefined : `${field}: ${multiline ? NO_CONTROLS_BUT_BREAKS_TEXT : NO_CONTROLS_TEXT}`;
  let error = check('title', map.title);
  if (error) return error;
  for (const [i, layer] of map.layers.entries()) {
    error = check(`layers[${i}].name`, layer.name);
    if (error) return error;
  }
  for (const name of ['lanes', 'groups'] as const) {
    for (const [i, item] of map[name].entries()) {
      error = check(`${name}[${i}].label`, item.label);
      if (error) return error;
    }
  }
  for (const [i, node] of map.nodes.entries()) {
    for (const name of ['label', 'evidence', 'detail'] as const) {
      // Version-1 files and document exports also support multiline evidence.
      // MCP keeps its narrower one-line evidence input for concise updates.
      error = check(`nodes[${i}].${name}`, node[name], name !== 'label');
      if (error) return error;
    }
  }
  for (const [i, edge] of map.edges.entries()) {
    error = check(`edges[${i}].label`, edge.label);
    if (error) return error;
  }
  return undefined;
}

/** Defensive rendering for maps constructed directly by library consumers. */
export function terminalText(text: string, multiline = false): string {
  return text.replace(multiline ? /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g : /[\u0000-\u001f\u007f-\u009f]/g, '?');
}
