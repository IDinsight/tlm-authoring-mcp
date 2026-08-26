import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header, type StatChip } from "./components/Header";
import type { TypeRow } from "./components/TypeTable";
import { Banner } from "./components/Banner";
import { LoginGate } from "./components/LoginGate";
import { ViewTabs, type TabSpec } from "./components/ViewTabs";
import { SlotSwitch } from "./components/SlotSwitch";
import { SourceFilters } from "./components/SourceFilters";
import { Toolbar } from "./components/Toolbar";
import { Tree } from "./components/Tree";
import { CatalogPanel } from "./components/CatalogPanel";
import { TerminologyPanel } from "./components/TerminologyPanel";
import { DetailModal } from "./components/DetailModal";
import { useGraphData } from "./hooks/useGraphData";
import { computeSearch } from "./lib/search";
import { computeChangeFilter, countChangesByView, revealChanges } from "./lib/changes";
import { EMPTY_URL_STATE, readUrlState, writeUrlState } from "./lib/urlState";
import { makeT } from "./i18n";
import type { GraphModel } from "./lib/graphModel";
import type { Lang, ViewSpec } from "./types";

// The Catalog and Terminology tabs aren't graph views (their data lives in
// separate reserved namespaces — _catalog / _glossary — fetched on demand), so
// each rides alongside the viewConfig views as a synthetic tab with a reserved id
// and renders its own panel instead of the tree.
const CATALOG_TAB = "__catalog";
const TERMINOLOGY_TAB = "__terminology";

// Above this many changes in a view, opening every change's ancestors unfolds
// most of the tree — which buries the changes rather than revealing them. A draft
// that big is read with the "changes only" filter instead.
const AUTO_REVEAL_LIMIT = 25;

// Every node reachable in the current view (used by "expand all").
function allViewNodes(
  model: GraphModel,
  spec: ViewSpec,
  sourceOn: Record<string, boolean>,
): Set<string> {
  const all = new Set<string>();
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    all.add(id);
    model.viewChildren(spec, id, sourceOn).forEach(walk);
  };
  model.viewRoots(spec).forEach(walk);
  return all;
}

