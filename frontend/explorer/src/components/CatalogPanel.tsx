import { useEffect, useMemo, useState } from "react";
import { fetchCatalog } from "../lib/api";
import { CatalogEntryModal } from "./CatalogEntryModal";
import { makeT } from "../i18n";
import type { CatalogEntry, CatalogKind, CatalogScope, Lang } from "../types";

type Props = { lang: Lang; ns: string };

// "all" is the no-filter position of each control, not a kind/scope the server knows.
type KindFilter = CatalogKind | "all";
type ScopeFilter = CatalogScope | "all";

// Accent- and case-insensitive, because the catalog is authored in French: a
// curator typing "recitation" should still find « Fiche de poésie-récitation ».
const fold = (s: string): string =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

// Kind decides the badge and which footer stats mean anything, so the three
// kinds' presentation lives in one table rather than scattered ternaries.
const KIND_LABEL: Record<CatalogKind, "catalogRoutines" | "catalogFormatters" | "catalogRubrics"> = {
  routine: "catalogRoutines",
  formatter: "catalogFormatters",
  rubric: "catalogRubrics",
};
const KIND_BADGE: Record<CatalogKind, string> = {
  routine: "border-line bg-panel text-accent",
  formatter: "border-line bg-panel text-sky-400",
  rubric: "border-line bg-panel text-amber-400",
};

// Tab order is the order a curator meets these: routines structure a lesson,
// formatters style the document, rubrics judge the result.
const KIND_ORDER: CatalogKind[] = ["routine", "formatter", "rubric"];

