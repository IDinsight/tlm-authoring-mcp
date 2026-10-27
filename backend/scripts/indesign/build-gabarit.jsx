// Turn a copy of the pilot pupil book into a styled template.
// The pilot is opened, immediately re-saved under gabarit/, and only the copy is changed.
//
// Why a script and not hand work: there is no designer on this, and a template made by hand cannot
// be rebuilt when the pilot changes. See docs/design-notes/indesign-export/README.md, « Template
// checklist », for what this produces and what is still to check by eye.
//
// Runs inside InDesign (ExtendScript), from a Mac with InDesign 2026:
//   osascript -e 'with timeout of 3000 seconds' \
//     -e 'tell application "Adobe InDesign 2026" to do script (POSIX file "<abs path>/build-gabarit.jsx") language javascript' \
//     -e 'end timeout'
// Writes gabarit/: gabarit-eleve.indd, .indt, .idml, apercu*.jpg (pages 2, 4 and the model page)
// and rapport.txt. Set PILOT_DIR to wherever the pilot folder sits.
app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

var PILOT_DIR = "/Users/karimouba/Downloads/Dossier Pilote Maths OE 3 1 à 10/";
var OUT_DIR = PILOT_DIR + "gabarit/";
var report = [];
function say(line) { report.push(line); }

// Master page → domain group. Integration masters share their domain's colour.
var DOMAIN_OF_MASTER = { "A-AN": "AN", "E-INT AN": "AN", "B-Géo": "GEO", "F-INT GEO": "GEO", "C-Mesure": "MESURE", "D-RP": "RP", "A-Gabarit": "AN" };
var SWATCH_RENAMES = [["C=75 M=5 J=100 N=0", "Geometrie"], ["ANPA 736-0 AdPro", "Mesure"], ["c57m47y46k36", "Resolution de problemes"]];
var DOMAIN_SWATCH = { "AN": "Activite Numerique", "GEO": "Geometrie", "MESURE": "Mesure", "RP": "Resolution de problemes" };
var DOMAINS = ["AN", "GEO", "MESURE", "RP"];
var PARAGRAPH_STYLES = ["numero-lecon", "titre-lecon", "question-orale", "directive", "evaluation", "etiquette", "pied-de-page"];
var STYLE_CATEGORIES = ["enableFill", "enableStroke", "enableStrokeAndCornerOptions", "enableParagraphStyle", "enableTextFrameGeneralOptions", "enableTextFrameBaselineOptions", "enableTextFrameAutoSizingOptions", "enableTextFrameColumnRuleOptions", "enableTextFrameFootnoteOptions", "enableStoryOptions", "enableTextWrapAndOthers", "enableAnchoredObjectOptions", "enableFrameFittingOptions", "enableObjectExportAltTextOptions", "enableObjectExportTaggedPdfOptions", "enableObjectExportEpubOptions", "enableTransparency", "enableDropShadow", "enableFeather", "enableInnerShadow", "enableOuterGlow", "enableInnerGlow", "enableBevelEmboss", "enableSatin", "enableDirectionalFeather", "enableGradientFeather", "enableStrokeTransparency", "enableStrokeDropShadow", "enableStrokeFeather", "enableStrokeInnerShadow", "enableStrokeOuterGlow", "enableStrokeInnerGlow", "enableStrokeBevelEmboss", "enableStrokeSatin", "enableStrokeDirectionalFeather", "enableStrokeGradientFeather", "enableFillTransparency", "enableFillDropShadow", "enableFillFeather", "enableFillInnerShadow", "enableFillOuterGlow", "enableFillInnerGlow", "enableFillBevelEmboss", "enableFillSatin", "enableFillDirectionalFeather", "enableFillGradientFeather", "enableContentTransparency", "enableContentDropShadow", "enableContentFeather", "enableContentInnerShadow", "enableContentOuterGlow", "enableContentInnerGlow", "enableContentBevelEmboss", "enableContentSatin", "enableContentDirectionalFeather", "enableContentGradientFeather", "enableDimensionsAttributes", "enablePositionAttributes"];
var PARA_KEYS = ["appliedFont", "fontStyle", "pointSize", "leading", "fillColor", "justification", "capitalization", "tracking", "spaceBefore", "spaceAfter", "leftIndent", "rightIndent", "firstLineIndent", "hyphenation", "verticalJustification"];