export default function App() {
  const [lang, setLang] = useState<Lang>("fr");
  const t = makeT(lang);
  const g = useGraphData(lang);
  const { data, model } = g;

  // Per-graph view state, reset whenever a new graph loads.
  const [currentView, setCurrentView] = useState<string | null>(null);
  const [sourceOn, setSourceOn] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Draft view: prune the tree to what this draft touched. Survives a tab switch
  // on purpose — flipping tabs with it on is how you find which view holds the
  // change.
  const [changesOnly, setChangesOnly] = useState(false);

  // Restore view/node/filters from the URL only on the FIRST graph we load (a
  // deep link or reload). Later graph switches from the dropdown start fresh at
  // defaults — the old graph's params don't belong to the new one.
  const urlRestored = useRef(false);

  useEffect(() => {
    if (!data || !model) return;
    const views = data.meta.viewConfig.views;
    const sources = data.meta.sources || [];
    const url = urlRestored.current ? EMPTY_URL_STATE : readUrlState();
    urlRestored.current = true;

    // View: honor the URL's view only if this graph actually defines it (or it's
    // a synthetic tab — Catalog / Terminology — which every graph has).
    const restoredView =
      url.view === CATALOG_TAB || url.view === TERMINOLOGY_TAB
        ? url.view
        : views.find((v) => v.id === url.view)?.id;
    setCurrentView(restoredView ?? views[0]?.id ?? null);

    // Sources: start every chip on, then turn off the ones the URL names,
    // ignoring any key this graph doesn't have (e.g. a stale link).
    const src: Record<string, boolean> = {};
    sources.forEach((k) => (src[k] = true));
    url.off.forEach((k) => {
      if (k in src) src[k] = false;
    });
    setSourceOn(src);

    // Selected node: only if it exists here; reveal its hasChild ancestors so
    // the tree opens straight to it.
    const hasNode = !!url.node && data.nodes.some((n) => n.id === url.node);
    setSelected(hasNode ? url.node : null);
    const reveal = new Set<string>();
    if (hasNode) {
      let p = model.inHasChild[url.node!];
      while (p) {
        reveal.add(p);
        p = model.inHasChild[p];
      }
    }
    setExpanded(reveal);
    setQuery("");

    // Keep the filter across a published→draft reload (the user just asked for
    // the draft), but drop it on any read that isn't a draft — there is nothing
    // to filter to and an empty tree would look broken.
    if (data.meta.reading !== "draft") setChangesOnly(false);
  }, [data, model]);

  // Mirror the current graph/view/node/filters back into the address bar so the
  // URL stays a shareable pointer to this exact spot (replaceState — no history
  // spam). Runs once the graph is ready and on every subsequent state change.
  useEffect(() => {
    if (g.phase !== "ready" || !g.currentNs) return;
    const off = Object.keys(sourceOn).filter((k) => !sourceOn[k]);
    writeUrlState({ ns: g.currentNs, view: currentView, node: selected, off });
  }, [g.phase, g.currentNs, currentView, selected, sourceOn]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const spec = useMemo<ViewSpec | null>(() => {
    if (!data || !currentView) return null;
    return data.meta.viewConfig.views.find((v) => v.id === currentView) ?? null;
  }, [data, currentView]);

  const catalogActive = currentView === CATALOG_TAB;
  const terminologyActive = currentView === TERMINOLOGY_TAB;

  // The tab strip: the graph's views, with the synthetic Catalog + Terminology
  // tabs slotted in just before the generic "Par type (LC)" floor (or appended if
  // there is none).
  const tabs = useMemo<TabSpec[]>(() => {
    if (!data) return [];
    const catalogTab: TabSpec = { id: CATALOG_TAB, label: { fr: t("catalog"), en: t("catalog") } };
    const terminologyTab: TabSpec = { id: TERMINOLOGY_TAB, label: { fr: t("terminology"), en: t("terminology") } };
    const views: TabSpec[] = data.meta.viewConfig.views;
    const genericAt = views.findIndex((v) => v.id === "generic");
    const at = genericAt === -1 ? views.length : genericAt;
    return [...views.slice(0, at), catalogTab, terminologyTab, ...views.slice(at)];
  }, [data, t]);

  // Counts over the nodes the source filters currently allow, split two ways: the
  // graph-wide totals stay inline in the header, the per-type breakdown goes
  // behind the TypeTable button (it used to be sixteen more chips).
  const counts = useMemo(() => {
    if (!data || !model) return { stats: [] as StatChip[], types: [] as TypeRow[] };

    const visible = data.nodes.filter((n) => model.srcAllowed(n.id, sourceOn));
    const visibleIds = new Set(visible.map((n) => n.id));

    const byCategory: Record<string, number> = {};
    visible.forEach((n) => {
      if (n.cat) byCategory[n.cat] = (byCategory[n.cat] || 0) + 1;
    });

    const edgeCount = data.edges.filter(
      (e) => visibleIds.has(e.s) && visibleIds.has(e.t),
    ).length;

    const stats: StatChip[] = [
      { value: visible.length, label: t("noeuds") },
      { value: edgeCount, label: t("relations") },
    ];

    // Keep the server's canonical taxonomy order rather than sorting by count:
    // it stays stable across graphs, so a reader learns where to look.
    const types: TypeRow[] = (data.meta.taxonomy || [])
      .filter((tx) => byCategory[tx.key])
      .map((tx) => ({ entry: tx, count: byCategory[tx.key] }));

    return { stats, types };
  }, [data, model, sourceOn, t]);

  const search = useMemo(() => {
    if (!model || !spec || !query.trim()) return null;
    return computeSearch(model, spec, query, sourceOn);
  }, [model, spec, query, sourceOn]);

  const readingDraft = data?.meta.reading === "draft";

  const changeFilter = useMemo(() => {
    if (!model || !spec || !readingDraft || !changesOnly) return null;
    return computeChangeFilter(model, spec, sourceOn);
  }, [model, spec, sourceOn, readingDraft, changesOnly]);

  // Per-tab counts, so the tab strip says which view the change is actually in.
  // Only the real graph views are walkable — the synthetic Catalog / Terminology
  // tabs have no spec and simply get no badge.
  const changeCounts = useMemo(() => {
    if (!model || !data || !readingDraft) return undefined;
    return countChangesByView(model, data.meta.viewConfig.views, sourceOn);
  }, [model, data, sourceOn, readingDraft]);

  // Search wins when both could apply: the user typed it more recently, and the
  // handlers below already clear one when the other turns on.
  const treeFilter = search ?? changeFilter;

  // Open a node's detail panel and reveal its hasChild ancestors in the tree.
  const openNode = useCallback(
    (id: string) => {
      setSelected(id);
      setExpanded((prev) => {
        const next = new Set(prev);
        let p = model?.inHasChild[id];
        while (p) {
          next.add(p);
          p = model?.inHasChild[p];
        }
        return next;
      });
    },
    [model],
  );

  // Open the tree to this draft's changes the first time we show a given
  // (graph, view) as a draft — so clicking "Draft" lands you on the edit instead
  // of on a collapsed root that looks identical to the published one.
  //
  // The ref makes it fire once per combination: re-running it on every render
  // would re-open branches the user just collapsed.
  const autoRevealedFor = useRef<string | null>(null);

  useEffect(() => {
    // Forget the last reveal while off the draft, so coming back from the
    // Published tab (which reloads and collapses the tree) reveals again.
    if (!readingDraft) {
      autoRevealedFor.current = null;
      return;
    }
    if (!model || !spec || !g.currentNs) return;

    const combination = `${g.currentNs}:${spec.id}`;
    if (autoRevealedFor.current === combination) return;
    autoRevealedFor.current = combination;

    const reveal = revealChanges(model, spec, sourceOn, AUTO_REVEAL_LIMIT);
    if (reveal.size === 0) return;

    setExpanded((prev) => new Set([...prev, ...reveal]));
  }, [model, spec, sourceOn, readingDraft, g.currentNs]);

  const toggleNode = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectView = useCallback((id: string) => {
    setCurrentView(id);
    setQuery("");
    setExpanded(new Set());
  }, []);

  // The two filters are alternatives, not layers — turning one on clears the
  // other so the tree is never pruned by a rule the user can't see.
  const changeQuery = useCallback((next: string) => {
    setQuery(next);
    if (next.trim()) setChangesOnly(false);
  }, []);

  const toggleChangesOnly = useCallback((on: boolean) => {
    setChangesOnly(on);
    if (on) setQuery("");
  }, []);

  const expandAll = useCallback(() => {
    if (!model || !spec) return;
    const next = new Set<string>();
    allViewNodes(model, spec, sourceOn).forEach((id) => {
      if (model.viewChildren(spec, id, sourceOn).length) next.add(id);
    });
    setExpanded(next);
  }, [model, spec, sourceOn]);

  const setAllSources = useCallback((on: boolean) => {
    setSourceOn((prev) => {
      const next: Record<string, boolean> = {};
      Object.keys(prev).forEach((k) => (next[k] = on));
      return next;
    });
    setQuery("");
  }, []);

  const toggleSource = useCallback((key: string, on: boolean) => {
    setSourceOn((prev) => ({ ...prev, [key]: on }));
    setQuery("");
  }, []);

  // The graph is ready once loaded; a graph view additionally needs its spec, but
  // the synthetic tabs (Catalog / Terminology) render without one (they fetch
  // their own data).
  const ready = g.phase === "ready" && data && model && (catalogActive || terminologyActive || spec);
  const refreshing = g.phase === "loading" && g.namespaces.length > 0;

  return (
    <div className="min-h-screen">
      <Header
        lang={lang}
        title={t("title")}
        sub={t("sub")}
        stats={ready ? counts.stats : []}
        types={ready ? counts.types : []}
        namespaces={g.namespaces}
        currentNs={g.currentNs}
        onSelectNs={g.selectNs}
        onRefresh={g.refresh}
        refreshing={refreshing}
        onToggleLang={() => setLang((l) => (l === "fr" ? "en" : "fr"))}
        auth={
          g.account
            ? { email: g.account.email, onSignIn: g.promptLogin, onSignOut: g.logout }
            : undefined
        }
      />

      {g.phase === "loading" && <Banner kind="load" text={g.loadingText} />}
      {g.phase === "error" && (
        <Banner
          kind="err"
          text={g.errorText}
          retryLabel={t("retry")}
          onRetry={g.retry}
        />
      )}
      {/* Two ways this shows: the server requires auth (phase "login", no way
          out), or the reader asked to sign in on the public explorer to reach a
          draft (dismissible). */}
      {(g.phase === "login" || g.showLogin) && (
        <LoginGate
          lang={lang}
          onSubmit={g.login}
          onGoogle={g.loginWithGoogle ?? undefined}
          onCancel={g.phase === "login" ? undefined : g.dismissLogin}
        />
      )}

      {ready && !g.showLogin && (
        <div>
          <SlotSwitch
            lang={lang}
            slot={g.slot}
            hasDraft={Boolean(g.namespaces.find((n) => n.ns === g.currentNs)?.hasDraft)}
            meta={data.meta}
            notice={g.slotNotice}
            onSelect={g.selectSlot}
            changesOnly={changesOnly}
            onChangesOnly={toggleChangesOnly}
          />
          <ViewTabs
            lang={lang}
            views={tabs}
            currentView={currentView}
            onSelect={selectView}
            changeCounts={changeCounts}
            changeCountTitle={t("chgInTab")}
          />
          {catalogActive ? (
            g.currentNs && <CatalogPanel lang={lang} ns={g.currentNs} />
          ) : terminologyActive ? (
            g.currentNs && <TerminologyPanel lang={lang} ns={g.currentNs} />
          ) : (
            spec && (
              <>
                <SourceFilters
                  lang={lang}
                  sources={data.meta.sources || []}
                  sourceOn={sourceOn}
                  onToggle={toggleSource}
                  onSetAll={setAllSources}
                />
                <Toolbar
                  lang={lang}
                  query={query}
                  onQuery={changeQuery}
                  onExpandAll={expandAll}
                  onCollapseAll={() => setExpanded(new Set())}
                />
                {/* The filter is on but this tab holds none of the draft's
                    changes — say so, or the empty tree reads as a load failure. */}
                {changeFilter && changeFilter.hits.size === 0 && (
                  <div className="px-3.5 pt-3 text-xs text-[color:var(--color-changed)]">
                    {t("chgNoneInView")}
                  </div>
                )}
                <Tree
                  lang={lang}
                  model={model}
                  spec={spec}
                  sourceOn={sourceOn}
                  expanded={expanded}
                  onToggle={toggleNode}
                  selected={selected}
                  onOpen={openNode}
                  filter={treeFilter}
                />
              </>
            )
          )}
        </div>
      )}

      {selected && model && (
        <DetailModal
          lang={lang}
          model={model}
          id={selected}
          onClose={() => setSelected(null)}
          onOpen={openNode}
        />
      )}
    </div>
  );
}
