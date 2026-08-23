import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  apiOrigin,
  fetchConfig,
  fetchGraph,
  fetchNamespaces,
  hasSession,
  initSupabase,
  signIn,
} from "../lib/api";
import { createGraphModel, type GraphModel } from "../lib/graphModel";
import { readUrlState } from "../lib/urlState";
import { makeT } from "../i18n";
import type { DisplayGraph, KgConfig, Lang, NamespaceEntry, Slot } from "../types";

// The async lifecycle of the explorer: reach the server, optionally sign in,
// list the graphs, then load one. Mirrors the original page's boot() → ensureLogin
// → loadNamespaces → loadGraph chain, as a hook that exposes phase + actions.
export type Phase = "loading" | "login" | "error" | "ready";

export type GraphData = {
  phase: Phase;
  loadingText: string;
  errorText: string;
  retry: (() => void) | null;
  namespaces: NamespaceEntry[];
  currentNs: string | null;
  data: DisplayGraph | null;
  model: GraphModel | null;
  login: (email: string, password: string) => Promise<string | null>;
  selectNs: (ns: string) => void;
  refresh: () => void;
  /** Which slot is on screen — published (live) or the unpublished draft. */
  slot: Slot;
  selectSlot: (slot: Slot) => void;
  /** Set when a draft read was refused, so the UI can say why rather than just failing. */
  slotNotice: string | null;
};

export function useGraphData(lang: Lang): GraphData {
  const t = useMemo(() => makeT(lang), [lang]);
  // `t` shifts with language, but error/loading copy is produced by the async
  // flow. Keep a ref so callbacks always read the current translator without
  // being re-created on every language flip.
  const tRef = useRef(t);
  tRef.current = t;

  const [phase, setPhase] = useState<Phase>("loading");
  const [loadingText, setLoadingText] = useState("");
  const [errorText, setErrorText] = useState("");
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const [namespaces, setNamespaces] = useState<NamespaceEntry[]>([]);
  const [currentNs, setCurrentNs] = useState<string | null>(null);
  const [data, setData] = useState<DisplayGraph | null>(null);
  const [slot, setSlot] = useState<Slot>("published");
  const [slotNotice, setSlotNotice] = useState<string | null>(null);

  const model = useMemo(() => (data ? createGraphModel(data) : null), [data]);

  const fail = useCallback((text: string, onRetry?: () => void) => {
    setErrorText(text);
    setRetry(() => onRetry ?? null);
    setPhase("error");
  }, []);

  const loadGraph = useCallback(
    async (ns: string, isRefresh = false, wanted: Slot = "published") => {
      setCurrentNs(ns);
      setPhase("loading");
      setLoadingText((isRefresh ? "↻ " : "") + tRef.current("loading"));
      try {
        const g = await fetchGraph(ns, wanted);
        setData(g);
        setSlot(wanted);
        setSlotNotice(null);
        if (!g.nodes.length) {
          setData(null);
          fail(tRef.current("empty"));
          return;
        }
        setPhase("ready");
      } catch (e) {
        // A refused draft is not a broken explorer: say so, and stay on the
        // published graph the reader can see.
        if (wanted === "draft" && e instanceof ApiError && (e.status === 403 || e.status === 401)) {
          setSlotNotice(tRef.current("draftForbidden"));
          void loadGraph(ns, isRefresh, "published");
          return;
        }
        fail(tRef.current("errLoad"), () => void loadGraph(ns, true, wanted));
      }
    },
    [fail],
  );

  const loadNamespaces = useCallback(async () => {
    setPhase("loading");
    setLoadingText(tRef.current("loadingNs"));
    let list: NamespaceEntry[];
    try {
      const res = await fetchNamespaces();
      list = res.namespaces || [];
    } catch {
      fail(tRef.current("errServer"));
      return;
    }
    if (!list.length) {
      fail(tRef.current("empty"));
      return;
    }
    setNamespaces(list);
    // A deep link / reload may name the graph to open; fall back to the first
    // one if that graph isn't in this list (e.g. a stale or cross-tenant link).
    const wanted = readUrlState().ns;
    const start = list.find((n) => n.ns === wanted)?.ns ?? list[0].ns;
    await loadGraph(start);
  }, [fail, loadGraph]);

  const boot = useCallback(async () => {
    setPhase("loading");
    setLoadingText(tRef.current("loadingNs"));
    let cfg: KgConfig;
    try {
      cfg = await fetchConfig();
    } catch {
      fail(`${tRef.current("errServer")} (${apiOrigin})`);
      return;
    }
    if (cfg.authRequired) {
      initSupabase(cfg);
      if (!(await hasSession())) {
        setPhase("login");
        return; // login screen shows; boot resumes after a successful sign-in
      }
    }
    await loadNamespaces();
  }, [fail, loadNamespaces]);

  useEffect(() => {
    void boot();
    // Boot runs once; language changes re-translate live copy via components.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      const res = await signIn(email.trim(), password);
      if (!res.ok) return tRef.current("loginFail") + res.message;
      await loadNamespaces();
      return null;
    },
    [loadNamespaces],
  );

  // Switching graphs always lands on published: the previous graph's draft state
  // says nothing about the new one.
  const selectNs = useCallback((ns: string) => void loadGraph(ns, false, "published"), [loadGraph]);
  const selectSlot = useCallback(
    (wanted: Slot) => {
      if (currentNs) void loadGraph(currentNs, true, wanted);
    },
    [currentNs, loadGraph],
  );
  const refresh = useCallback(() => {
    if (currentNs) void loadGraph(currentNs, true, slot);
  }, [currentNs, loadGraph, slot]);

  return {
    phase,
    loadingText,
    errorText,
    retry,
    namespaces,
    currentNs,
    data,
    model,
    login,
    selectNs,
    refresh,
    slot,
    selectSlot,
    slotNotice,
  };
}
