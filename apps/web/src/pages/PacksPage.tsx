import { Link } from "react-router";
import type { LanguageInfo } from "@flashcards/shared";
import { useLanguages, usePacks } from "../api/packs";
import { DirectionPicker } from "../components/DirectionPicker";
import { useDirection } from "../hooks/useDirection";

export function PacksPage() {
  const languages = useLanguages();
  if (languages.isPending) return <p className="status">Loading…</p>;
  if (languages.isError) return <p className="status error">Could not load languages.</p>;
  if (languages.data.length < 2) {
    return <p className="status">Packs need at least two languages to be available.</p>;
  }
  return <PackList languages={languages.data} />;
}

function PackList({ languages }: { languages: LanguageInfo[] }) {
  const { direction, setDirection, search } = useDirection(languages);
  const packs = usePacks(direction);

  return (
    <>
      <h1>Packs</h1>
      <p className="lead">Pick a pack of words to add to your deck.</p>
      <DirectionPicker languages={languages} direction={direction} onChange={setDirection} />

      {packs.isPending && <p className="status">Loading…</p>}
      {packs.isError && <p className="status error">Could not load packs. Please refresh.</p>}
      {packs.data?.length === 0 && <p className="empty">There are no packs yet.</p>}

      <ul className="pack-list">
        {packs.data?.map((pack) => {
          const available = pack.availableCount ?? 0;
          const added = pack.addedCount ?? 0;
          return (
            <li key={pack.id} className="pack-card">
              <h2>
                <Link to={`/packs/${pack.id}${search}`}>{pack.name}</Link>
              </h2>
              {pack.description && <p className="muted">{pack.description}</p>}
              {available === 0 ? (
                <p className="muted">No words available in this direction yet.</p>
              ) : (
                <>
                  <progress
                    value={added}
                    max={available}
                    aria-label={`${pack.name}: ${added} of ${available} words in your deck`}
                  />
                  <p className="muted">
                    {added === available
                      ? `All ${available} words are in your deck`
                      : `${added} of ${available} words in your deck`}
                    {pack.conceptCount > available &&
                      ` · ${pack.conceptCount - available} not available in this direction yet`}
                  </p>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