function nameOf(x) { try { return x.name; } catch (e) { return ""; } }
function domainOf(page) {
  var master = page.appliedMaster ? page.appliedMaster.name : "";
  return DOMAIN_OF_MASTER[master] || null;
}

// Which kind of text a frame on a lesson page holds — read from where it sits and how it looks.
function classify(frame, page) {
  var b = frame.geometricBounds; // [top, left, bottom, right] in mm, page origin
  var top = b[0], left = b[1], height = b[2] - b[0], width = b[3] - b[1];
  var first = frame.paragraphs[0];
  var white = nameOf(first.fillColor) === "Paper";
  var filled = nameOf(frame.fillColor) !== "None";
  if (top < 21 && /Leso|Leçon/.test(String(frame.contents))) return "numero-lecon";
  if (top < 21 && filled) return "titre-lecon";
  if (white) return "evaluation";
  if (height < 8 && width < 30) return "etiquette";
  if (top < 72 && width < 110) return "question-orale";
  return "directive";
}

var pilot = app.open(File(PILOT_DIR + "Pilote Maths OE 3 1 à 10.indd"), false);
pilot.save(File(OUT_DIR + "gabarit-eleve.indd"));
var doc = pilot; // from here on, the open document IS the copy
doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.MILLIMETERS;
doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.MILLIMETERS;
doc.viewPreferences.rulerOrigin = RulerOrigin.PAGE_ORIGIN;

