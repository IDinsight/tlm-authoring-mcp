/*
 * Stored Learning-Commons node/edge → the explorer's display shape.
 *
 * The pure transform half: no store, no async, no export envelope. It maps a
 * stored node's `{type, properties:{code,title,text,order,isAssessment,raw}}`
 * onto a DisplayNode, reading `raw.*` in BOTH the CI-maths (camelCase) and
 * CE1-reading (snake_case) spellings where they differ so one mapping serves
 * both subjects.
 *
 * Also holds the namespace LABELS — how a graph names itself in the explorer's
 * selector — which are the same kind of presentation decision.
 */
import type { StoredNode, StoredEdge } from "../kg-store/index.js";
import { displayName } from "../utils/index.js";
import type { DisplayNode, DisplayEdge } from "./types.js";

// ── Namespace labels ─────────────────────────────────────────────────────────
// A KG appears in the selector automatically once it has an installed source
// folder AND a published pointer. The pretty label is looked up by grade/subject
// (so it survives an env bucket-prefix), with a plain fallback.
const SUBJECT_LABELS: Record<string, { fr: string; en: string }> = {
  maths: { fr: "Mathématiques", en: "Mathematics" },
  reading: { fr: "Lecture", en: "Reading" },
};
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export function nsLabel(grade: string, subject: string): { fr: string; en: string } {
  const subj = SUBJECT_LABELS[subject] ?? { fr: cap(subject), en: cap(subject) };
  const g = grade.toUpperCase();
  return { fr: `${subj.fr} — ${g}`, en: `${subj.en} — ${g}` };
}

// ── raw-LC → display node transform ──────────────────────────────────────────
// Maps a stored node ({type, properties:{code,title,text,order,isAssessment,raw}})
// to the explorer's display node. Reads raw.* with both CI maths (camelCase) and
// CE1 CE1 reading (snake_case) spellings where they differ, so ONE mapping serves both.
const LABEL_BY_KIND: Record<string, string> = {
  domaine: "StandardsFrameworkItem",
  chapter: "StandardsFrameworkItem",
  lesson: "StandardsFrameworkItem",
  standard: "StandardsFrameworkItem",
  week: "StandardsFrameworkItem",
  component: "LearningComponent",
  task: "Activity",
};

const str = (v: unknown): string => (v == null ? "" : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const numOrStr = (v: unknown): number | string => (typeof v === "number" ? v : v == null ? "" : String(v));

export function toDisplayNode(n: StoredNode): DisplayNode {
  const p = n.properties ?? {};
  const raw = (p.raw as Record<string, unknown>) ?? {};
  const r = (k: string) => raw[k];
  const m = (raw.metadata as Record<string, unknown>) ?? {};
  const en = (k: string) => ((m.en as Record<string, unknown>) ?? {})[k];
  const label = (n.labels && n.labels[0]) || LABEL_BY_KIND[n.type] || n.type;
  return {
    id: n.id,
    label,
    kind: label,   // LC-only: the explorer keys on the label, not the subject kind
    cat: label,
    code: str(p.code ?? r("statementCode") ?? r("identifier")),
    ord: typeof p.order === "number" ? (p.order as number) : (typeof m.order === "number" ? (m.order as number) : null),
    // The node LABEL, so line 1 only — a routine's full text still reaches the
    // detail panel through the raw property bag below.
    desc: displayName(str(p.text ?? p.title ?? r("description") ?? r("osTexte"))),
    desc_en: str(en("description") ?? en("os_texte")),
    nt: str(r("normalizedType") ?? r("normalizedStatementType") ?? r("contentType")),
    st: str(r("statementType")),
    st_en: str(en("statement_type")),
    srcKey: str(r("sourceKey")),
    // The whole raw LC property bag — the detail panel renders it generically, so
    // no field is subject-specific here. `metadata` is flattened one level for
    // readability (role/order/palier/genre/… become top-level keys).
    props: flattenProps(raw),
  };
}

// Flatten `raw` for the detail panel: keep scalar/array props, lift `metadata.*`
// (minus the bulky `en` translations) to the top level, and drop the `raw`-nested
// `metadata`/`en` containers so the panel shows a clean key/value list.
function flattenProps(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === "metadata") continue;
    out[k] = v;
  }
  const m = (raw.metadata as Record<string, unknown>) ?? {};
  for (const [k, v] of Object.entries(m)) {
    if (k === "en") continue;
    out[k] = v;
  }
  return out;
}

