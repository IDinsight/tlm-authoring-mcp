import { pick } from "../i18n";
import type { Bilingual, Lang } from "../types";

// A tab is just an id + a bilingual label — the graph's viewConfig views satisfy
// this, and so does the synthetic Catalog tab App injects alongside them.
export type TabSpec = { id: string; label: Bilingual };

type Props = {
  lang: Lang;
  views: TabSpec[];
  currentView: string | null;
  onSelect: (id: string) => void;
  // Draft reads only: view id → how many changed nodes that view shows. The slot
  // counts are graph-wide, so without this an edit to a Semaine reads as "1
  // modifié" while you stare at an unchanged Standards tree.
  changeCounts?: Record<string, number>;
  changeCountTitle?: string;
};

export function ViewTabs({
  lang,
  views,
  currentView,
  onSelect,
  changeCounts,
  changeCountTitle,
}: Props) {
  return (
    <div className="flex flex-wrap gap-1.5 px-3.5 pt-3">
      {views.map((v) => {
        const active = v.id === currentView;
        const changes = changeCounts?.[v.id] ?? 0;

        return (
          <button
            key={v.id}
            onClick={() => onSelect(v.id)}
            className={`flex items-center gap-1.5 rounded-t-lg border border-b-0 px-3.5 py-2 text-[13px] ${
              active
                ? "border-accent bg-panel text-accent"
                : "border-line bg-panel2 text-muted hover:text-txt"
            }`}
          >
            {pick(lang, v.label)}

            {changes > 0 && (
              <span
                title={changeCountTitle}
                className="rounded-full px-1.5 text-[10px] font-semibold tabular-nums"
                style={{
                  background: "var(--color-changed)",
                  color: "var(--color-bg)",
                }}
              >
                {changes}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
