import { AlertTriangle, FileEdit, Globe } from "lucide-react";
import { makeT } from "../i18n";
import type { GraphMeta, Lang, Slot } from "../types";

// The published / draft switch, plus what the draft changes.
//
// Publish used to be an act of faith: the only view of a draft was a diff
// narrated back in chat. This is the "look at your own work first" affordance —
// the same graph, read from the unpublished slot, with every added or changed
// node tagged and the removed ones listed (they are gone from the draft, so a
// deletion has nowhere else to show).
//
// It appears only when a draft exists; reading it is curator-gated server-side,
// and a refusal comes back as `notice` rather than an error screen.

type Props = {
  lang: Lang;
  slot: Slot;
  hasDraft: boolean;
  meta: GraphMeta | null;
  notice: string | null;
  onSelect: (slot: Slot) => void;
};

const TAB_BASE =
  "flex items-center gap-1.5 rounded-lg border px-2.5 py-[5px] text-xs font-semibold";

export function SlotSwitch({ lang, slot, hasDraft, meta, notice, onSelect }: Props) {
  const t = makeT(lang);
  if (!hasDraft && !notice) return null;

  const counts = meta?.draft?.counts;
  const removed = meta?.draft?.removed ?? [];

  const tab = (value: Slot, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      className={`${TAB_BASE} ${
        slot === value
          ? "border-accent bg-panel2 text-txt"
          : "border-line text-muted hover:border-accent hover:text-txt"
      }`}
      onClick={() => onSelect(value)}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="border-b border-line px-[22px] py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {tab("published", <Globe size={13} />, t("slotPublished"))}
        {hasDraft && tab("draft", <FileEdit size={13} />, t("slotDraft"))}

        {slot === "draft" && counts && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <ChangeChip color="var(--color-added)" value={counts.added} label={t("chgAdded")} />
            <ChangeChip color="var(--color-changed)" value={counts.changed} label={t("chgChanged")} />
            <ChangeChip color="var(--color-removed)" value={counts.removed} label={t("chgRemoved")} />
          </div>
        )}
      </div>

      {notice && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-err">
          <AlertTriangle size={13} />
          {notice}
        </div>
      )}

      {slot === "draft" && (
        <div className="mt-2 text-xs text-muted">{t("draftHint")}</div>
      )}

      {/* Removed nodes cannot carry a tag in the tree — they are not in the draft
          at all — so they are listed here or a deletion would be invisible. */}
      {slot === "draft" && removed.length > 0 && (
        <details className="mt-2 text-xs text-muted">
          <summary className="cursor-pointer">
            {t("chgRemovedList")} ({removed.length})
          </summary>
          <ul className="mt-1 ml-4 list-disc">
            {removed.map((node) => (
              <li key={node.id}>
                <span className="text-[color:var(--color-removed)]">{node.desc || node.id}</span>{" "}
                <span className="opacity-70">({node.label})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ChangeChip({ color, value, label }: { color: string; value: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel2 px-2.5 py-1">
      <span className="h-[9px] w-[9px] rounded-full" style={{ background: color }} />
      <b className="font-semibold text-txt">{value}</b> {label}
    </span>
  );
}
