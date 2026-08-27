/**
 * Test surface of the repo: the library's own specs, the repo-level packaging
 * specs, and the plain-node launcher specs under scripts/.
 *
 * @module
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'scripts/**/*.test.mjs'],
  },
});
