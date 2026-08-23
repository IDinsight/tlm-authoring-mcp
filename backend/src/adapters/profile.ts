/*
 * Module: adapters · subject profile (schema)
 *
 * A `SubjectProfile` is the DATA that describes a subject to the generic adapter
 * builder (build.ts). It replaces the hand-written per-subject behavior modules:
 * everything those modules used to express as code — the parse descriptor and the
 * parse-time prune — is expressed here as a validated literal. What's left is the
 * parse block: a subject is now a name plus a description of how to read its graph.
 * (Deliverables left with the graph-linked-documents change; coverage rules were
 * retired in phase 2c — coverage lives in the guide's prose; `capabilities` went
 * with the CI-maths example-domain tools, the last subject-conditional surface.)
 *
 * The one function-valued bit the old adapters carried is declared as data and
 * synthesized generically by the builder:
 *   - the parse descriptor's `postParse`     → a named prune strategy.
 *
 * The Zod schema is the single source of truth; the exported types are inferred
 * from it, so schema and type can never drift. `validateProfile` is the guard —
 * a malformed profile fails here (at load today; at authoring time once profiles
 * move to the store, per docs/design-notes/authorable-catalog.md phase 2b).
 */
import { z } from "zod";

// ── Parse descriptor (the GraphParseDescriptor, minus the postParse closure) ──
// `prune` names a generic strategy (prunes.ts) that becomes the descriptor's
// postParse. Everything else is the descriptor verbatim.
const pruneSchema = z
  .object({
    strategy: z.literal("content-reachable-from-roots"),
    rootKinds: z.array(z.string()).min(1),
  })
  .strict();

const edgeSchema = z.union([z.string(), z.array(z.string())]);

const parseSchema = z
  .object({
    // A node's kind comes from its own canonical LC fields (groupName for
    // groupings, statementType for standards, label for content) — no per-subject
    // kind table. `numberFrom` is where the ordinal lives: maths's standards spine
    // carries it in metadata.order, reading's Lessons in `position` — a genuine
    // per-subject difference, so it stays a knob.
    numberFrom: z.enum(["order", "position", "description"]).optional(),
    containerEdge: edgeSchema.optional(),
    supportEdge: edgeSchema.optional(),
    progressionEdge: z.string().optional(),
    dependencyEdge: z.string().optional(),
    prune: pruneSchema.optional(),
  })
  .strict();

// TRANSITIONAL: keys that LIVE profile cells still carry but this schema no
// longer models. The object below is `.strict()`, so an unknown key is a hard
// refusal — and a refused profile means the namespace won't activate at all.
// Stripping them here keeps every already-published cell loading unchanged,
// with no flag day and no re-seed to schedule:
//
//   • `deliverables` — retired when a document's identity became the graph node
//     it covers (docs/design-notes/graph-linked-documents.md).
//   • `capabilities` — retired with the CI-maths example-domain tools. It only
//     ever held `exampleDomainRotation`, and nothing reads it now.
//
// Each entry can go once every namespace has been re-seeded without that key.
const RETIRED_PROFILE_KEYS = ["deliverables", "capabilities"] as const;

const stripRetiredKeys = (raw: unknown): unknown => {
  if (!raw || typeof raw !== "object") return raw;
  const record = raw as Record<string, unknown>;
  const present = RETIRED_PROFILE_KEYS.filter((key) => key in record);
  if (present.length === 0) return raw;
  const rest = { ...record };
  for (const key of present) delete rest[key];
  return rest;
};

export const subjectProfileSchema = z.preprocess(
  stripRetiredKeys,
  z
    .object({
      id: z.string().min(1),               // stable adapter id, e.g. "ci-maths/nodes-relationships-v1"
      parse: parseSchema,
    })
    .strict(),
);

export type SubjectProfile = z.infer<typeof subjectProfileSchema>;
export type ParseProfile = z.infer<typeof parseSchema>;
export type PruneSpec = z.infer<typeof pruneSchema>;

// Validate a profile literal (the machine `core`). Throws a readable error
// naming the offending path so a bad profile fails loudly at the boundary,
// never as a silent mis-parse deep in a read.
export function validateProfile(raw: unknown, context = "subject profile"): SubjectProfile {
  const result = subjectProfileSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid ${context}: ${issues}`);
  }
  return result.data;
}

// ── The layered profile record (phase 2c) ────────────────────────────────────
// The AUTHORED/STORED profile is a two-field record: a machine-readable `core`
// (the SubjectProfile above, consumed by the deterministic parser/classifier)
// plus an optional `guide` — authored markdown the AUTHORING/GENERATING LLM
// reads to interpret and modify the graph. The two never mix: reads consume only
// `core`; the guide never sits on the read hot path. See
// docs/design-notes/authorable-catalog.md phase 2c.
export type ProfileRecord = { core: SubjectProfile; guide?: string };

// The guide is free text, capped so the config cell (two slots' worth of
// core + guide, on the pointer doc) stays well under Firestore's 1MB doc limit.
export const MAX_GUIDE_CHARS = 100_000;

// Accept BOTH the new { core, guide } record AND a legacy FLAT SubjectProfile
// (what phase 2b seeded before this split), so a not-yet-re-seeded namespace
// keeps resolving. A payload is new-shape iff it has a `core` key — no flat
// profile has one. Returns the still-unvalidated core + guide.
function splitRecord(raw: unknown): { core: unknown; guide: unknown } {
  if (raw !== null && typeof raw === "object" && "core" in (raw as Record<string, unknown>)) {
    const r = raw as Record<string, unknown>;
    return { core: r.core, guide: r.guide };
  }
  return { core: raw, guide: undefined }; // legacy flat profile
}

// Validate a stored/authored profile record. Validates `core` with the same Zod
// guard as validateProfile, and checks the optional `guide` is a string within
// the length cap. Throws a readable error at the boundary.
export function validateProfileRecord(raw: unknown, context = "subject profile"): ProfileRecord {
  const { core, guide } = splitRecord(raw);
  const validCore = validateProfile(core, context);
  if (guide === undefined) return { core: validCore };
  if (typeof guide !== "string") throw new Error(`Invalid ${context}: guide must be a markdown string.`);
  if (guide.length > MAX_GUIDE_CHARS) throw new Error(`Invalid ${context}: guide is ${guide.length} chars, over the ${MAX_GUIDE_CHARS}-char limit.`);
  return { core: validCore, guide };
}
