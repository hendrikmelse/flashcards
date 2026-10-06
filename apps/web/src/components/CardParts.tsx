import { formLines, isFormNote, type EntryView, type LanguageInfo } from "@flashcards/shared";
import { displayLemma, langAttrs, languageName } from "./entries";
import { LanguageFlag } from "./LanguageFlag";

// The pieces of a card's face, shared by the study screen and the deck viewer's card view.

// The word, with a flag for the language it is in.
// `id` lets something else point at the word (the Good button reads the answer through it).
export function Entries({
  entries,
  language,
  languages,
  id,
}: {
  entries: EntryView[];
  language: string;
  languages: LanguageInfo[];
  id?: string;
}) {
  return (
    <div className="flagged">
      <LanguageFlag code={language} label={languageName(languages, language)} />
      <p className="study-word" id={id}>
        {entries.map((e, i) => (
          <span key={`${e.lemma}-${i}`}>
            {i > 0 && ", "}
            {/* The word is in its own language, so a screen reader pronounces it that way. */}
            <span {...langAttrs(language)}>{displayLemma(e)}</span>
            {e.partOfSpeech && <span className="pos"> {e.partOfSpeech}</span>}
          </span>
        ))}
      </p>
    </div>
  );
}

// Word forms (noun plural; verb past, participle, and irregular present). Entries without
// forms render nothing.
export function Forms({ entries }: { entries: EntryView[] }) {
  const withForms = entries
    .map((e) => ({ e, lines: formLines(e.language, e.details) }))
    .filter(({ lines }) => lines.length > 0);
  if (withForms.length === 0) return null;
  return (
    <>
      {withForms.map(({ e, lines }) => (
        <dl key={e.lemma} className="forms" aria-label={`Forms of ${e.lemma}`}>
          {withForms.length > 1 && (
            <dt className="forms-lemma" {...langAttrs(e.language)}>
              {e.lemma}
            </dt>
          )}
          {lines.map((l) => (
            <div key={l.label}>
              <dt>{l.label}</dt>
              <dd {...(isFormNote(l.value) ? {} : langAttrs(e.language))}>{l.value}</dd>
            </div>
          ))}
        </dl>
      ))}
    </>
  );
}

// Holds the room of one sentence while the sentences load, so what follows does not jump when they arrive.
export function SentencePlaceholder() {
  return <p className="sentence sentence-placeholder" aria-hidden="true" />;
}

export function Sentences({ items, language }: { items: string[]; language: string }) {
  return (
    <>
      {items.map((s) => (
        <p key={s} className="sentence" {...langAttrs(language)}>
          {s}
        </p>
      ))}
    </>
  );
}
