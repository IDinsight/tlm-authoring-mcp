/*
 * Counting the pages — on the RENDER, never on the source.
 *
 * The project's own rule, written the night ten sheets were forced down to two
 * pages: « Le nombre de pages se compte sur le RENDU, en PDF, jamais à la
 * lecture d'un guide. » It was earned. An estimate that counted the lines a
 * guide declares put one document at 2.5 pages; it rendered at eleven. Another
 * missed by five lines on the last lesson of the evening.
 *
 * So this module measures, and when it cannot measure it SAYS SO. It never
 * falls back to arithmetic dressed up as a count — a wrong number here is worse
 * than no number, because a wrong one gets believed and a missing one gets
 * chased.
 *
 * That honesty costs something: measuring means laying the file out, which
 * means LibreOffice and poppler in the image (pdfinfo for the count,
 * pdftotext for the words, pdftohtml for the pictures). Neither is a Node dependency, so
 * `available` is part of the result rather than an assumption, and a deployment
 * without them keeps working with page counts absent instead of wrong.
 */
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm, readdir, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { renderDocx } from "./docx.js";

const run = promisify(execFile);

// ── The layout engine's profile ─────────────────────────────────────────────
//
// LibreOffice's FIRST start with a profile does its expensive work — scanning
// every installed font, building its registry — and every conversion here used
// a fresh profile, so every call paid that again. Locally that is a second;
// on the one-CPU container it is most of the two minutes a measured render was
// taking, right up against the client's three-minute limit. So one profile is
// warmed ONCE per process by converting a trivial document (an init-only start
// leaves the font cache cold — measured), and each conversion gets a COPY of
// it: the isolation two concurrent conversions need, at the cost of copying
// half a megabyte.

let warmProfile: Promise<string | null> | null = null;

async function sofficeBinary(override?: string): Promise<string | null> {
  return override ?? (await which("soffice")) ?? (await which("libreoffice"));
}

/**
 * Warm the layout engine's profile, once. Safe to call at startup and to
 * forget: a conversion that finds no warm profile makes a fresh one. Returns
 * the profile's path, or null where there is no engine or warming failed.
 */
