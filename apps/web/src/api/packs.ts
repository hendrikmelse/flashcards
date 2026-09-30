import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  AddConceptResult,
  AddPackResult,
  LanguageInfo,
  PackDetailResponse,
  PackListItem,
} from "@flashcards/shared";
import { api } from "./client";

export type Direction = { from: string; to: string };

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

export const PACK_PAGE_SIZE = 50;

// Pack contents, loaded a page at a time since packs can be large.
export function usePackConcepts(packId: string, direction: Direction) {
  return useInfiniteQuery({
    queryKey: ["pack", packId, direction.from, direction.to],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<PackDetailResponse>(
        `/packs/${packId}?${dirQuery(direction)}&limit=${PACK_PAGE_SIZE}&offset=${pageParam}`,
      ),
    getNextPageParam: (last, pages) =>
      last.concepts.length < PACK_PAGE_SIZE ? undefined : pages.length * PACK_PAGE_SIZE,
  });
}

// Anything that changes the deck also changes pack progress, the dashboard
// and the study queue.
function useInvalidateAfterDeckChange() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ["packs", "pack", "deck", "study"].map((key) => qc.invalidateQueries({ queryKey: [key] })),
    );
}

export function useAddPack(packId: string, direction: Direction) {
  const invalidate = useInvalidateAfterDeckChange();
  return useMutation({
    mutationFn: () =>
      api<AddPackResult>(`/packs/${packId}/add`, {
        method: "POST",
        body: { fromLanguage: direction.from, toLanguage: direction.to },
      }),
    onSuccess: invalidate,
  });
}

export function useAddConcept(direction: Direction) {
  const invalidate = useInvalidateAfterDeckChange();
  return useMutation({
    mutationFn: (conceptId: string) =>
      api<AddConceptResult>(`/concepts/${conceptId}/add`, {
        method: "POST",
        body: { fromLanguage: direction.from, toLanguage: direction.to },
      }),
    onSuccess: invalidate,
  });
}
