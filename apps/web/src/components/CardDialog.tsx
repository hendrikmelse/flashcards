import { useEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { DeckCardView, EntryView, LanguageInfo } from "@flashcards/shared";
import { useDeckCard } from "../api/hooks";
import { ADD_DIRECTION, useConceptCard, useLanguages } from "../api/packs";
import { formatUntil } from "../lib/relativeTime";
import { Entries, Forms, Sentences } from "./CardParts";
import { ReportProblem } from "./ReportProblem";
import { displayLemma, entriesFor, languageName } from "./entries";

const STATE_LABEL = { new: "New", learning: "Learning", relearning: "Relearning", review: "Review" } as const;

function when(card: DeckCardView): string {
  if (card.state === "new") return "Not studied yet";
  const now = new Date().toISOString();
  return Date.parse(card.dueAt) <= Date.parse(now) ? "Due now" : `Due ${formatUntil(card.dueAt, now)}`;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

type Frame = {
  conceptId: string;
  fromLanguage: string;
  toLanguage: string;
  front: EntryView[];
  back: EntryView[];
  /** Undefined until they have loaded. */
  sentences: { front: string[]; back: string[] } | undefined;
  failed: boolean;
  /** Where the card stands, for a card in the deck. */
  facts?: readonly (readonly [string, string])[];
  /** Tells the report form which card it is on, so it starts fresh for each. */
  reportKey: string;
  languages: LanguageInfo[];
  onClose: () => void;
};

// A card, both sides, with its example sentences and word forms: what you would see while
// studying it, without the studying. Opens over the page; Escape, the close button or a click
// outside it closes it, and focus returns to where it was.
function CardFrame({
  conceptId,
  fromLanguage,
  toLanguage,
  front,
  back,
  sentences,
  failed,
  facts,
  reportKey,
  languages,
  onClose,
}: Frame) {
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

  const title = entriesFor(front, fromLanguage).map(displayLemma).join(", ");
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
        aria-label={`Card: ${title}`}
        onKeyDown={onKeyDown}
      >
        <button ref={close} type="button" className="dialog-close icon-button" aria-label="Close" onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>

        <p className="study-meta">
          {languageName(languages, fromLanguage)} → {languageName(languages, toLanguage)}
        </p>

        <section aria-label="Front">
          <Entries entries={front} language={fromLanguage} languages={languages} />
          <Forms entries={front} />
          {sentences && <Sentences items={sentences.front} />}
        </section>

        <section aria-label="Back" className="study-answer">
          <Entries entries={back} language={toLanguage} languages={languages} />
          <Forms entries={back} />
          {sentences && <Sentences items={sentences.back} />}
        </section>

        {!sentences && !failed && <p className="muted">Loading example sentences…</p>}
        {failed && <p className="form-error">Could not load the example sentences.</p>}
        {noSentences && <p className="muted">No example sentences yet.</p>}

        {facts && (
          <dl className="card-facts" aria-label="Where this card stands">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}

        <ReportProblem key={reportKey} conceptId={conceptId} fromLanguage={fromLanguage} toLanguage={toLanguage} />
      </div>
    </div>,
    document.body,
  );
}

// A card from the deck, with where it stands.
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
  const facts = [
    ["Status", STATE_LABEL[shown.state]],
    ["Due", shown.state === "new" ? "Not studied yet" : when(shown).replace(/^Due /, "")],
    ["Added", new Date(shown.addedAt).toLocaleDateString(undefined, { dateStyle: "medium" })],
  ] as const;
  return (
    <CardFrame
      conceptId={shown.conceptId}
      fromLanguage={shown.fromLanguage}
      toLanguage={shown.toLanguage}
      front={shown.front}
      back={shown.back}
      sentences={detail.data?.sentences}
      failed={detail.isError}
      facts={facts}
      reportKey={shown.id}
      languages={languages}
      onClose={onClose}
    />
  );
}

// A word from the Add words page, which may not be in the deck: shown English to Dutch, with the
// words the page already has until the example sentences arrive.
export function ConceptDialog({
  conceptId,
  entries,
  onClose,
}: {
  conceptId: string;
  entries: EntryView[];
  onClose: () => void;
}) {
  const languages = useLanguages();
  const detail = useConceptCard(conceptId, ADD_DIRECTION);
  const { from, to } = ADD_DIRECTION;
  return (
    <CardFrame
      conceptId={conceptId}
      fromLanguage={from}
      toLanguage={to}
      front={detail.data?.front ?? entries.filter((e) => e.language === from)}
      back={detail.data?.back ?? entries.filter((e) => e.language === to)}
      sentences={detail.data?.sentences}
      failed={detail.isError}
      reportKey={conceptId}
      languages={languages.data ?? []}
      onClose={onClose}
    />
  );
}
