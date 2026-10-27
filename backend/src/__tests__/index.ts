/*
 * Barrel for the test support modules, so another module's suite reaches them
 * through one path (check-cycles requires cross-module imports to go through a
 * barrel). Two concerns sit behind it:
 *
 *   • fixtures.ts — where the committed graphs live, and the import-time
 *     registration that makes them the installed contexts.
 *   • harness.ts  — the store/storage/session scaffolding built on top.
 *   • idml-template.ts — an invented InDesign template, for the .idml renderer and render_document.
 */
export * from "./fixtures.js";
export * from "./harness.js";
export * from "./synthetic.js";
export * from "./idml-template.js";