export async function warmLayoutEngine(options: MeasureOptions = {}): Promise<string | null> {
  if (!warmProfile) {
    warmProfile = (async () => {
      const soffice = await sofficeBinary(options.soffice);
      if (!soffice) return null;
      const dir = await mkdtemp(join(tmpdir(), "tlm-soffice-profile-"));
      const scratch = await mkdtemp(join(tmpdir(), "tlm-soffice-warm-"));
      try {
        const docx = join(scratch, "warm.docx");
        await writeFile(docx, renderDocx({ blocks: [{ kind: "line", runs: [{ text: "warm" }] }], media: [] }, {}));
        await run(soffice, [`-env:UserInstallation=file://${dir}`, "--headless", "--norestore", "--convert-to", "pdf", "--outdir", scratch, docx], { timeout: options.timeoutMs ?? 120_000 });
        return dir;
      } catch {
        await rm(dir, { recursive: true, force: true });
        return null;
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    })();
  }
  return warmProfile;
}

/** A profile for one conversion: a copy of the warm one, or a fresh directory when there is none. */
async function profileFor(dir: string, options: MeasureOptions): Promise<{ path: string; warm: boolean }> {
  const path = join(dir, "profile");
  const warm = await warmLayoutEngine(options);
  if (!warm) return { path, warm: false };
  try {
    await cp(warm, path, { recursive: true });
    return { path, warm: true };
  } catch {
    return { path, warm: false };
  }
}

const PT_PER_CM = 72 / 2.54;
const ptToCm = (pt: number) => pt / PT_PER_CM;

/** A box on the page, in points from the top-left corner. */
type Box = { top: number; bottom: number; left: number; right: number };
type Word = Box & { text: string };

/** Where one picture landed, in centimetres from the page's top-left corner. */
export type PageImage = {
  topCm: number;
  bottomCm: number;
  leftCm: number;
  rightCm: number;
  widthCm: number;
  heightCm: number;
};

/*
 * Two marks that share ink — the thing a rendered page can get wrong while
 * counting as one page and reading as finished.
 *
 * A floated band anchors to its paragraph; when that paragraph is shorter
 * than the band, the next band anchors beside it and draws over it. Reported
 * from a real session at 0.15 cm, then 0.36 cm, then a band over the banner
 * that followed it by 1.4 mm — each found by opening the PDF, because the
 * page count and the whitespace were both fine. Images are numbered as they
 * appear on the page, from 1, matching `images`.
 */
export type Overlap =
  | { kind: "image-over-image"; images: [number, number]; overlapCm: number }
  | { kind: "image-over-text"; image: number; words: number; text: string; overlapCm: number };

/*
 * White between two consecutive lines of text that nothing explains — no
 * picture beside it, no page turn. The cost of a `clear` block that nothing
 * needed: it ends a wrap that had already ended, and leaves a body line of
 * white where the page had none to give. Seven defensive clears turned a
 * two-page fiche into three, and two render cycles went to finding out which
 * four were for nothing; this says so on the first measurement.
 */
export type Gap = {
  /** Below the line the gap follows, from the top of the page. */
  afterCm: number;
  heightCm: number;
  /** What the gap holds, in body lines, at the page's own line pitch. */
  lines: number;
};

/** What one page turned out to be, once laid out. */
export type PageMeasurement = {
  page: number;
  words: number;
  /** Where the ink starts and stops down the page. */
  textTopCm: number | null;
  textBottomCm: number | null;
  /** The lowest edge of the lowest picture; null on a page with none. */
  imageBottomCm: number | null;
  /** The lowest mark on the page, text or picture. */
  inkBottomCm: number | null;
  /*
   * Whitespace below the last MARK on the page — text or picture.
   *
   * It used to be the gap below the last WORD: `pdftotext -bbox` emits words
   * and never images, so a page ending in a picture band OVERSTATED how much
   * room was left, the dangerous direction for a number whose job is to say how
   * close a sheet is to overflowing. On the golden sheets it reported 3.89 cm
   * where the production note recorded 1.4; a real session saw 2.77 cm reported
   * against 2.26 on the page, and a reserve check passed server-side that
   * failed in print. The pictures now come from `pdftohtml -xml`, so this is
   * the gap below whichever is lower.
   */
  freeBelowCm: number | null;
  /** Every picture on the page, in reading order. */
  images: PageImage[];
  /** Marks that share ink. Empty is the answer wanted; it is only trustworthy with `images` filled. */
  overlaps: Overlap[];
  /** White between lines that no picture explains — a `clear` nothing needed, usually. Trustworthy only with `images` filled. */
  gaps: Gap[];
};

export type Measurement =
  | { available: false; reason: string }
  | {
      available: true;
      pages: number;
      pageWidthCm: number;
      pageHeightCm: number;
      pageSize: string | null;      // "A4", "Letter", … as poppler names it
      /** Whether the pictures were located: false means `images` is empty and `overlaps` says nothing. */
      picturesMeasured: boolean;
      perPage: PageMeasurement[];
      /** Where the time went, so a slow call explains itself: the layout engine, then the readers. */
      elapsedMs: { layout: number; read: number };
      /** Whether the layout engine started from the warmed profile (false = a cold start, the slow case). */
      warmProfile: boolean;
    };

/*
 * `pdfinfo` output, which is `Key: value` lines.
 *
 * Only two matter, and the page SIZE is one of them: a run that silently came
 * out Letter instead of A4 lost 1.8 cm a page and was not noticed until the
 * sheets were printed.
 */
export function parsePdfInfo(text: string): { pages: number; widthPt: number; heightPt: number; size: string | null } | null {
  const pages = /^Pages:\s+(\d+)/m.exec(text);
  const size = /^Page size:\s+([\d.]+) x ([\d.]+) pts(?:\s+\(([^)]+)\))?/m.exec(text);
  if (!pages || !size) return null;
  return {
    pages: Number(pages[1]),
    widthPt: Number(size[1]),
    heightPt: Number(size[2]),
    size: size[3] ?? null,
  };
}

