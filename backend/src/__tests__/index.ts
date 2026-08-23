/*
 * Barrel for the test support modules, so another module's suite reaches them
 * through one path (check-cycles requires cross-module imports to go through a
 * barrel). Two concerns sit behind it:
 *
 *   • fixtures.ts — where the committed graphs live, and the import-time
 *     registration that makes them the installed contexts.
 *   • harness.ts  — the store/storage/session scaffolding built on top.
 */
export * from "./fixtures.js";
export * from "./harness.js";
