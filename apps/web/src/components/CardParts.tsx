import { formLines, type EntryView, type LanguageInfo } from "@flashcards/shared";
import { displayLemma, languageName } from "./entries";
import { LanguageFlag } from "./LanguageFlag";

// The pieces of a card's face, shared by the study screen and the deck viewer's card view.

// The word, with a flag for the language it is in.
export function Entries({
  entries,
  language,
  languages,
}: {
  entries: EntryView[];
  language: string;
  languages: LanguageInfo[];
}) {
  return (
    <div className="flagged">
      <LanguageFlag code={language} label={languageName(languages, language)} />
      <p className="study-word">
        {entries.map((e, i) => (
          <span key={`${e.lemma}-${i}`}>
            {i > 0 && ", "}
            {displayLemma(e)}
            {e.partOfSpeech && <span className="pos"> {e.partOfSpeech}</span>}
          </span>
        ))}
      </p>
    </div>
  );
}

// Word forms (noun plural; verb past, participle and irregular present). Entries without
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
          {withForms.length > 1 && <dt className="forms-lemma">{e.lemma}</dt>}
          {lines.map((l) => (
            <div key={l.label}>
              <dt>{l.label}</dt>
              <dd>{l.value}</dd>
            </div>
          ))}
        </dl>
      ))}
    </>
  );
}

export function Sentences({ items }: { items: string[] }) {
  return (
    <>
      {items.map((s) => (
        <p key={s} className="sentence">
          {s}
        </p>
      ))}
    </>
  );
}
