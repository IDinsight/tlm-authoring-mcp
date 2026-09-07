/*
 * Layer: services · module: translation — barrel.
 *
 * Gemini-backed FR↔Wolof translation. The server layer imports only from here.
 */
export { translate, usableTerms } from "./gemini.js";
export { translateBatch, MAX_BATCH } from "./batch.js";
export type { BatchItem, BatchInput } from "./batch.js";
export type { TranslateDirection, TranslateInput, TranslateResult, GlossaryTerm } from "./gemini.js";
