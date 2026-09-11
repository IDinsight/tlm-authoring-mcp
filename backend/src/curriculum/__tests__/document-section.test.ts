/*
 * documentSectionSubgraph — the per-section generation reader. Anchored on ONE
 * DocumentSection (the node that already IS the document↔curriculum binding), it
 * resolves the owning document, the curriculum the section renders, the routine
 * that APPLIES (nearest-wins, document-first: the section's own usesRoutine, else
 * the owning TLM's, else the covered curriculum's ancestry), and the formatters
 * (the TLM's doc-wide stack ∪ the section's own — sibling sections excluded).
 *
 * Three synthetic graphs: model A gives the TLM NO routine, so a routine-less
 * section falls through to the covered Course's routine (curriculum tier); model B
 * adds a TLM routine to prove the document tier wins over that Course default; model
 * C nests a section inside another section, which must inherit from the section
 * above it before the document.
 */
import { describe, it, expect } from "vitest";
import { documentSectionSubgraph, type DocumentSectionScope } from "../documents.js";
import type { CurriculumModel, RawGraphSnapshot } from "../../types.js";

// documentSectionSubgraph now also reports a bad cursor as { error }; these tests
// pass none, so narrow to the scope. `null` still means "not a DocumentSection".
const scopeOf = (result: ReturnType<typeof documentSectionSubgraph>): DocumentSectionScope => {
  if (result === null) throw new Error("expected a section scope, got null");
  if ("error" in result) throw new Error(`expected a section scope, got error: ${result.error}`);
  return result;
};

type N = RawGraphSnapshot["nodes"][number];
type E = RawGraphSnapshot["relationships"][number];

const node = (id: string, labels: string[], properties: Record<string, unknown> = {}): N => ({ id, labels, properties });
const edge = (type: string, start: string, end: string): E => ({ id: `${type}:${start}->${end}`, type, start, end, properties: {} });
const ids = (list: { id: string }[]) => new Set(list.map((item) => item.id));

// Curriculum: a Course (carrying one default routine) → chapter → two lessons.
const CURRICULUM: N[] = [
  node("crs", ["Course"], { description: "Cours" }),
  node("chap", ["LessonGrouping"], { groupName: "Chapitre", description: "Chapitre 1" }),
  node("les-1", ["Lesson"], { position: 1, description: "Leçon 1" }),
  node("les-2", ["Lesson"], { position: 2, description: "Leçon 2" }),
  node("act-1", ["Activity"], { description: "Tâche de la leçon 1" }),
  node("crs-routine", ["InstructionalRoutine"], { description: "Fiche par défaut du cours" }),
  node("crs-step", ["InstructionalRoutine"], { description: "JE FAIS" }),
];
const CURRICULUM_EDGES: E[] = [
  edge("hasPart", "crs", "chap"),
  edge("hasPart", "chap", "les-1"),
  edge("hasPart", "chap", "les-2"),
  edge("hasPart", "les-1", "act-1"),
  edge("usesRoutine", "crs", "crs-routine"),
  edge("hasPart", "crs-routine", "crs-step"),
];

// Document: one TLM with a doc-wide formatter stack + three sections. sec-1 covers
// les-1 and has its OWN per-section formatter; sec-2 covers les-2 and carries its
// OWN routine; sec-front covers nothing (front-matter) and hangs a sibling formatter
// that must NOT leak into other sections' stacks.
const DOCUMENT: N[] = [
  node("tlm", ["TeachingLearningMaterial"], { title: "Guide", metadata: { assemblyGuide: "Une leçon par page." } }),
  node("fmt-doc", ["Formatter"], { description: "Style du document" }),
  node("spec-doc", ["FormatterSpec"], { content: "Deux colonnes." }),
  node("sec-1", ["DocumentSection"], { position: 1, description: "Fiche leçon 1" }),
  node("fmt-sec", ["Formatter"], { description: "Encart propre à la section 1" }),
  node("sec-2", ["DocumentSection"], { position: 2, description: "Fiche leçon 2" }),
  node("sec-routine", ["InstructionalRoutine"], { description: "Routine propre à la section 2" }),
  node("sec-front", ["DocumentSection"], { position: 0, description: "Page de garde" }),
  node("fmt-sib", ["Formatter"], { description: "Encart d'une section sœur" }),
];
const DOCUMENT_EDGES: E[] = [
  edge("hasPart", "tlm", "fmt-doc"),
  edge("hasPart", "fmt-doc", "spec-doc"),
  edge("hasPart", "tlm", "sec-1"),
  edge("hasPart", "sec-1", "fmt-sec"),
  edge("covers", "sec-1", "les-1"),
  edge("hasPart", "tlm", "sec-2"),
  edge("hasPart", "sec-2", "sec-routine"),
  edge("usesRoutine", "sec-2", "sec-routine"),
  edge("covers", "sec-2", "les-2"),
  edge("hasPart", "tlm", "sec-front"),
  edge("hasPart", "sec-front", "fmt-sib"),
];

