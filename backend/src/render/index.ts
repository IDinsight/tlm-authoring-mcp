/*
 * Module: render — a block tree plus a formatter's geometry, out comes a .docx.
 *
 * The barrel every other module imports through. Nothing here knows about
 * subjects, curricula or Firestore: it takes the tree an authoring model
 * composed and the spec a formatter stack resolved to, and lays out a page.
 */
export { documentSchema, blockSchema, validateDocumentTree } from "./document.js";
export type { Block, Cell, Run, ImageRun, DocumentTree } from "./document.js";
export { renderDocx } from "./docx.js";
export { resolveRenderSpec, type ResolvedSpec, type SpecCarrier } from "./resolve-spec.js";
export { splitByVariant, deriveVariant, hasVariant, type Variant, type TranslateText } from "./variants.js";
export { measureDocx, parsePdfInfo, parseBBox, type Measurement, type PageMeasurement } from "./measure.js";
export { readDocx, type ReadDocument, type ReadBlock } from "./read-docx.js";
export { proposeEdits, editItems, type Proposal } from "./propose.js";
export { zip, unzip, type ZipEntry } from "./zip.js";
