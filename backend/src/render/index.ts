/*
 * Module: render — a block tree plus a formatter's geometry, out comes a .docx.
 *
 * The barrel every other module imports through. Nothing here knows about
 * subjects, curricula or Firestore: it takes the tree an authoring model
 * composed and the spec a formatter stack resolved to, and lays out a page.
 */
export { documentSchema, blockSchema, validateDocumentTree, missingMediaNames } from "./document.js";
export type { Block, Cell, Run, ImageRun, DocumentTree } from "./document.js";
export { renderDocx, usableWidthCm, imageSizeCm, floatGutterCm, PAGE_CM } from "./docx.js";
export { rasterizeSvgMedia, rasterizeSvg, isSvg, isPng, mediaPartName, RASTER_LONG_SIDE_PX, type MediaBytes, type RasterRefusal } from "./raster.js";
export { imageSize, imageAspectRatio, type ImageSize } from "./image-size.js";
export { markAnswerCells, bandCells, type AnswerMarkStyle, type AnswerMark } from "./answer-mark.js";
export { detectBandCells, type BandCells } from "./band-cells.js";
export { resolveRenderSpec, type ResolvedSpec, type SpecCarrier } from "./resolve-spec.js";
export { splitByVariant, deriveVariant, hasVariant, type Variant, type TranslateLines } from "./variants.js";
export { measureDocx, warmLayoutEngine, parsePdfFonts, fontAsDeclared, parsePdfInfo, parseBBox, parseWords, parseImages, measurePages, type Measurement, type PageMeasurement, type PageImage, type Overlap, type Gap, type PdfFont } from "./measure.js";
export { readDocx, type ReadDocument, type ReadBlock } from "./read-docx.js";
export { readGeometry, type ExtractedGeometry, type UnnamedFill, type UnnamedHeight } from "./read-geometry.js";
export { proposeEdits, editItems, documentText, normalise, type Proposal, type TextSlot } from "./propose.js";
export { hashContent, sourcesFrom, staleness, type DocumentSource, type Staleness } from "./sources.js";
export { zip, unzip, type ZipEntry } from "./zip.js";
