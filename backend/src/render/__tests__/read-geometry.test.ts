/*
 * Reading a document's geometry back out.
 *
 * The strongest test available is a ROUND TRIP: declare a spec, render a page
 * from it, read the geometry back, and get the same numbers. That checks the
 * writer and the reader against each other rather than against one hand-typed
 * fixture, so a shared misunderstanding of a unit shows up as a mismatch.
 *
 * The rest of the suite pins the JUDGEMENT calls, which are the parts a future
 * change could quietly get wrong: the docDefaults-vs-Normal precedence that
 * put the wrong margins in two design notes for a fortnight, and the refusal to
 * invent a name for a fill or a picture role.
 */
import { describe, it, expect } from "vitest";
import { readGeometry } from "../read-geometry.js";
import { renderDocx } from "../docx.js";
import { zip } from "../zip.js";
import type { RenderSpec } from "../../kg-recipes/index.js";
import type { DocumentTree } from "../document.js";

// The live CI-maths gabarit, which is what this was written to recover.
const GABARIT: RenderSpec = {
  page: { size: "A4", orientation: "portrait", marginsCm: { top: 1.22, bottom: 1.07, left: 1.27, right: 1.27 } },
  type: { family: "Andika", sizePt: 12, leadingPt: 14, leadingRule: "exact" },
  blocks: { banner: { fill: "2EAEE5", textColour: "FFFFFF", bold: true } },
  pagination: { oneSectionPerPage: true, pageBreakCarrier: "banner-property" },
};

const PAGE: DocumentTree = {
  blocks: [
    { kind: "table", rows: [[{ blocks: [{ kind: "line", runs: [{ text: "Semaine 2" }] }], style: "banner" }]] },
    { kind: "line", runs: [{ text: "E. pose deux bâtonnets sur la table." }] },
  ],
  media: [],
};

