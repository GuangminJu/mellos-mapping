// src/store/store.ts
import { basename, dirname, join } from "node:path";

// src/domain/types.ts
var ID_RULE = /^[a-z0-9][a-z0-9-]{0,63}$/;
var RANK_MIN = 0;
var RANK_MAX = 99;
var RANK_RULE_TEXT = `an integer in ${RANK_MIN}..${RANK_MAX}, 0 = bottom / most primitive`;

// src/store/store.ts
var STATE_FILE_RELATIVE_PATH = join(".mellos", "map.json");
var PAGES_DIR_NAME = "pages";
var FOCUS_FILE_NAME = "focus";
function focusFilePath(defaultFile) {
  return join(dirname(defaultFile), FOCUS_FILE_NAME);
}
var LEGACY_STATE_FILE_RELATIVE_PATH = join(".claude", "mellos-mapping.json");
export {
  FOCUS_FILE_NAME,
  ID_RULE,
  PAGES_DIR_NAME,
  STATE_FILE_RELATIVE_PATH,
  focusFilePath
};
