import { entryNote, formLines, isFormNote, parseSentence, type EntryView, type LanguageInfo } from "@flashcards/shared";
import { displayLemma, langAttrs, languageName } from "./entries";
import { LanguageFlag } from "./LanguageFlag";

// The pieces of a card's face, shared by the study screen and the deck viewer's card view.

// One side of a card: each of its words in turn, with its own forms and example sentences under it,
// and the flag of the language beside it.
// `sentences` holds the sentences of each word, in the order of `entries`; without it they are not
// loaded yet (`loadingSentences` holds their room meanwhile). `id` lets something else point at the
// words (the Good button reads the answer through them): the word at index i has the id `${id}-${i}`.
export function Words({
  entries,
  sentences,
  language,
  languages,
  id,
  showForms = true,
  showSentences = true,
  loadingSentences = false,
}: {
  entries: EntryView[];
  sentences?: string[][];
  language: string;
  languages: LanguageInfo[];
  id?: string;
  showForms?: boolean;
  showSentences?: boolean;
  loadingSentences?: boolean;
}) {
  return (
    <>
      {entries.map((e, i) => (
        <div key={`${e.lemma}-${i}`} className="entry-block">
          <div className="flagged">
            <LanguageFlag code={language} label={languageName(languages, language)} />
            <p className="study-word" id={id ? `${id}-${i}` : undefined}>
              {/* The word is in its own language, so a screen reader pronounces it that way. */}
              <span {...langAttrs(language)}>{displayLemma(e)}</span>
              {e.partOfSpeech && <span className="pos"> {e.partOfSpeech}</span>}
              {/* Which sense or use this is, in the word's own language, like the word. */}
              {entryNote(e.details) && (
                <span className="note" {...langAttrs(language)}>
                  {" "}
                  [{entryNote(e.details)}]
                </span>
              )}
            </p>
          </div>
          {showForms && <Forms entry={e} />}
          {showSentences &&
            (sentences ? (
              <Sentences items={sentences[i] ?? []} language={language} />
            ) : (
              loadingSentences && <SentencePlaceholder />
            ))}
        </div>
      ))}
    </>
  );
}

// A word's forms (noun plural; verb past, participle, and irregular present). A word without
// forms renders nothing.
function Forms({ entry }: { entry: EntryView }) {
  const lines = formLines(entry.language, entry.details);
  if (lines.length === 0) return null;
  return (
    <dl className="forms" aria-label={`Forms of ${entry.lemma}`}>
      {lines.map((l) => (
        <div key={l.label}>
          <dt>{l.label}</dt>
          <dd {...(isFormNote(l.value) ? {} : langAttrs(entry.language))}>{l.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// Holds the room of one sentence while the sentences load, so what follows does not jump when they arrive.
function SentencePlaceholder() {
  return <p className="sentence sentence-placeholder" aria-hidden="true" />;
}

// Example sentences in the card's language, with the card's word in bold among the rest of the
// sentence. The sentence says which word that is, between asterisks.
export function Sentences({ items, language }: { items: string[]; language: string }) {
  return (
    <>
      {items.map((s) => (
        <p key={s} className="sentence" {...langAttrs(language)}>
          {parseSentence(s).map((part, i) =>
            part.word ? (
              <span key={i} className="sentence-word">
                {part.text}
              </span>
            ) : (
              part.text
            ),
          )}
        </p>
      ))}
    </>
  );
}
