/*
 * The formatter's declarative half — schema, authoring-time refusal, and the
 * acceptance test the roadmap sets for it.
 *
 * That acceptance test is the important one: the CI-maths teacher-sheet
 * formatter and the CE1 bilingual session-sheet formatter must BOTH be
 * expressible, "with no key that exists for only one of them and no free-text
 * escape hatch used to carry a value". The two fixtures below are transcribed
 * from the live formatters' own prose, so if the schema cannot hold one of them
 * this suite fails rather than the discovery being made at render time.
 */
import { describe, it, expect } from "vitest";
import { renderSpecSchema, validateRenderSpec, validateRenderInBag } from "../render-spec.js";

// ── The two live formatters, as the schema would hold them ───────────────────

// senegal/ci/maths · "Guide de l'enseignant CI maths — mise en page et
// production de la fiche" (c355281a). Two files per lesson, lines routed by
// prefix; the geometry is fixed and the TEXT yields when a séance overflows.
const CI_MATHS_TEACHER_SHEET = {
  page: { size: "A4", orientation: "portrait", marginsCm: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 } },
  type: { family: "Andika", sizePt: 12, leadingPt: 19.35 },
  budget: {
    linesPerPage: 36,
    lineHeightCm: 0.68,
    maxCharsPerLine: 72,
    maxCharsBesideImage: 52,
    reserveBottomCm: 2,
  },
  blocks: {
    banner: { fullWidth: true, bold: true, border: "none", cellMarginsCm: 0, keepWithNext: true },
    weekCell: { fill: "2EAEE5", textColour: "FFFFFF", bold: true },
    lessonCell: { fill: "57BC49", textColour: "FFFFFF", bold: true },
    dayCell: { fill: "C0504D", textColour: "FFFFFF", bold: true },
    objectiveBanner: { fill: "3E4D9E", textColour: "FFFFFF", bold: true, fullWidth: true },
    materialsBox: { fill: "00B0F0", fullWidth: true },
    sessionBanner: { fill: "09A9E1", textColour: "FFFFFF", bold: true, fullWidth: true },
    phaseBanner: { fill: "79D0F0", textColour: "000000", bold: true, fullWidth: true, keepWithNext: true },
    bullet: { marker: "•", maxChars: 72, maxCharsBesideImage: 52 },
  },
  images: {
    placement: "float-right",
    gutterCm: 0.15,
    maxPerSection: 2,
    caption: false,
    fullWidthAboveAspectRatio: 4,
    inlineHeightCm: { sectionPictogram: 0.5, answerMarker: 0.42 },
  },
  pagination: { oneSectionPerPage: true, pageBreakCarrier: "banner-property" },
  visibility: {
    printedPrefixes: ["[N]", "[FR]", "[WO]", "[IMAGE :"],
    neverPrint: ["unprefixed lines", "image captions", "colour names and hex codes", "specification headings"],
  },
  language: {
    strategy: "per-file",
    variants: [
      { id: "instruction", lang: "fr", colour: "000000", prefix: "[N]", inAllFiles: true },
      { id: "speech-fr", lang: "fr", colour: "C0504D", bold: true, prefix: "[FR]", fileSuffix: "FR" },
      { id: "speech-wo", lang: "wo", colour: "0070C0", bold: true, prefix: "[WO]", fileSuffix: "WO" },
    ],
  },
  overflow: { policy: "tighten-text", neverAdjust: ["margins", "typeSize", "leading"] },
};

// senegal/_catalog · "Layout de la fiche-session bilingue (docx)" (b3ee94c4).
// ONE file, both languages on a line; geometry fixed and the page is allowed to
// run on rather than be compressed.
const CE1_BILINGUAL_SESSION_SHEET = {
  page: { size: "A4", orientation: "portrait", marginsCm: { top: 1.7, right: 2.0, bottom: 1.7, left: 2.0 } },
  type: { family: "Calibri", sizePt: 11, colour: "000000" },
  blocks: {
    sessionHeader: { fill: "D9D9D9", bold: true, fullWidth: true },
    sectionHeader: { fill: "D6EFD6", textColour: "1F7A1F", bold: true, sizePt: 12, fullWidth: true },
    illustrationBrief: { fill: "FFF200" },
    formulatedRule: { fill: "F2F2F2", fullWidth: true },
  },
  pagination: {
    oneSectionPerPage: false,
    footer: { show: true, position: "outer", family: "Calibri", sizePt: 10, colour: "000000", continuous: true },
  },
  language: {
    strategy: "inline",
    separator: " / ",
    variants: [
      { id: "L1", lang: "wo", colour: "1F7A1F" },
      { id: "L2", lang: "fr", colour: "000000" },
    ],
  },
  overflow: { policy: "allow", neverAdjust: ["margins", "leading", "typeSize"] },
};