/*
 * `pdftotext -bbox` output: XHTML with one <page> per page and a <word> per
 * word, each carrying its box in points.
 *
 * Parsed with regexes rather than an XML library on purpose — the shape is
 * fixed, poppler emits it machine-first, and pulling in a parser for two tag
 * names would be the larger risk.
 */
export function parseWords(xhtml: string): Word[][] {
  const pages: Word[][] = [];
  for (const page of xhtml.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/g)) {
    const words = [...page[1].matchAll(/<word\s+xMin="([\d.]+)"\s+yMin="([\d.]+)"\s+xMax="([\d.]+)"\s+yMax="([\d.]+)">([^<]*)</g)];
    pages.push(words.map((w) => ({ left: Number(w[1]), top: Number(w[2]), right: Number(w[3]), bottom: Number(w[4]), text: w[5] })));
  }
  return pages;
}

/*
 * `pdftohtml -xml` output: one <page> per page carrying its own height, and an
 * <image> per picture with its box. The units follow the zoom the tool was run
 * at, so every box is scaled by the page height pdfinfo reported rather than
 * trusted — a default zoom of 1.5 would otherwise put every picture half again
 * as far down the page as it is.
 */
export function parseImages(xml: string, heightPt: number): Box[][] {
  const pages: Box[][] = [];
  for (const page of xml.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/g)) {
    const declared = /height="([\d.]+)"/.exec(page[1]);
    const scale = declared ? heightPt / Number(declared[1]) : 1;
    const images = [...page[2].matchAll(/<image\s+top="([\d.]+)"\s+left="([\d.]+)"\s+width="([\d.]+)"\s+height="([\d.]+)"/g)];
    pages.push(images.map((i) => {
      const top = Number(i[1]) * scale, left = Number(i[2]) * scale;
      return { top, left, right: left + Number(i[3]) * scale, bottom: top + Number(i[4]) * scale };
    }));
  }
  return pages;
}

/** The old entry point: words only, kept for callers that have no picture boxes. */
export function parseBBox(xhtml: string, heightPt: number): PageMeasurement[] {
  return measurePages(parseWords(xhtml), [], heightPt);
}

/*
 * Two boxes share ink when they overlap in BOTH directions by more than a
 * hair. Half a millimetre: a pictogram set in a line of text sits flush
 * against its neighbours' glyph boxes, and that touch is not an overlap.
 */
const OVERLAP_TOLERANCE_PT = 0.05 * PT_PER_CM;

function verticalOverlapPt(a: Box, b: Box): number {
  const across = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return across > OVERLAP_TOLERANCE_PT && down > OVERLAP_TOLERANCE_PT ? down : 0;
}

function overlapsOn(words: Word[], images: Box[]): Overlap[] {
  const found: Overlap[] = [];
  images.forEach((image, i) => {
    images.slice(i + 1).forEach((other, j) => {
      const down = verticalOverlapPt(image, other);
      if (down > 0) found.push({ kind: "image-over-image", images: [i + 1, i + j + 2], overlapCm: round(ptToCm(down)) });
    });
    const covered = words.filter((word) => verticalOverlapPt(image, word) > 0);
    if (covered.length > 0) {
      const deepest = Math.max(...covered.map((word) => verticalOverlapPt(image, word)));
      found.push({
        kind: "image-over-text", image: i + 1, words: covered.length,
        text: covered.slice(0, 6).map((word) => word.text).join(" ") + (covered.length > 6 ? " …" : ""),
        overlapCm: round(ptToCm(deepest)),
      });
    }
  });
  return found;
}

/*
 * The lines of a page: words grouped by their top edge, in reading order. A
 * word box is a glyph box, so a line's words share a top to within a point.
 */