export function edgeOrder(e: StoredEdge): number {
  const p = e.properties ?? {};
  return typeof p.orderInParent === "number" ? (p.orderInParent as number)
    : typeof p.sequenceInFrom === "number" ? (p.sequenceInFrom as number)
    : typeof e.seq === "number" ? e.seq             // supports/relatesTo carry no order prop → fall back to raw sequence
    : 0;
}

// Context for the fold: which activities illustrate which component (a metadata
// link — canonical LC has NO Activity↔LearningComponent edge — see CLAUDE.md), and
// whether a given node id is present.
export type FoldContext = { illustrates: Map<string, { comp: string; order: number }>; has: (id: string) => boolean };

// One stored edge → its DISPLAY edge(s). The containment tree walks a single
// TRAVERSAL type (`r: "hasChild"`), so we normalise canonical LC's edges onto it,
// but each display edge also carries its REAL type in `rel` for an honest badge
// (display-only — the store keeps the real edges):
//   • `hasPart` (content containment) → forward; rel "hasPart".
//   • `supports` (component→SFI) and `hasEducationalAlignment` (lesson/activity→SFI)
//     are alignment/part-of the standard: fold REVERSED (parent = the supported
//     end) so components/lessons stay reachable; rel = the real edge type.
//   • An illustrative `Activity` (hasEducationalAlignment to its standard) is
//     RE-PARENTED under the LearningComponent it exemplifies — the nesting the LC
//     graph can't express as an edge — via metadata.illustratesComponent; rel
//     "illustrates". Falls back to the standard fold if that component is absent.
//   • That same activity is ALSO held directly by its derived frame via a real
//     hasChild; we DROP that display edge (only when the component resolves, so the
//     illustrates fold already gave it a parent) so it nests under the component
//     alone instead of also hanging off the frame.
//   • `usesRoutine` (Course/Lesson/Activity → InstructionalRoutine) folds forward to
//     the tree so the shared routine nests under EVERY node that uses it — the guide
//     Course and each of its lessons — each showing a collapsed routine child with an
//     honest `usesRoutine` badge (rel). The real edges are unchanged in the store.
//   • hasChild / buildsTowards / relatesTo otherwise pass through with their own type.
export function toDisplayEdges(e: StoredEdge, ctx: FoldContext): DisplayEdge[] {
  if (e.type === "usesRoutine") {
    return [{ s: e.from, t: e.to, r: "hasChild", rel: "usesRoutine", o: edgeOrder(e) }];
  }
  // `covers` (document → curriculum, teaching-learning-materials.md) is NOT
  // containment — keep it on its OWN traversal axis (r "covers") so it never folds
  // into the hasChild tree the curriculum views walk. The Documents view reaches
  // the covered Course/Lesson through this edge as a display-only link out.
  if (e.type === "covers") {
    return [{ s: e.from, t: e.to, r: "covers", rel: "covers", o: edgeOrder(e) }];
  }
  if (e.type === "supports" || e.type === "hasEducationalAlignment") {
    if (e.type === "hasEducationalAlignment") {
      const ill = ctx.illustrates.get(e.from);
      if (ill && ctx.has(ill.comp)) return [{ s: ill.comp, t: e.from, r: "hasChild", rel: "illustrates", o: ill.order }];
    }
    return [{ s: e.to, t: e.from, r: "hasChild", rel: e.type, o: edgeOrder(e) }];
  }
  if (e.type === "hasPart") return [{ s: e.from, t: e.to, r: "hasChild", rel: "hasPart", o: edgeOrder(e) }];
  if (e.type === "hasDependency") {
    // Canonical LC content prerequisite: `dependent hasDependency prereq`. Normalise
    // to the progression direction `prereq buildsTowards dependent` (reversed) so the
    // Learning-progression view reads prereq → successor uniformly, whatever the
    // source dialect used (mirrors the parser's hasDependency handling).
    return [{ s: e.to, t: e.from, r: "buildsTowards", rel: "buildsTowards", o: edgeOrder(e) }];
  }
  if (e.type === "hasChild") {
    const ill = ctx.illustrates.get(e.to);       // frame → illustrative activity: drop (it nests under its component)
    if (ill && ctx.has(ill.comp)) return [];
  }
  return [{ s: e.from, t: e.to, r: e.type, rel: e.type, o: edgeOrder(e) }];
}