describe("acceptance — both live formatters are expressible", () => {
  it("holds the CI-maths teacher sheet", () => {
    expect(validateRenderSpec(CI_MATHS_TEACHER_SHEET, "test")).toEqual([]);
  });

  it("holds the CE1 bilingual session sheet", () => {
    expect(validateRenderSpec(CE1_BILINGUAL_SESSION_SHEET, "test")).toEqual([]);
  });

  it("holds them with the SAME keys — no key exists for only one document type", () => {
    // The roadmap's acceptance criterion. Groups either formatter declares are
    // compared against the schema's own vocabulary: every one must be a general
    // concept the other COULD use, not a private extension.
    const schemaGroups = Object.keys(renderSpecSchema.shape);
    const ciGroups = Object.keys(CI_MATHS_TEACHER_SHEET);
    const ce1Groups = Object.keys(CE1_BILINGUAL_SESSION_SHEET);

    expect(schemaGroups).toEqual(expect.arrayContaining([...ciGroups, ...ce1Groups]));

    // Four groups are common ground; the rest are optional and genuinely unused
    // by one of them (CE1 states no measured line budget, CI no page footer).
    // That is silence, not a private key.
    const shared = ciGroups.filter((group) => ce1Groups.includes(group));
    expect(shared.sort()).toEqual(["blocks", "language", "overflow", "page", "pagination", "type"]);
  });

  it("carries the values that differ, which is why they are knobs", () => {
    // If both formatters had to agree, these would be constants in a renderer.
    expect(CI_MATHS_TEACHER_SHEET.language.strategy).toBe("per-file");
    expect(CE1_BILINGUAL_SESSION_SHEET.language.strategy).toBe("inline");
    expect(CI_MATHS_TEACHER_SHEET.overflow.policy).toBe("tighten-text");
    expect(CE1_BILINGUAL_SESSION_SHEET.overflow.policy).toBe("allow");
    expect(CI_MATHS_TEACHER_SHEET.page.marginsCm.top).not.toBe(CE1_BILINGUAL_SESSION_SHEET.page.marginsCm.top);
  });
});

describe("what the schema refuses", () => {
  it("refuses an unknown key — the whole point of validating at authoring time", () => {
    const errors = validateRenderSpec({ page: { size: "A4" }, colours: { green: "1F7A1F" } }, "edit_nodes");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(" ")).toContain("render");
  });

  it("refuses a misspelt key inside a group", () => {
    expect(validateRenderSpec({ page: { size: "A4", marginCm: { top: 2.5 } } }, "edit_nodes")).not.toEqual([]);
  });

  it("refuses a value of the wrong type or shape", () => {
    expect(validateRenderSpec({ type: { family: "Andika", sizePt: "12" } }, "t")).not.toEqual([]);
    expect(validateRenderSpec({ page: { size: "A4ish" } }, "t")).not.toEqual([]);
    expect(validateRenderSpec({ type: { colour: "not-a-colour" } }, "t")).not.toEqual([]);
    expect(validateRenderSpec({ page: { marginsCm: { top: -1 } } }, "t")).not.toEqual([]);
  });

  it("accepts both hex spellings, because both are already in the live graphs", () => {
    expect(validateRenderSpec({ type: { colour: "#1F7A1F" } }, "t")).toEqual([]);
    expect(validateRenderSpec({ type: { colour: "2EAEE5" } }, "t")).toEqual([]);
  });

  it("names the path, so a caller knows which knob is wrong", () => {
    const [error] = validateRenderSpec({ images: { maxPerSection: -2 } }, "edit_nodes");
    expect(error).toContain("edit_nodes:");
    expect(error).toContain("render.images.maxPerSection");
  });
});

describe("coherence rules a type check cannot express", () => {
  it("refuses an inline language layout with no separator", () => {
    const errors = validateRenderInBag(
      { render: { language: { strategy: "inline", variants: [{ id: "L1", lang: "wo" }] } } },
      "edit_nodes",
    );
    expect(errors.join(" ")).toContain("separator");
  });

  it("refuses a per-file layout whose variants cannot be routed", () => {
    const errors = validateRenderInBag(
      { render: { language: { strategy: "per-file", variants: [{ id: "fr", lang: "fr" }] } } },
      "edit_nodes",
    );
    expect(errors.join(" ")).toContain("prefix");
  });

  it("accepts the CI-maths per-file block, whose variants ARE routable", () => {
    expect(validateRenderInBag({ render: CI_MATHS_TEACHER_SHEET }, "edit_nodes")).toEqual([]);
  });

  it("refuses a language block with no strategy", () => {
    const errors = validateRenderInBag({ render: { language: { variants: [{ id: "L1", lang: "wo" }] } } }, "t");
    expect(errors.join(" ")).toContain("strategy");
  });
});

describe("partial amendment through the dotted bag", () => {
  it("validates a dotted branch as the branch it names", () => {
    expect(validateRenderInBag({ "render.page": { size: "A4" } }, "edit_nodes")).toEqual([]);
    expect(validateRenderInBag({ "render.page": { size: "Foolscap" } }, "edit_nodes")).not.toEqual([]);
  });

  it("lets a caller amend ONE knob without restating the whole formatter", () => {
    // edit_nodes merges nested, so this is a legitimate edit — and the reason
    // every field in the schema is optional.
    expect(validateRenderInBag({ "render.budget.maxCharsPerLine": 68 }, "edit_nodes")).toEqual([]);
    expect(validateRenderInBag({ "render.page.marginsCm": { left: 3 } }, "edit_nodes")).toEqual([]);
  });

  it("catches a typo in a dotted path rather than writing it blindly", () => {
    expect(validateRenderInBag({ "render.budget.maxCharsPerLien": 68 }, "edit_nodes")).not.toEqual([]);
  });

  it("ignores bag entries that are not render", () => {
    expect(validateRenderInBag({ "metadata.assemblyGuide": "…", content: "…" }, "edit_nodes")).toEqual([]);
  });
});
