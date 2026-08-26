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
  // The added/changed counts double as the "show me where" control: clicking one
  // prunes the tree to the changed branches. Removed nodes aren't in the draft at
  // all, so that chip stays inert and the list below is their only home.
  changesOnly: boolean;
  onChangesOnly: (on: boolean) => void;
};

const TAB_BASE =
  "flex items-center gap-1.5 rounded-lg border px-2.5 py-[5px] text-xs font-semibold";

export function SlotSwitch({
  lang,
  slot,
  hasDraft,
  meta,
  notice,
  onSelect,
  changesOnly,
  onChangesOnly,
}: Props) {
  const t = makeT(lang);
  if (!hasDraft && !notice) return null;

  const counts = meta?.draft?.counts;
  const removed = meta?.draft?.removed ?? [];
  const unlinked = meta?.draft?.unlinked ?? [];

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
            <ChangeChip
              color="var(--color-added)"
              value={counts.added}
              label={t("chgAdded")}
              pressed={changesOnly}
              title={t("chgOnlyTitle")}
              onClick={() => onChangesOnly(!changesOnly)}
            />
            <ChangeChip
              color="var(--color-changed)"
              value={counts.changed}
              label={t("chgChanged")}
              pressed={changesOnly}
              title={t("chgOnlyTitle")}
              onClick={() => onChangesOnly(!changesOnly)}
            />
            <ChangeChip
              color="var(--color-removed)"
              value={counts.removed}
              label={t("chgRemoved")}
            />

            {/* Link counts, so an edit that only wires two existing nodes
                together still reports something instead of reading 0/0/0.
                `?? 0` covers a server that predates these fields. */}
            <ChangeChip
              color="var(--color-added)"
              value={counts.linked ?? 0}
              label={t("chgLinked")}
              pressed={changesOnly}
              title={t("chgOnlyTitle")}
              onClick={() => onChangesOnly(!changesOnly)}
            />
            <ChangeChip
              color="var(--color-removed)"
              value={counts.unlinked ?? 0}
              label={t("chgUnlinked")}
            />

            {changesOnly && (
              <button
                type="button"
                className="rounded-full border border-line px-2.5 py-1 text-muted hover:border-accent hover:text-txt"
                onClick={() => onChangesOnly(false)}
              >
                {t("chgShowAll")}
              </button>
            )}
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

      {/* A deleted link has the same problem for the same reason: it is gone from
          the draft, so no row can carry it. */}
      {slot === "draft" && unlinked.length > 0 && (
        <details className="mt-2 text-xs text-muted">
          <summary className="cursor-pointer">
            {t("chgUnlinkedList")} ({unlinked.length})
          </summary>
          <ul className="mt-1 ml-4 list-disc">
            {unlinked.map((link, i) => (
              <li key={`${link.rel}:${link.from}->${link.to}:${i}`}>
                <span className="text-[color:var(--color-removed)]">{link.from}</span>{" "}
                <span className="opacity-70">─{link.rel}→</span>{" "}
                <span className="text-[color:var(--color-removed)]">{link.to}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

type ChipProps = {
  color: string;
  value: number;
  label: string;
  // Given together to make the chip a filter toggle; omitted for a plain count.
  pressed?: boolean;
  title?: string;
  onClick?: () => void;
};

function ChangeChip({ color, value, label, pressed, title, onClick }: ChipProps) {
  const body = (
    <>
      <span className="h-[9px] w-[9px] rounded-full" style={{ background: color }} />
      <b className="font-semibold text-txt">{value}</b> {label}
    </>
  );

  const base = "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1";

  // A zero count has nothing to filter to, so it stays a plain chip even when the
  // caller passed a handler — clicking it would empty the tree for no reason.
  if (!onClick || value === 0) {
    return <span className={`${base} border-line bg-panel2`}>{body}</span>;
  }

  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      className={`${base} cursor-pointer ${
        pressed ? "border-accent bg-panel" : "border-line bg-panel2 hover:border-accent"
      }`}
      onClick={onClick}
    >
      {body}
    </button>
  );
}