const modelA = {
  rawGraph: { nodes: [...CURRICULUM, ...DOCUMENT], relationships: [...CURRICULUM_EDGES, ...DOCUMENT_EDGES] },
} as CurriculumModel;

describe("documentSectionSubgraph — a lesson section inheriting the Course routine", () => {
  const scope = scopeOf(documentSectionSubgraph(modelA, "sec-1"));

  it("resolves the owning document (nearest TLM up hasPart) with its assembly guide", () => {
    expect(scope.document).not.toBeNull();
    expect(scope.document!.id).toBe("tlm");
    expect(scope.document!.assemblyGuide).toBe("Une leçon par page.");
  });

  it("sends the assembly guide once — as the named field, not again inside the document node", () => {
    const node = scope.document!.node!;
    expect(node.id).toBe("tlm");
    expect(JSON.stringify(node)).not.toContain("Une leçon par page.");
  });

  it("renders the covered lesson's pure containment subtree", () => {
    expect(scope.covers).toEqual(["les-1"]);
    expect(ids(scope.curriculum!.nodes)).toEqual(new Set(["les-1", "act-1"]));
  });

  it("falls through to the covered Course's routine (curriculum tier) when neither the section nor the TLM carries one", () => {
    expect(scope.routine).not.toBeNull();
    expect(scope.routine!.entryId).toBe("crs-routine");
    expect(scope.routine!.resolvedFrom).toBe("crs");
    expect(scope.routine!.resolvedFromScope).toBe("curriculum");
    expect(ids(scope.routine!.nodes)).toEqual(new Set(["crs-routine", "crs-step"]));
  });

  it("unions the TLM's doc-wide stack with the section's own formatters, excluding sibling sections", () => {
    expect(ids(scope.formatters!.nodes)).toEqual(new Set(["fmt-doc", "spec-doc", "fmt-sec"]));
  });
});

describe("documentSectionSubgraph — a section with its own routine (section tier wins)", () => {
  const scope = scopeOf(documentSectionSubgraph(modelA, "sec-2"));

  it("uses the section's own routine over the Course default", () => {
    expect(scope.routine!.entryId).toBe("sec-routine");
    expect(scope.routine!.resolvedFrom).toBe("sec-2");
    expect(scope.routine!.resolvedFromScope).toBe("section");
  });
});

describe("documentSectionSubgraph — a front-matter section (empty covers)", () => {
  const scope = scopeOf(documentSectionSubgraph(modelA, "sec-front"));

  it("covers nothing and renders no curriculum, but still resolves its document + formatters", () => {
    expect(scope.covers).toEqual([]);
    expect(scope.curriculum!.nodes).toEqual([]);
    expect(scope.document!.id).toBe("tlm");
    // no covers ⇒ no curriculum ancestry, and neither section nor TLM has a routine
    expect(scope.routine).toBeNull();
    // the doc-wide stack still applies; this section's own sibling formatter joins it
    expect(ids(scope.formatters!.nodes)).toEqual(new Set(["fmt-doc", "spec-doc", "fmt-sib"]));
  });
});

describe("documentSectionSubgraph — the document tier wins over the Course default", () => {
  // Same graph, but the TLM now carries its own routine: a routine-less section must
  // resolve to it (document tier) rather than fall through to the Course (curriculum).
  const modelB = {
    rawGraph: {
      nodes: [...CURRICULUM, ...DOCUMENT, node("tlm-routine", ["InstructionalRoutine"], { description: "Routine du document" })],
      relationships: [...CURRICULUM_EDGES, ...DOCUMENT_EDGES, edge("usesRoutine", "tlm", "tlm-routine")],
    },
  } as CurriculumModel;

  it("resolves sec-1's routine from the owning TLM, not the covered Course", () => {
    const scope = scopeOf(documentSectionSubgraph(modelB, "sec-1"));
    expect(scope.routine!.entryId).toBe("tlm-routine");
    expect(scope.routine!.resolvedFrom).toBe("tlm");
    expect(scope.routine!.resolvedFromScope).toBe("document");
  });
});

