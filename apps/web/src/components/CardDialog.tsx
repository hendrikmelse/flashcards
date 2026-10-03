import { useEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { DeckCardView, LanguageInfo } from "@flashcards/shared";
import { useDeckCard } from "../api/hooks";
import { formatUntil } from "../lib/relativeTime";
import { Entries, Forms, Sentences } from "./CardParts";
import { displayLemma, entriesFor, languageName } from "./entries";

const STATE_LABEL = { new: "New", learning: "Learning", relearning: "Relearning", review: "Review" } as const;

function when(card: DeckCardView): string {
  if (card.state === "new") return "Not studied yet";
  const now = new Date().toISOString();
  return Date.parse(card.dueAt) <= Date.parse(now) ? "Due now" : `Due ${formatUntil(card.dueAt, now)}`;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

// A card from the deck, both sides, with its example sentences and word forms: what you would see
// while studying it, without the studying. Opens over the page; Escape, the close button or a click
// outside it closes it, and focus returns to where it was.
export function CardDialog({
  card,
  languages,
  onClose,
}: {
  card: DeckCardView;
  languages: LanguageInfo[];
  onClose: () => void;
}) {
  const detail = useDeckCard(card.id);
  const shown = detail.data?.card ?? card; // the list's copy until the fresh one arrives
  const sentences = detail.data?.sentences;
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // the page behind does not scroll
    return () => {
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, []);

  // Escape closes; Tab stays inside the dialog.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const items = [...(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const front = entriesFor(shown.front, shown.fromLanguage).map(displayLemma).join(", ");
  const facts = [
    ["Status", STATE_LABEL[shown.state]],
    ["Due", shown.state === "new" ? "Not studied yet" : when(shown).replace(/^Due /, "")],
    ["Added", new Date(shown.addedAt).toLocaleDateString(undefined, { dateStyle: "medium" })],
  ] as const;
  const noSentences = sentences && sentences.front.length === 0 && sentences.back.length === 0;

  return createPortal(
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Card: ${front}`}
        onKeyDown={onKeyDown}
      >
        <button ref={close} type="button" className="dialog-close icon-button" aria-label="Close" onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>

        <p className="study-meta">
          {languageName(languages, shown.fromLanguage)} → {languageName(languages, shown.toLanguage)}
        </p>

        <section aria-label="Front">
          <Entries entries={shown.front} language={shown.fromLanguage} languages={languages} />
          <Forms entries={shown.front} />
          {sentences && <Sentences items={sentences.front} />}
        </section>

        <section aria-label="Back" className="study-answer">
          <Entries entries={shown.back} language={shown.toLanguage} languages={languages} />
          <Forms entries={shown.back} />
          {sentences && <Sentences items={sentences.back} />}
        </section>

        {detail.isPending && <p className="muted">Loading example sentences…</p>}
        {detail.isError && <p className="form-error">Could not load the example sentences.</p>}
        {noSentences && <p className="muted">No example sentences yet.</p>}

        <dl className="card-facts" aria-label="Where this card stands">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>,
    document.body,
  );
}
