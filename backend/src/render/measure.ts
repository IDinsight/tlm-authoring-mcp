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
 * means LibreOffice and poppler in the image. Neither is a Node dependency, so
 * `available` is part of the result rather than an assumption, and a deployment
 * without them keeps working with page counts absent instead of wrong.
 */
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const PT_PER_CM = 72 / 2.54;
const ptToCm = (pt: number) => pt / PT_PER_CM;

/** What one page turned out to be, once laid out. */
export type PageMeasurement = {
  page: number;
  words: number;
  /** Where the ink starts and stops down the page. */
  textTopCm: number | null;
  textBottomCm: number | null;
  /** Whitespace left below the last line — the number the tightening watched. */
  freeBelowCm: number | null;
};

export type Measurement =
  | { available: false; reason: string }
  | {
      available: true;
      pages: number;
      pageWidthCm: number;
      pageHeightCm: number;
      pageSize: string | null;      // "A4", "Letter", … as poppler names it
      perPage: PageMeasurement[];
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
export function parseBBox(xhtml: string, heightPt: number): PageMeasurement[] {
  const pages: PageMeasurement[] = [];
  for (const page of xhtml.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/g)) {
    const words = [...page[1].matchAll(/<word\s+xMin="([\d.]+)"\s+yMin="([\d.]+)"\s+xMax="([\d.]+)"\s+yMax="([\d.]+)"/g)];
    const tops = words.map((w) => Number(w[2]));
    const bottoms = words.map((w) => Number(w[4]));
    const bottom = bottoms.length ? Math.max(...bottoms) : null;
    pages.push({
      page: pages.length + 1,
      words: words.length,
      textTopCm: tops.length ? round(ptToCm(Math.min(...tops))) : null,
      textBottomCm: bottom === null ? null : round(ptToCm(bottom)),
      freeBelowCm: bottom === null ? null : round(ptToCm(heightPt - bottom)),
    });
  }
  return pages;
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
  const soffice = options.soffice ?? (await which("soffice")) ?? (await which("libreoffice"));
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
    // nothing at all.
    await run(soffice, [
      `-env:UserInstallation=file://${join(dir, "profile")}`,
      "--headless", "--norestore", "--convert-to", "pdf", "--outdir", dir, docx,
    ], { timeout });

    const pdf = (await readdir(dir)).find((name) => name.endsWith(".pdf"));
    if (!pdf) {
      return { available: false, reason: "LibreOffice produced no PDF from the document." };
    }
    const pdfPath = join(dir, pdf);

    const info = parsePdfInfo((await run("pdfinfo", [pdfPath], { timeout })).stdout);
    if (!info) {
      return { available: false, reason: "`pdfinfo` returned output this cannot read." };
    }

    // -bbox is optional: without pdftotext the page COUNT still stands, and a
    // count with no whitespace figures beats refusing the whole measurement.
    let perPage: PageMeasurement[] = [];
    if (await which("pdftotext")) {
      const { stdout } = await run("pdftotext", ["-bbox", pdfPath, "-"], { timeout });
      perPage = parseBBox(stdout, info.heightPt);
    }

    return {
      available: true,
      pages: info.pages,
      pageWidthCm: round(ptToCm(info.widthPt)),
      pageHeightCm: round(ptToCm(info.heightPt)),
      pageSize: info.size,
      perPage,
    };
  } catch (error) {
    return { available: false, reason: `Laying the document out failed: ${(error as Error).message}` };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