/** A minimal .docx carrying just the two parts the reader looks at. */
function docxWith(documentXml: string, stylesXml: string): Buffer {
  return zip([
    { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") },
    { name: "word/styles.xml", data: Buffer.from(stylesXml, "utf8") },
  ]);
}

const body = (inner: string) =>
  `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${inner}</w:body></w:document>`;

describe("a rendered page reads its own geometry back", () => {
  it("round-trips page and type through the renderer", () => {
    const bytes = renderDocx(PAGE, GABARIT);
    const { spec } = readGeometry(bytes);

    expect(spec.page).toEqual(GABARIT.page);
    // The renderer writes no `colour` when the spec's is the default black, so
    // compare the fields the file actually carries rather than the whole bag.
    expect(spec.type?.family).toBe("Andika");
    expect(spec.type?.sizePt).toBe(12);
    expect(spec.type?.leadingPt).toBe(14);
    expect(spec.type?.leadingRule).toBe("exact");
  });

  it("recovers the fill as an UNNAMED candidate, never as a blocks key", () => {
    const { spec, unnamed } = readGeometry(renderDocx(PAGE, GABARIT));

    // The document says 2EAEE5 and nothing more; only the spec knows it is
    // "banner", and inventing that name is what this must not do.
    expect(unnamed.fills.map((f) => f.hex)).toContain("2EAEE5");
    expect(spec.blocks).toBeUndefined();
  });
});

describe("the docDefaults trap", () => {
  // Reading docDefaults alone on the real corpus yields 11 pt / automatic where
  // the applied style is 12 pt at 14 pt exact. Two design notes carried the
  // wrong numbers for a fortnight on exactly this.
  const styles = `<w:styles xmlns:w="x">
    <w:docDefaults><w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Calibri"/><w:sz w:val="22"/>
    </w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>
      <w:spacing w:line="276" w:lineRule="auto"/>
    </w:pPr></w:pPrDefault></w:docDefaults>
    <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>
      <w:pPr><w:spacing w:line="280" w:lineRule="exact"/></w:pPr>
      <w:rPr><w:rFonts w:ascii="Andika"/><w:sz w:val="24"/></w:rPr>
    </w:style></w:styles>`;

  it("prefers the default paragraph style over docDefaults", () => {
    const { spec } = readGeometry(docxWith(body("<w:p/>"), styles));

    expect(spec.type).toMatchObject({
      family: "Andika", sizePt: 12, leadingPt: 14, leadingRule: "exact",
    });
  });

  it("still falls back to docDefaults for a field the style omits", () => {
    const onlyLeading = `<w:styles xmlns:w="x">
      <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Andika"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
      <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
        <w:pPr><w:spacing w:line="280" w:lineRule="exact"/></w:pPr>
      </w:style></w:styles>`;
    const { spec } = readGeometry(docxWith(body("<w:p/>"), onlyLeading));

    // Leading from the style, family and size from docDefaults: each field
    // falls back on its own, which a whole-block "first wins" would break.
    expect(spec.type).toMatchObject({ family: "Andika", sizePt: 12, leadingPt: 14 });
  });
});

describe("what it refuses to guess", () => {
  it("names a theme font as unreadable rather than transcribing it", () => {
    const themed = `<w:styles xmlns:w="x"><w:docDefaults><w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="minorHAnsi"/><w:sz w:val="22"/>
    </w:rPr></w:rPrDefault></w:docDefaults></w:styles>`;
    const { spec, notes } = readGeometry(docxWith(body("<w:p/>"), themed));

    expect(spec.type?.family).toBeUndefined();
    expect(notes.join(" ")).toMatch(/theme reference/);
  });

  it("leaves an unnamed page size unset and says so", () => {
    const odd = body('<w:sectPr><w:pgSz w:w="9000" w:h="12000"/></w:sectPr>');
    const { spec, notes } = readGeometry(docxWith(odd, ""));

    expect(spec.page?.size).toBeUndefined();
    expect(notes.join(" ")).toMatch(/not one of the named sizes/);
  });

  it("always says which groups a document cannot hold at all", () => {
    const { notes } = readGeometry(renderDocx(PAGE, GABARIT));

    // Silence on these would read as "nothing to declare" when the truth is
    // "not knowable from a page".
    const all = notes.join(" ");
    for (const group of ["budget", "visibility", "overflow", "language.variants"]) {
      expect(all).toContain(group);
    }
  });

  it("reports ambiguous leading when the file declares no rule", () => {
    const noRule = `<w:styles xmlns:w="x"><w:style w:type="paragraph" w:default="1" w:styleId="Normal">
      <w:pPr><w:spacing w:line="310"/></w:pPr></w:style></w:styles>`;
    const { spec, notes } = readGeometry(docxWith(body("<w:p/>"), noRule));

    expect(spec.type?.leadingPt).toBe(15.5);
    expect(spec.type?.leadingRule).toBeUndefined();
    // "exact" crops an inline picture, "atLeast" does not — 15.5 alone cannot
    // say which, and that difference once flattened every band to 5 mm.
    expect(notes.join(" ")).toMatch(/ambiguous/);
  });
});

describe("page break carrier", () => {
  it("reads a property-carried break, and flags a document that mixes both", () => {
    const mixed = body(
      '<w:p><w:pPr><w:pageBreakBefore/></w:pPr></w:p>'.repeat(3) +
      '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
    );
    const { spec, notes } = readGeometry(docxWith(mixed, ""));

    expect(spec.pagination?.pageBreakCarrier).toBe("banner-property");
    expect(notes.join(" ")).toMatch(/BOTH ways/);
  });
});

describe("it refuses bytes that are not a document", () => {
  it("says what is missing rather than throwing a zip error", () => {
    const noDocument = zip([{ name: "word/styles.xml", data: Buffer.from("<w:styles/>", "utf8") }]);
    expect(() => readGeometry(noDocument)).toThrow(/no word\/document\.xml/);
  });
});