describe("documentSectionSubgraph — a section nested inside another section", () => {
  // A document with parts within parts: « Partie 1 » holds « Fiche leçon 1 », and
  // carries a routine + a formatter of its own. The nested section must inherit BOTH
  // from the part above it — the part is nearer than the document.
  const modelC = {
    rawGraph: {
      nodes: [
        ...CURRICULUM, ...DOCUMENT,
        node("part-1", ["DocumentSection"], { position: 1, description: "Partie 1" }),
        node("part-routine", ["InstructionalRoutine"], { description: "Routine de la partie 1" }),
        node("fmt-part", ["Formatter"], { description: "Encart de la partie 1" }),
        node("tlm-routine", ["InstructionalRoutine"], { description: "Routine du document" }),
      ],
      relationships: [
        ...CURRICULUM_EDGES, ...DOCUMENT_EDGES,
        edge("hasPart", "tlm", "part-1"),
        edge("hasPart", "part-1", "part-routine"),
        edge("usesRoutine", "part-1", "part-routine"),
        edge("hasPart", "part-1", "fmt-part"),
        edge("usesRoutine", "tlm", "tlm-routine"),
        // sec-1 moves inside the part instead of hanging off the TLM directly.
        edge("hasPart", "part-1", "sec-1"),
      ],
    },
  } as CurriculumModel;

  const scope = scopeOf(documentSectionSubgraph(modelC, "sec-1"));

  it("still resolves the owning document, two hasPart levels up", () => {
    expect(scope.document!.id).toBe("tlm");
  });

  it("takes the parent section's routine over the document's", () => {
    expect(scope.routine!.entryId).toBe("part-routine");
    expect(scope.routine!.resolvedFrom).toBe("part-1");
    expect(scope.routine!.resolvedFromScope).toBe("section");
  });

  it("unions the stacks on its own path — its own, the part's, the document's — and no sibling's", () => {
    expect(ids(scope.formatters!.nodes)).toEqual(new Set(["fmt-doc", "spec-doc", "fmt-part", "fmt-sec"]));
  });

  it("keeps the part's own stack out of a SIBLING section's formatters", () => {
    const sibling = scopeOf(documentSectionSubgraph(modelC, "sec-2"));
    expect(ids(sibling.formatters!.nodes)).toEqual(new Set(["fmt-doc", "spec-doc"]));
  });
});

describe("documentSectionSubgraph — edge cases", () => {
  it("returns null for a non-DocumentSection id and an unknown id", () => {
    expect(documentSectionSubgraph(modelA, "tlm")).toBeNull();
    expect(documentSectionSubgraph(modelA, "les-1")).toBeNull();
    expect(documentSectionSubgraph(modelA, "no-such-id")).toBeNull();
  });

  it("returns a null document when the section is not under any TLM", () => {
    const orphan = {
      rawGraph: {
        nodes: [node("lone-sec", ["DocumentSection"], { position: 1 })],
        relationships: [] as E[],
      },
    } as CurriculumModel;
    const scope = scopeOf(documentSectionSubgraph(orphan, "lone-sec"));
    expect(scope.document).toBeNull();
    expect(scope.routine).toBeNull();
    expect(scope.formatters!.nodes).toEqual([]);
  });
});