// One entry as a clickable card. A rubric reads differently from a routine — its
// steps ARE weighted sections and its materials ARE criteria — so the footer is
// labelled per kind instead of showing "steps/materials" for everything.
function EntryCard({
  lang,
  entry,
  onOpen,
}: {
  lang: Lang;
  entry: CatalogEntry;
  onOpen: (e: CatalogEntry) => void;
}) {
  const t = makeT(lang);
  const isRubric = entry.kind === "rubric";
  return (
    <div
      className="cursor-pointer rounded-xl border border-line bg-panel2 p-3.5 hover:border-accent"
      onClick={() => onOpen(entry)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[14px] font-medium leading-snug text-txt">
          {entry.name || entry.id}
        </div>
        <span
          className={`shrink-0 rounded border px-2 py-0.5 text-[10px] uppercase tracking-[0.04em] ${KIND_BADGE[entry.kind]}`}
        >
          {t(KIND_LABEL[entry.kind])}
        </span>
      </div>
      {entry.summary && (
        <div className="mt-1.5 line-clamp-3 text-[12.5px] leading-relaxed text-muted">
          {entry.summary}
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap gap-x-3 text-[11px] text-muted">
        {isRubric && entry.scale && (
          <span className="text-amber-400">{t("catalogScale")} {entry.scale}</span>
        )}
        {entry.steps.length > 0 && (
          <span>
            {entry.steps.length} {isRubric ? t("catalogSections") : t("catalogSteps")}
          </span>
        )}
        {entry.materialCount > 0 && (
          <span>
            {entry.materialCount} {isRubric ? t("catalogCriteria") : t("catalogMaterials")}
          </span>
        )}
      </div>
    </div>
  );
}

// The kind tabs. Counts are of what the OTHER filters already allow, so an empty
// tab tells you the search excluded that kind rather than that none exists.
function KindTabs({
  lang,
  current,
  counts,
  onSelect,
}: {
  lang: Lang;
  current: KindFilter;
  counts: Record<KindFilter, number>;
  onSelect: (k: KindFilter) => void;
}) {
  const t = makeT(lang);
  const tabs: Array<{ id: KindFilter; label: string }> = [
    { id: "all", label: t("catalogAll") },
    ...KIND_ORDER.map((k) => ({ id: k as KindFilter, label: t(KIND_LABEL[k]) })),
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {tabs.map((tab) => {
        const active = tab.id === current;
        return (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            className={`rounded-lg border px-3 py-1.5 text-[12.5px] ${
              active
                ? "border-accent bg-panel text-accent"
                : "border-line bg-panel2 text-muted hover:text-txt"
            }`}
          >
            {tab.label} <span className="opacity-60">{counts[tab.id]}</span>
          </button>
        );
      })}
    </div>
  );
}

// One scope's section: a heading then its entries as cards. An empty scope is
// omitted entirely, so the workspace/shared split never shows a bare heading.
function ScopeSection({
  lang,
  title,
  entries,
  onOpen,
}: {
  lang: Lang;
  title: string;
  entries: CatalogEntry[];
  onOpen: (e: CatalogEntry) => void;
}) {
  if (!entries.length) return null;
  // Routines, then formatters, then rubrics; stable name order within each kind.
  const sorted = [...entries].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name),
  );
  return (
    <div className="mb-6">
      <h3 className="mb-2.5 text-[11px] uppercase tracking-[0.05em] text-muted">
        {title} <span className="text-accent">({entries.length})</span>
      </h3>
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
        {sorted.map((e) => (
          <EntryCard key={`${e.scope}-${e.id}`} lang={lang} entry={e} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

// The Catalog tab body: the two reusable-spec libraries a curator of this
// namespace's workspace can browse — the workspace's own and the shared
// cross-tenant one — narrowed by kind tabs, a scope filter and free-text search,
// with click-through to an entry's full spec.
export function CatalogPanel({ lang, ns }: Props) {
  const t = makeT(lang);
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<CatalogEntry | null>(null);
  const [kind, setKind] = useState<KindFilter>("all");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [query, setQuery] = useState("");

  // (Re)load whenever the namespace changes; ignore a stale response if the ns
  // switched mid-flight. Filters reset too — they describe the old library.
  useEffect(() => {
    let live = true;
    setEntries(null);
    setError(false);
    setOpen(null);
    setKind("all");
    setScope("all");
    setQuery("");
    fetchCatalog(ns)
      .then((r) => live && setEntries(r.entries))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [ns]);

  // Scope + search first; the kind tabs count what survives those, and the grid
  // shows what survives all three.
  const { visible, counts, total } = useMemo(() => {
    const all = entries ?? [];
    const q = fold(query.trim());
    const beforeKind = all.filter(
      (e) =>
        (scope === "all" || e.scope === scope) &&
        (!q || fold(e.name).includes(q) || fold(e.summary).includes(q)),
    );
    const tally: Record<KindFilter, number> = {
      all: beforeKind.length,
      routine: 0,
      formatter: 0,
      rubric: 0,
    };
    for (const e of beforeKind) tally[e.kind] += 1;
    return {
      visible: beforeKind.filter((e) => kind === "all" || e.kind === kind),
      counts: tally,
      total: all.length,
    };
  }, [entries, kind, scope, query]);

  const filtered = query.trim() !== "" || kind !== "all" || scope !== "all";
  const scopeOptions: Array<{ id: ScopeFilter; label: string }> = [
    { id: "all", label: t("catalogScopeAll") },
    { id: "workspace", label: t("catalogScopeWorkspaceShort") },
    { id: "shared", label: t("catalogScopeSharedShort") },
  ];

  return (
    <>
      <div className="px-3.5 pb-3 pt-0.5 text-xs text-muted">{t("catalogHint")}</div>

      {entries != null && entries.length > 0 && (
        <div className="flex flex-col gap-2.5 px-3.5 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("catalogSearch")}
              className="min-w-[13rem] flex-1 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12.5px] text-txt placeholder:text-muted focus:border-accent focus:outline-none"
            />
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as ScopeFilter)}
              className="rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-[12.5px] text-txt focus:border-accent focus:outline-none"
            >
              {scopeOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            {filtered && (
              <button
                onClick={() => {
                  setQuery("");
                  setKind("all");
                  setScope("all");
                }}
                className="rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-[12.5px] text-muted hover:text-txt"
              >
                {t("catalogClear")}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <KindTabs lang={lang} current={kind} counts={counts} onSelect={setKind} />
            {filtered && (
              <span className="text-[11px] text-muted">
                {visible.length}/{total} {t("catalogShowing")}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="overflow-auto px-3.5 pb-20">
        {error ? (
          <div className="py-6 text-xs text-muted">{t("catalogErr")}</div>
        ) : entries == null ? (
          <div className="py-6 text-xs text-muted">{t("catalogLoading")}</div>
        ) : !entries.length ? (
          <div className="py-6 text-xs text-muted">{t("catalogEmpty")}</div>
        ) : !visible.length ? (
          <div className="py-6 text-xs text-muted">{t("catalogNoMatch")}</div>
        ) : (
          <>
            <ScopeSection
              lang={lang}
              title={t("catalogScopeWorkspace")}
              entries={visible.filter((e) => e.scope === "workspace")}
              onOpen={setOpen}
            />
            <ScopeSection
              lang={lang}
              title={t("catalogScopeShared")}
              entries={visible.filter((e) => e.scope === "shared")}
              onOpen={setOpen}
            />
          </>
        )}
      </div>

      {open && (
        <CatalogEntryModal
          lang={lang}
          ns={ns}
          entry={open}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
