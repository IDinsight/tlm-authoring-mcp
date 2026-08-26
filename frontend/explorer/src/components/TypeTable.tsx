import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, Layers } from "lucide-react";
import { makeT, pick } from "../i18n";
import type { Lang, TaxonomyEntry } from "../types";

/*
 * The node-type reference: colour swatch + LC label + how many are in the graph.
 *
 * This replaced two separate rows that listed the SAME sixteen labels — the
 * header's per-type count chips (count, no colour) and the legend strip (colour,
 * no count). Together they cost about four lines of chrome above every graph and
 * still made you look in two places to answer one question. Behind a button
 * they cost one line and answer it in one place.
 */

export type TypeRow = { entry: TaxonomyEntry; count: number };

type Props = {
  lang: Lang;
  rows: TypeRow[];
};

export function TypeTable({ lang, rows }: Props) {
  const t = makeT(lang);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Dismiss on a click anywhere outside, or on Escape — a popover with no way
  // out but its own button is a trap once the tree is scrolled.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (rows.length === 0) return null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
          open
            ? "border-accent bg-panel text-txt"
            : "border-line bg-panel2 text-muted hover:border-accent hover:text-txt"
        }`}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <Layers size={13} />
        {t("nodeTypes")}
        <b className="font-semibold text-txt">{rows.length}</b>
        <ChevronDown
          size={12}
          className={open ? "rotate-180 transition-transform" : "transition-transform"}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 max-h-[60vh] w-[300px] overflow-auto rounded-lg border border-line bg-panel p-1 shadow-[var(--shadow-pop)]">
          <TypeRows lang={lang} rows={rows} />
        </div>
      )}
    </div>
  );
}

// The popover's contents. Split out so it renders (and can be checked) without
// driving the button's open state.
export function TypeRows({ lang, rows }: Props) {
  return (
    <table className="w-full text-xs">
      <tbody>
        {rows.map(({ entry, count }) => (
          <tr key={entry.key} className="hover:bg-panel2">
            <td className="w-4 py-1 pl-2">
              <span
                className="dot block h-[9px] w-[9px] rounded-full"
                style={{ "--dot": entry.color } as CSSProperties}
              />
            </td>
            <td className="py-1 pl-2 pr-3 text-txt">{pick(lang, entry.label)}</td>
            <td className="py-1 pr-2 text-right tabular-nums text-muted">{count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
