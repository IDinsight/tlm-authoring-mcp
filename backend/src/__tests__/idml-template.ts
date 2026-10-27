/*
 * An INVENTED InDesign template, shared by the renderer's tests and render_document's.
 *
 * A few hand-written XML parts — the smallest an .idml can be and still carry what the renderer
 * reads: styles (some in a group `G1`), a master page with its own story, one sample page the
 * renderer must drop, and the model page with a `label` frame and the `corps` frame. No subject's
 * vocabulary, so the renderer cannot come to depend on one.
 */
import { zip } from "../render/index.js";

const story = (id: string, placeholder: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"><Story Self="${id}"><StoryPreference/>` +
  `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/body"><CharacterStyleRange><Content>${placeholder}</Content></CharacterStyleRange></ParagraphStyleRange></Story></idPkg:Story>`;

const frame = (name: string, storyId: string, widthPt: number) =>
  `<TextFrame Self="f-${storyId}" ParentStory="${storyId}" Name="${name}"><Properties><PathGeometry><GeometryPathType><PathPointArray>` +
  `<PathPointType Anchor="10 0"/><PathPointType Anchor="10 50"/><PathPointType Anchor="${10 + widthPt} 50"/><PathPointType Anchor="${10 + widthPt} 0"/>` +
  `</PathPointArray></GeometryPathType></PathGeometry></Properties></TextFrame>`;

const STYLES =
  `<Styles>` +
  `<ParagraphStyle Self="ParagraphStyle/body"/><ParagraphStyle Self="ParagraphStyle/label"/><ParagraphStyle Self="ParagraphStyle/heading"/>` +
  `<ParagraphStyle Self="ParagraphStyle/G1%3aheading"/>` +
  `<ObjectStyle Self="ObjectStyle/photo" EnableAnchoredObjectOptions="false"></ObjectStyle>` +
  `<ObjectStyle Self="ObjectStyle/icon" EnableAnchoredObjectOptions="true"><AnchoredObjectSetting AnchoredPosition="Anchored"/></ObjectStyle>` +
  `<TableStyle Self="TableStyle/grid"/><CellStyle Self="CellStyle/grid"/><CellStyle Self="CellStyle/G1%3aalert"/>` +
  `</Styles>`;

/** A template with one sample page (to be dropped) and the model page: a `label` frame and `corps`. */
export function inventedTemplate(): Buffer {
  return zip([
    { name: "mimetype", data: Buffer.from("application/vnd.adobe.indesign-idml-package"), store: true },
    {
      name: "designmap.xml",
      data: Buffer.from(
        `<Document StoryList="s-label s-body s-master s-sample">` +
        `<idPkg:Spread src="Spreads/Spread_sample.xml"/><idPkg:Spread src="Spreads/Spread_model.xml"/>` +
        `<idPkg:Story src="Stories/Story_s-label.xml"/><idPkg:Story src="Stories/Story_s-body.xml"/>` +
        `<idPkg:Story src="Stories/Story_s-master.xml"/><idPkg:Story src="Stories/Story_s-sample.xml"/>` +
        `<Section Self="sec" Length="2" Name="" PageStart="p-sample" AlternateLayoutLength="2"/></Document>`,
      ),
    },
    { name: "Resources/Styles.xml", data: Buffer.from(STYLES) },
    { name: "MasterSpreads/MasterSpread_m.xml", data: Buffer.from(`<MasterSpread>${frame("$ID/", "s-master", 100)}</MasterSpread>`) },
    { name: "Spreads/Spread_sample.xml", data: Buffer.from(`<Spread><Page Self="p-sample"/>${frame("note", "s-sample", 100)}</Spread>`) },
    { name: "Spreads/Spread_model.xml", data: Buffer.from(`<Spread><Page Self="p-model"/>${frame("label", "s-label", 100)}${frame("corps", "s-body", 400)}</Spread>`) },
    { name: "Stories/Story_s-label.xml", data: Buffer.from(story("s-label", "LABEL PLACEHOLDER")) },
    { name: "Stories/Story_s-body.xml", data: Buffer.from(story("s-body", "BODY PLACEHOLDER")) },
    { name: "Stories/Story_s-master.xml", data: Buffer.from(story("s-master", "footer")) },
    { name: "Stories/Story_s-sample.xml", data: Buffer.from(story("s-sample", "sample")) },
  ]);
}

/** A PNG header is all the renderer reads of a picture: its size. */
export function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