// ── Self-bounding: dedup, detail, and paging the stack ───────────────────────
// A section whose formatter stack is far too big for one response. The stack is
// what this tool exists to deliver, so it must never be dropped — only paged.
describe("documentSectionSubgraph — bounded without ever refusing", () => {
  const SPEC_PROSE = "Spécification de mise en page. ".repeat(120); // ~3.6 KB each, as live

  // Twelve doc-wide formatters, each with a fat spec, over the same curriculum.
  const fatFormatters: N[] = [];
  const fatEdges: E[] = [];
  for (let index = 1; index <= 12; index++) {
    fatFormatters.push(node(`big-fmt-${index}`, ["Formatter"], { description: `Formatter ${index}` }));
    fatFormatters.push(node(`big-spec-${index}`, ["FormatterSpec"], { content: SPEC_PROSE }));
    fatEdges.push(edge("hasPart", "tlm", `big-fmt-${index}`));
    fatEdges.push(edge("hasPart", `big-fmt-${index}`, `big-spec-${index}`));
  }
  const fatModel = {
    rawGraph: {
      nodes: [...CURRICULUM, ...DOCUMENT, ...fatFormatters],
      relationships: [...CURRICULUM_EDGES, ...DOCUMENT_EDGES, ...fatEdges],
    },
  } as CurriculumModel;

  const withBudget = <T>(bytes: string, fn: () => T): T => {
    const prior = process.env.TLM_DOCUMENT_MAX_BYTES;
    process.env.TLM_DOCUMENT_MAX_BYTES = bytes;
    try {
      return fn();
    } finally {
      if (prior === undefined) delete process.env.TLM_DOCUMENT_MAX_BYTES;
      else process.env.TLM_DOCUMENT_MAX_BYTES = prior;
    }
  };

  it("states the precedence as ids, without repeating every formatter node", () => {
    const scope = scopeOf(documentSectionSubgraph(modelA, "sec-1"));
    // The order is the contract — doc-wide first, the section's own last, which is
    // what "nearest wins" means when the render bags are merged.
    expect(scope.formatterStackOrder).toEqual(["fmt-doc", "spec-doc", "fmt-sec"]);
    // …and every id in it resolves in `formatters.nodes`, so nothing is dangling.
    const present = ids(scope.formatters!.nodes);
    for (const id of scope.formatterStackOrder) expect(present.has(id)).toBe(true);
  });

  it("pages the stack rather than refusing, and sends the context once on the first page", () => {
    const pages = withBudget("6000", () => {
      const collected: DocumentSectionScope[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 30; page++) {
        const scope = scopeOf(documentSectionSubgraph(fatModel, "sec-1", { cursor }));
        collected.push(scope);
        if (!scope.nextCursor) break;
        cursor = scope.nextCursor;
      }
      return collected;
    });

    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0].formattersTruncated).toBe(true);
    expect(pages[0].stackNote).toMatch(/continuation page carries ONLY/);
    expect(pages[pages.length - 1].nextCursor).toBeUndefined();

    // Concatenating the pages reproduces the full stack, in order and once each.
    // "Full" has to be read at a budget nothing can trim — at the DEFAULT budget
    // this fat stack pages too, so comparing against it would compare two
    // truncated first pages and pass on a bug.
    const seen = pages.flatMap((page) => page.formatterStackOrder);
    const whole = withBudget(String(64 * 1024 * 1024), () => scopeOf(documentSectionSubgraph(fatModel, "sec-1")).formatterStackOrder);
    expect(seen).toEqual(whole);

    // The section is identifiable on every page (its id stitches the pages), and the
    // FIRST page carries the full context — the section's own guide and the document —
    // that the caller needs to compose from.
    for (const page of pages) expect(page.section.id).toBe("sec-1");
    expect(pages[0].continued).toBeUndefined();
    expect(pages[0].document!.assemblyGuide).toBe("Une leçon par page.");

    // A CONTINUATION page carries only the advancing formatters: it is flagged
    // `continued`, its context parts are shed (document identity only, no routine or
    // curriculum) and named in `omitted`, and the fixed pile is NOT re-sent.
    for (const page of pages.slice(1)) {
      expect(page.continued).toBe(true);
      expect(page.omitted).toEqual(expect.arrayContaining(["document", "curriculum", "routine"]));
      expect((page.document as { assemblyGuide?: string }).assemblyGuide).toBeUndefined();
      expect(page.routine).toBeUndefined();
      expect(page.curriculum).toBeUndefined();
    }
  });

  it("skeleton detail trims the CONTEXT and keeps the formatter stack intact", () => {
    const full = scopeOf(documentSectionSubgraph(modelA, "sec-1"));
    const skeleton = scopeOf(documentSectionSubgraph(modelA, "sec-1", { detail: "skeleton" }));

    // Context thins: the covered curriculum keeps identity but loses its prose.
    expect(ids(skeleton.curriculum!.nodes)).toEqual(ids(full.curriculum!.nodes));
    expect(skeleton.curriculum!.nodes.every((n) => n.properties.metadata === undefined)).toBe(true);

    // What you came for does not: the same formatters, in the same order, and the
    // section's own node still carries its full properties.
    expect(skeleton.formatterStackOrder).toEqual(full.formatterStackOrder);
    expect(ids(skeleton.formatters!.nodes)).toEqual(ids(full.formatters!.nodes));
    expect(skeleton.section).toEqual(full.section);
  });

  it("fits more formatters per page at skeleton detail than at full", () => {
    const atFull = withBudget("6000", () => scopeOf(documentSectionSubgraph(fatModel, "sec-1")));
    const atSkeleton = withBudget("6000", () => scopeOf(documentSectionSubgraph(fatModel, "sec-1", { detail: "skeleton" })));
    // Trimming the context leaves more of the budget for the stack itself — which
    // is the whole reason `detail` is offered here rather than just paging.
    expect(atSkeleton.formatterStackOrder.length).toBeGreaterThanOrEqual(atFull.formatterStackOrder.length);
  });

  it("rejects a malformed cursor, and one from another section's stack", () => {
    const bad = documentSectionSubgraph(modelA, "sec-1", { cursor: "!!!not-base64!!!" });
    expect(bad && "error" in bad && bad.error).toMatch(/Invalid cursor/);

    // fmt-sib belongs to sec-front; silently restarting would hand back page 1 of
    // a stack the caller is not walking.
    const foreign = Buffer.from("fmt-sib", "utf8").toString("base64");
    const wrong = documentSectionSubgraph(modelA, "sec-1", { cursor: foreign });
    expect(wrong && "error" in wrong && wrong.error).toMatch(/not in this section's stack/);
  });
});

