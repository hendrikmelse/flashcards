import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  AddConceptResult,
  AddMirrorsResult,
  AddPackResult,
  ConceptCardDetail,
  ConceptSearchResponse,
  LanguageInfo,
  PackDetailResponse,
  PackListItem,
} from "@flashcards/shared";
import { api } from "./client";

export type Direction = { from: string; to: string };

// The Add words pages always show words English to Dutch, and add them both ways round.
export const ADD_DIRECTION: Direction = { from: "en", to: "nl" };
export const OTHER_WAY: Direction = { from: ADD_DIRECTION.to, to: ADD_DIRECTION.from };

const dirQuery = ({ from, to }: Direction) =>
  `fromLanguage=${encodeURIComponent(from)}&toLanguage=${encodeURIComponent(to)}`;

export function useLanguages() {
  return useQuery({
    queryKey: ["languages"],
    queryFn: async () => (await api<{ languages: LanguageInfo[] }>("/languages")).languages,
    staleTime: Infinity,
  });
}

export function usePacks(direction: Direction) {
  return useQuery({
    queryKey: ["packs", direction.from, direction.to],
    queryFn: async () =>
      (await api<{ packs: PackListItem[] }>(`/packs?${dirQuery(direction)}`)).packs,
  });
}

// Shortest time a spinner shows, so a fast response doesn't flash it.
const MIN_SPINNER_MS = 300;

export const SEARCH_PAGE_SIZE = 50;

// Words matching `term` (either language of the direction), a page at a time.
// Waits for a term of two or more characters, and keeps the previous results
// while typing.
export function useConceptSearch(term: string, direction: Direction, hideInDeck: boolean) {
  return useInfiniteQuery({
    queryKey: ["concept-search", direction.from, direction.to, term, hideInDeck],
    enabled: term.length >= 2,
    placeholderData: (previous) => previous,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const request = api<ConceptSearchResponse>(
        `/concepts/search?q=${encodeURIComponent(term)}&${dirQuery(direction)}&limit=${SEARCH_PAGE_SIZE}&offset=${pageParam}${hideInDeck ? "&hideInDeck=1" : ""}`,
      );
      // "Load more" shows a spinner; keep it from flashing. Not for the first page,
      // which should appear as soon as it is ready.
      const wait = pageParam === 0 ? 0 : MIN_SPINNER_MS;
      const [page] = await Promise.all([request, new Promise((r) => setTimeout(r, wait))]);
      return page;
    },
    getNextPageParam: (last: ConceptSearchResponse, pages: ConceptSearchResponse[]) => (last.hasMore ? pages.length * SEARCH_PAGE_SIZE : undefined),
  });
}

// The whole pack in one request. Packs top out around 500 words; the API allows up to 1000.
const PACK_LIMIT = 1000;

export function usePackConcepts(packId: string, direction: Direction) {
  return useQuery({
    queryKey: ["pack", packId, direction.from, direction.to],
    queryFn: () =>
      api<PackDetailResponse>(`/packs/${packId}?${dirQuery(direction)}&limit=${PACK_LIMIT}`),
  });
}

// One word as a card, with all its example sentences, for the card view on the Add words pages.
export function useConceptCard(conceptId: string, direction: Direction) {
  return useQuery({
    queryKey: ["concept", conceptId, direction.from, direction.to],
    queryFn: () => api<ConceptCardDetail>(`/concepts/${conceptId}?${dirQuery(direction)}`),
  });
}

// Anything that changes the deck also changes pack progress, the dashboard
// and the study queue.
function useInvalidateAfterDeckChange() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ["packs", "pack", "concept-search", "deck", "study", "stats"].map((key) => qc.invalidateQueries({ queryKey: [key] })),
    );
}

// Adds the pack's words in both directions. The counts are in cards, so two for each word.
export function useAddPack(packId: string) {
  const invalidate = useInvalidateAfterDeckChange();
  return useMutation({
    mutationFn: async () => {
      const [result] = await Promise.all([
        api<AddPackResult>(`/packs/${packId}/add`, {
          method: "POST",
          body: { fromLanguage: ADD_DIRECTION.from, toLanguage: ADD_DIRECTION.to, bothDirections: true },
        }),
        new Promise((resolve) => setTimeout(resolve, MIN_SPINNER_MS)),
      ]);
      return result;
    },
    onSuccess: invalidate,
  });
}

// One card's reverse: the same word, studied the other way around.
export function useAddMirror() {
  const invalidate = useInvalidateAfterDeckChange();
  return useMutation({
    mutationFn: async (v: { cardId: string; conceptId: string; fromLanguage: string; toLanguage: string }) => {
      const [result] = await Promise.all([
        api<AddConceptResult>(`/concepts/${v.conceptId}/add`, {
          method: "POST",
          body: { fromLanguage: v.fromLanguage, toLanguage: v.toLanguage },
        }),
        new Promise((resolve) => setTimeout(resolve, MIN_SPINNER_MS)),
      ]);
      return result;
    },
    onSuccess: invalidate,
  });
}

// The reverse of every card in a view of the deck that does not have one yet.
export type MirrorFilter = { fromLanguage?: string; toLanguage?: string; state?: string; q?: string };
export function useAddMirrors() {
  const invalidate = useInvalidateAfterDeckChange();
  return useMutation({
    mutationFn: async (filter: MirrorFilter) => {
      const [result] = await Promise.all([
        api<AddMirrorsResult>("/deck/mirrors", { method: "POST", body: filter }),
        new Promise((resolve) => setTimeout(resolve, MIN_SPINNER_MS)),
      ]);
      return result;
    },
    onSuccess: invalidate,
  });
}

// Adds one word in both directions.
export function useAddConcept() {
  const invalidate = useInvalidateAfterDeckChange();
  return useMutation({
    mutationFn: async (conceptId: string) => {
      const [result] = await Promise.all([
        api<AddConceptResult>(`/concepts/${conceptId}/add`, {
          method: "POST",
          body: { fromLanguage: ADD_DIRECTION.from, toLanguage: ADD_DIRECTION.to, bothDirections: true },
        }),
        new Promise((resolve) => setTimeout(resolve, MIN_SPINNER_MS)),
      ]);
      return result;
    },
    onSuccess: invalidate,
  });
}