function linesOf(words: Word[]): Box[] {
  const sorted = [...words].sort((a, b) => a.top - b.top);
  const lines: Box[] = [];
  for (const word of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(word.top - line.top) < 1.5) {
      line.left = Math.min(line.left, word.left); line.right = Math.max(line.right, word.right);
      line.bottom = Math.max(line.bottom, word.bottom);
    } else {
      lines.push({ ...word });
    }
  }
  return lines;
}

/** The most common distance between consecutive line tops — the page's own pitch, read off the page. */
function linePitchOf(lines: Box[]): number | null {
  const steps = lines.slice(1).map((line, i) => Math.round((line.top - lines[i].top) * 2) / 2).filter((d) => d > 2);
  if (steps.length === 0) return null;
  const counts = new Map<number, number>();
  for (const step of steps) counts.set(step, (counts.get(step) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/*
 * Gaps: a step between consecutive lines of more than one and a half pitches,
 * with no picture spanning it. A picture beside a short block makes the next
 * line start below the picture — that white is the picture's, not a gap.
 */
function gapsOn(words: Word[], images: Box[]): Gap[] {
  const lines = linesOf(words);
  const pitch = linePitchOf(lines);
  if (!pitch) return [];
  const found: Gap[] = [];
  for (let i = 1; i < lines.length; i++) {
    const step = lines[i].top - lines[i - 1].top;
    if (step <= pitch * 1.5) continue;
    const from = lines[i - 1].bottom, to = lines[i].top;
    const explained = images.some((image) => image.bottom > from + OVERLAP_TOLERANCE_PT && image.top < to - OVERLAP_TOLERANCE_PT);
    if (explained) continue;
    found.push({ afterCm: round(ptToCm(from)), heightCm: round(ptToCm(to - from)), lines: Math.round(((step - pitch) / pitch) * 10) / 10 });
  }
  return found;
}

/**
 * One measurement per page, from where the words and the pictures landed.
 *
 * A page with pictures but no picture boxes (poppler's `pdftohtml` absent)
 * measures as before — text only — and says nothing about overlaps rather
 * than reporting none.
 */
export function measurePages(wordPages: Word[][], imagePages: Box[][], heightPt: number): PageMeasurement[] {
  const count = Math.max(wordPages.length, imagePages.length);
  return Array.from({ length: count }, (_, index) => {
    const words = wordPages[index] ?? [];
    const images = imagePages[index] ?? [];
    const textBottom = words.length ? Math.max(...words.map((w) => w.bottom)) : null;
    const imageBottom = images.length ? Math.max(...images.map((i) => i.bottom)) : null;
    const inkBottom = textBottom === null ? imageBottom : imageBottom === null ? textBottom : Math.max(textBottom, imageBottom);
    return {
      page: index + 1,
      words: words.length,
      textTopCm: words.length ? round(ptToCm(Math.min(...words.map((w) => w.top)))) : null,
      textBottomCm: textBottom === null ? null : round(ptToCm(textBottom)),
      imageBottomCm: imageBottom === null ? null : round(ptToCm(imageBottom)),
      inkBottomCm: inkBottom === null ? null : round(ptToCm(inkBottom)),
      freeBelowCm: inkBottom === null ? null : round(ptToCm(heightPt - inkBottom)),
      images: images.map((i) => ({
        topCm: round(ptToCm(i.top)), bottomCm: round(ptToCm(i.bottom)),
        leftCm: round(ptToCm(i.left)), rightCm: round(ptToCm(i.right)),
        widthCm: round(ptToCm(i.right - i.left)), heightCm: round(ptToCm(i.bottom - i.top)),
      })),
      overlaps: overlapsOn(words, images),
      gaps: gapsOn(words, images),
    };
  });
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Is a binary on PATH? Used to say "unavailable" precisely rather than vaguely. */
async function which(binary: string): Promise<string | null> {
  try {
    const { stdout } = await run("which", [binary]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export type MeasureOptions = {
  /** Override the LibreOffice binary; some images ship it as `libreoffice`. */
  soffice?: string;
  timeoutMs?: number;
};

/**
 * Lay a .docx out and report what came back.
 *
 * The conversion is the slow part — LibreOffice starts a whole office suite —
 * so this is opt-in at every call site rather than something every render pays.
 */
export async function measureDocx(bytes: Buffer, options: MeasureOptions = {}): Promise<Measurement> {
  const soffice = await sofficeBinary(options.soffice);
  if (!soffice) {
    return {
      available: false,
      reason: "LibreOffice (soffice) is not installed in this environment, so a document cannot be laid out to count its pages. Page counts are measured on the render, never estimated from the source.",
    };
  }
  if (!(await which("pdfinfo"))) {
    return { available: false, reason: "poppler's `pdfinfo` is not installed, so a rendered PDF cannot be measured." };
  }

  const dir = await mkdtemp(join(tmpdir(), "tlm-measure-"));
  try {
    const docx = join(dir, "document.docx");
    await writeFile(docx, bytes);

    const timeout = options.timeoutMs ?? 120_000;
    // `-env:UserInstallation` gives this conversion its own profile: without it
    // two concurrent conversions fight over one and the second silently does
    // nothing at all. The profile is a copy of the warmed one where there is one.
    const profile = await profileFor(dir, options);
    const startedLayout = Date.now();
    await run(soffice, [
      `-env:UserInstallation=file://${profile.path}`,
      "--headless", "--norestore", "--convert-to", "pdf", "--outdir", dir, docx,
    ], { timeout });
    const layoutMs = Date.now() - startedLayout;
    const startedRead = Date.now();

    const pdf = (await readdir(dir)).find((name) => name.endsWith(".pdf"));
    if (!pdf) {
      return { available: false, reason: "LibreOffice produced no PDF from the document." };
    }
    const pdfPath = join(dir, pdf);

    const info = parsePdfInfo((await run("pdfinfo", [pdfPath], { timeout })).stdout);
    if (!info) {
      return { available: false, reason: "`pdfinfo` returned output this cannot read." };
    }

    // The boxes are optional: without pdftotext the page COUNT still stands,
    // and a count with no whitespace figures beats refusing the whole
    // measurement. Without pdftohtml the pictures are missing and the
    // measurement says so, rather than reporting a page with no overlaps.
    let words: Word[][] = [];
    if (await which("pdftotext")) {
      const { stdout } = await run("pdftotext", ["-bbox", pdfPath, "-"], { timeout });
      words = parseWords(stdout);
    }
    let images: Box[][] = [];
    const picturesMeasured = Boolean(await which("pdftohtml"));
    if (picturesMeasured) {
      // -zoom 1 keeps the boxes in points; the page height is checked anyway.
      // The pictures themselves are written beside the PDF and swept with it.
      const { stdout } = await run("pdftohtml", ["-xml", "-zoom", "1", "-noroundcoord", "-q", "-stdout", pdfPath], { timeout, maxBuffer: 64 * 1024 * 1024 });
      images = parseImages(stdout, info.heightPt);
    }

    return {
      available: true,
      pages: info.pages,
      pageWidthCm: round(ptToCm(info.widthPt)),
      pageHeightCm: round(ptToCm(info.heightPt)),
      pageSize: info.size,
      picturesMeasured,
      perPage: measurePages(words, images, info.heightPt),
      elapsedMs: { layout: layoutMs, read: Date.now() - startedRead },
      warmProfile: profile.warm,
    };
  } catch (error) {
    const timedOut = /ETIMEDOUT|timed out|SIGTERM/i.test((error as Error).message);
    return {
      available: false,
      reason: timedOut
        ? `Laying the document out took longer than ${Math.round((options.timeoutMs ?? 120_000) / 1000)} s and was stopped, so there is no page count — the file itself is unaffected. A cold layout engine on a small instance is the usual cause; try once more.`
        : `Laying the document out failed: ${(error as Error).message}`,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