/*
 * `include` — dropping the parts a caller already holds.
 *
 * THE DEFECT. Every part of a section's scope except the section itself is
 * DOCUMENT-level: the assembly guide, the formatter stack and the covered
 * curriculum are identical across all of a document's sections. Producing a
 * document section by section therefore re-receives them once per section, which
 * a real session measured at ~78 KB a section on the live ce1/reading Guide.
 *
 * `detail:"skeleton"` already thins those parts, but thinner is not the same as
 * gone: a caller who HAS the formatters wants them absent, not smaller.
 *
 * The subtle requirement is what must SURVIVE an omission, and both cases here
 * are ones a naive implementation gets wrong.
 */
describe("documentSectionSubgraph — include", () => {
  it("returns every part when include is omitted, exactly as before", () => {
    const all = scopeOf(documentSectionSubgraph(modelA, "sec-1"));
    const explicit = scopeOf(documentSectionSubgraph(modelA, "sec-1", { include: ["document", "curriculum", "routine", "formatters"] }));

    expect(explicit).toEqual(all);
    // Nothing was left out, so nothing is reported as left out.
    expect(all.omitted).toBeUndefined();
  });

  it("drops the parts not asked for and NAMES them", () => {
    const lean = scopeOf(documentSectionSubgraph(modelA, "sec-1", { include: [] }));

    expect(lean.curriculum).toBeUndefined();
    expect(lean.formatters).toBeUndefined();
    expect(lean.routine).toBeUndefined();
    // This is the part that matters: `routine: null` means "no routine applies to
    // this section", and a caller that read a MISSING routine as that would
    // compose the section with no routine at all. So the omission is stated.
    expect(lean.omitted).toEqual(["document", "curriculum", "routine", "formatters"]);
  });

  it("keeps the document's IDENTITY when the document is omitted, and only sheds its weight", () => {
    const lean = scopeOf(documentSectionSubgraph(modelA, "sec-1", { include: [] }));

    // A caller still has to know which TLM this section belongs to; what it does
    // not need again is the assembly guide, which is most of the bytes.
    expect(lean.document!.id).toBe("tlm");
    expect(lean.document!.assemblyGuide).toBeUndefined();
    expect(lean.document!.node).toBeUndefined();
    expect(lean.document!.assemblyGuideOmitted).toBe(true);
  });

  it("keeps formatterStackOrder when the formatters themselves are omitted", () => {
    const all = scopeOf(documentSectionSubgraph(modelA, "sec-1"));
    const lean = scopeOf(documentSectionSubgraph(modelA, "sec-1", { include: ["routine"] }));

    // Without the precedence order the saving would be useless: the caller would
    // hold the `render` bags and have no idea which one wins.
    expect(lean.formatterStackOrder).toEqual(all.formatterStackOrder);
    expect(lean.formatters).toBeUndefined();
  });

  it("keeps `covers` always, so a front-matter section stays recognisable", () => {
    // covers is a handful of ids and it is what distinguishes a front-matter
    // section from one that renders curriculum — omitting it would hide that.
    expect(scopeOf(documentSectionSubgraph(modelA, "sec-1", { include: [] })).covers).toEqual(["les-1"]);
    expect(scopeOf(documentSectionSubgraph(modelA, "sec-front", { include: [] })).covers).toEqual([]);
  });

  it("is materially smaller than the full read", () => {
    const bytes = (scope: DocumentSectionScope) => JSON.stringify(scope).length;
    const all = scopeOf(documentSectionSubgraph(modelA, "sec-1"));
    const lean = scopeOf(documentSectionSubgraph(modelA, "sec-1", { include: [] }));

    // The synthetic graph is tiny; the real one is 78 KB a section. Asserting a
    // ratio rather than a byte count keeps this honest as the fixture changes.
    expect(bytes(lean)).toBeLessThan(bytes(all) * 0.7);
  });
});