try {
  // 1. Domain colours get names.
  for (var s = 0; s < SWATCH_RENAMES.length; s++) {
    var sw = doc.swatches.itemByName(SWATCH_RENAMES[s][0]);
    if (sw.isValid) { sw.name = SWATCH_RENAMES[s][1]; say("colour renamed: " + SWATCH_RENAMES[s][0] + " → " + SWATCH_RENAMES[s][1]); }
    else say("colour NOT FOUND: " + SWATCH_RENAMES[s][0]);
  }

  // 2. Classify every text frame on the lesson pages; keep the first of each kind as the sample.
  var framesByKind = {}, samples = {}, headerTint = {};
  for (var k = 0; k < PARAGRAPH_STYLES.length; k++) framesByKind[PARAGRAPH_STYLES[k]] = [];
  for (var p = 1; p < doc.pages.length; p++) { // page 1 is the cover
    var page = doc.pages[p];
    // allPageItems reaches frames inside groups too: the picture labels live there.
    var items = page.allPageItems;
    for (var f = 0; f < items.length; f++) {
      var tf = items[f];
      if (!(tf instanceof TextFrame)) continue;
      if (!tf.contents || !String(tf.contents).replace(/\s/g, "").length) continue;
      var kind = classify(tf, page);
      framesByKind[kind].push({ frame: tf, page: page });
      if (!samples[kind]) samples[kind] = tf.paragraphs[0];
      if (kind === "titre-lecon") {
        var d = domainOf(page);
        if (d && headerTint[d] === undefined) headerTint[d] = tf.fillTint;
      }
    }
  }
  // The footer lives on the masters.
  var footerFrames = [];
  for (var m = 0; m < doc.masterSpreads.length; m++) {
    var mframes = doc.masterSpreads[m].textFrames;
    for (var mf = 0; mf < mframes.length; mf++) if (mframes[mf].geometricBounds[0] > 260) footerFrames.push(mframes[mf]);
  }
  if (footerFrames.length) samples["pied-de-page"] = footerFrames[0].paragraphs[0];

  // 3. Paragraph styles, each copied from a real paragraph of the pilot.
  var pstyles = {};
  for (var k2 = 0; k2 < PARAGRAPH_STYLES.length; k2++) {
    var name = PARAGRAPH_STYLES[k2];
    var st = doc.paragraphStyles.itemByName(name);
    if (!st.isValid) st = doc.paragraphStyles.add({ name: name });
    var sample = samples[name];
    if (sample) {
      for (var pk = 0; pk < PARA_KEYS.length; pk++) { try { st[PARA_KEYS[pk]] = sample[PARA_KEYS[pk]]; } catch (e) {} }
      say("paragraph style " + name + ": " + nameOf(sample.appliedFont) + " " + sample.pointSize + " pt, " + nameOf(sample.fillColor) + "  (from « " + String(sample.contents).replace(/[\r\n]+/g, " ").substr(0, 40) + " »)");
    } else say("paragraph style " + name + ": NO SAMPLE in the pilot — created empty");
    pstyles[name] = st;
  }
  // The title prints in capitals on every page, though page 2 was typed in lower case.
  pstyles["titre-lecon"].capitalization = Capitalization.ALL_CAPS;

  // 4. Apply them, KEEPING each frame's hand formatting: some frames are indented by hand to clear
  //    their ★ ▲ ● marker, and clearing that puts the text under the marker. The pilot pages are
  //    samples; what the export uses is the styles themselves and the model page.
  var applied = 0;
  function applyTo(frame, style, label) {
    // Some paragraphs took their indent from the pilot's one style (`puces`); swapping the style
    // drops it. So each paragraph's look is read first and put back as it was.
    for (var q = 0; q < frame.paragraphs.length; q++) {
      var para = frame.paragraphs[q], before = {};
      for (var k = 0; k < PARA_KEYS.length; k++) { try { before[PARA_KEYS[k]] = para[PARA_KEYS[k]]; } catch (e) {} }
      para.applyParagraphStyle(style, false);
      for (var key in before) { try { if (para[key] !== before[key]) para[key] = before[key]; } catch (e) {} }
    }
    applied++;
  }
  for (var kind2 in framesByKind) {
    var list = framesByKind[kind2];
    for (var i = 0; i < list.length; i++) applyTo(list[i].frame, pstyles[kind2], "p." + list[i].page.name + " " + kind2);
    say("applied " + kind2 + " to " + list.length + " frames");
  }
  for (var ff = 0; ff < footerFrames.length; ff++) applyTo(footerFrames[ff], pstyles["pied-de-page"], "master footer");

  // 5. Object styles. Pictures share one set; anything filled with the domain colour gets a set per domain.
  function objectStyle(container, name, props) {
    var os = container.objectStyles.itemByName(name);
    if (!os.isValid) os = container.objectStyles.add({ name: name });
    // A new object style switches every category on, set to "none". Applied to the pilot's markers,
    // that reset their text wrap and slid the directive under them. So: everything off, then only
    // what this style is about (fill, stroke, paragraph style, fitting) switched back on.
    for (var c = 0; c < STYLE_CATEGORIES.length; c++) { try { os[STYLE_CATEGORIES[c]] = false; } catch (e) {} }
    for (var key in props) { try { os[key] = props[key]; } catch (e) { say("  object style " + name + "." + key + " refused: " + e); } }
    return os;
  }
  var pictureProps = { enableFill: true, fillColor: "None", enableStroke: true, strokeColor: "None", strokeWeight: 0, enableFrameFittingOptions: true };
  var pictureStyles = ["amorce", "bande", "je-retiens", "picto-section"];
  for (var ps = 0; ps < pictureStyles.length; ps++) objectStyle(doc, pictureStyles[ps], pictureProps);
  var groups = {};
  for (var dd = 0; dd < DOMAINS.length; dd++) {
    var dom = DOMAINS[dd];
    var grp = doc.objectStyleGroups.itemByName(dom);
    if (!grp.isValid) grp = doc.objectStyleGroups.add({ name: dom });
    var swatch = DOMAIN_SWATCH[dom];
    var tint = headerTint[dom] === undefined || headerTint[dom] < 0 ? 100 : headerTint[dom];
    groups[dom] = {
      "bandeau-titre": objectStyle(grp, "bandeau-titre", { enableFill: true, fillColor: swatch, fillTint: tint, enableStroke: true, strokeColor: "None", enableParagraphStyle: true, appliedParagraphStyle: pstyles["titre-lecon"] }),
      "onglet-numero": objectStyle(grp, "onglet-numero", { enableFill: true, fillColor: swatch, fillTint: 100, enableStroke: true, strokeColor: "None", enableParagraphStyle: true, appliedParagraphStyle: pstyles["numero-lecon"] }),
      "encadre-evaluation": objectStyle(grp, "encadre-evaluation", { enableFill: true, fillColor: swatch, fillTint: 100, enableStroke: true, strokeColor: "None", enableParagraphStyle: true, appliedParagraphStyle: pstyles["evaluation"] }),
      "repere": objectStyle(grp, "repere", { enableFill: true, fillColor: swatch, fillTint: 100, enableStroke: true, strokeColor: "None" })
    };
    say("object styles " + dom + "/…: fill « " + swatch + " », title band at " + tint + "%");
  }
  // Tag the pilot's own coloured frames with them (overrides kept, so nothing moves or recolours).
  var tagged = 0;
  for (var p2 = 1; p2 < doc.pages.length; p2++) {
    var pg = doc.pages[p2], dom2 = domainOf(pg);
    if (!dom2) continue;
    var g = groups[dom2];
    var tfs = pg.textFrames;
    for (var t = 0; t < tfs.length; t++) {
      var b2 = tfs[t].geometricBounds, fillName = nameOf(tfs[t].fillColor);
      if (b2[0] < 21 && fillName !== "None") { tfs[t].applyObjectStyle(b2[1] < 35 ? g["onglet-numero"] : g["bandeau-titre"], false); tagged++; }
      else if (fillName === DOMAIN_SWATCH[dom2]) { tfs[t].applyObjectStyle(g["encadre-evaluation"], false); tagged++; }
    }
    var polys = pg.polygons;
    for (var pp = 0; pp < polys.length; pp++) {
      var pb = polys[pp].geometricBounds, w = pb[3] - pb[1];
      if (w > 6 && w < 8 && nameOf(polys[pp].fillColor) === DOMAIN_SWATCH[dom2]) { polys[pp].applyObjectStyle(g["repere"], false); tagged++; }
    }
  }
  say("tagged " + tagged + " coloured frames and markers with their domain's object style");

  // 6. The box (« je retiens »): a table and cell style per domain. Tint is an approximation of the pilot's pink.
  for (var d3 = 0; d3 < DOMAINS.length; d3++) {
    var dom3 = DOMAINS[d3];
    var cg = doc.cellStyleGroups.itemByName(dom3); if (!cg.isValid) cg = doc.cellStyleGroups.add({ name: dom3 });
    var tg = doc.tableStyleGroups.itemByName(dom3); if (!tg.isValid) tg = doc.tableStyleGroups.add({ name: dom3 });
    var cs = cg.cellStyles.itemByName("encadre"); if (!cs.isValid) cs = cg.cellStyles.add({ name: "encadre" });
    cs.fillColor = DOMAIN_SWATCH[dom3]; cs.fillTint = 25;
    var ts = tg.tableStyles.itemByName("encadre"); if (!ts.isValid) ts = tg.tableStyles.add({ name: "encadre" });
    ts.bodyRegionCellStyle = cs;
  }
  say("table style encadre per domain (fill at 25% — approximated, to check)");

  // 7. The model page: three named frames on the AN master. The server clones this page per lesson.
  var model = doc.pages.add(LocationOptions.AT_END);
  model.appliedMaster = doc.masterSpreads.itemByName("A-AN");
  var mg = groups["AN"];
  var numero = model.textFrames.add({ geometricBounds: [8, 16.2, 19.7, 40.2], name: "numero-lecon", contents: "Lesoŋ N" });
  numero.applyObjectStyle(mg["onglet-numero"], true);
  var titre = model.textFrames.add({ geometricBounds: [8, 41, 19.7, 190], name: "titre-lecon", contents: "titre de la leçon" });
  titre.applyObjectStyle(mg["bandeau-titre"], true);
  var corps = model.textFrames.add({ geometricBounds: [24, 20, 264, 190], name: "corps", contents: "corps — tout le contenu de la leçon s'écoule ici, dans l'ordre : questions, consignes, images ancrées, encadrés." });
  corps.paragraphs[0].applyParagraphStyle(pstyles["directive"], true);
  var vj = [numero, titre];
  for (var v = 0; v < vj.length; v++) vj[v].textFramePreferences.verticalJustification = VerticalJustification.CENTER_ALIGN;
  say("model page " + model.name + " on master A-AN, frames: numero-lecon, titre-lecon, corps");

  // 8. Pictures: embedded ones are written out to gabarit/Links; missing ones are relinked to the pilot's Links.
  var linksFolder = Folder(OUT_DIR + "Links"); if (!linksFolder.exists) linksFolder.create();
  var unembedded = 0, relinked = 0, stillMissing = [], failed = [];
  var links = doc.links;
  for (var l = links.length - 1; l >= 0; l--) {
    var link = links[l];
    try {
      if (link.status === LinkStatus.LINK_EMBEDDED) { link.unembed(linksFolder); unembedded++; }
      else if (link.status === LinkStatus.LINK_MISSING) {
        var candidate = File(PILOT_DIR + "Links/" + link.name);
        if (candidate.exists) { link.relink(candidate); relinked++; } else stillMissing.push(link.name);
      }
    } catch (e) { failed.push(link.name + ": " + e); }
  }
  var pasted = 0, allGraphics = doc.allGraphics;
  for (var ag = 0; ag < allGraphics.length; ag++) if (!allGraphics[ag].itemLink || !allGraphics[ag].itemLink.isValid) pasted++;
  say("pictures with no link at all (pasted into the file): " + pasted + " of " + allGraphics.length);
  say("pictures: " + unembedded + " un-embedded to gabarit/Links, " + relinked + " relinked to the pilot's Links, " + stillMissing.length + " still missing, " + failed.length + " failed");
  if (stillMissing.length) say("  missing: " + stillMissing.join(" | "));
  if (failed.length) say("  failed: " + failed.slice(0, 8).join(" | "));
  say("frames styled in total: " + applied);

  // 9. Save, save as a template, export IDML and previews.
  doc.save();
  doc.save(File(OUT_DIR + "gabarit-eleve.indt"), true);
  doc.exportFile(ExportFormat.INDESIGN_MARKUP, File(OUT_DIR + "gabarit-eleve.idml"));
  app.jpegExportPreferences.jpegExportRange = ExportRangeOrAllPages.EXPORT_RANGE;
  app.jpegExportPreferences.pageString = "2,4," + model.name;
  app.jpegExportPreferences.exportResolution = 80;
  doc.exportFile(ExportFormat.JPG, File(OUT_DIR + "apercu.jpg"));
} catch (err) {
  say("STOPPED: " + err + " (line " + err.line + ")");
} finally {
  var out = File(OUT_DIR + "rapport.txt");
  out.encoding = "UTF-8"; out.lineFeed = "Unix"; out.open("w"); out.write(report.join("\n")); out.close();
  doc.close(SaveOptions.NO);
}
"done";
