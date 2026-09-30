import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  DeckResponse,
  LoginInput,
  PublicUser,
  RegisterInput,
  StudyResponse,
} from "@flashcards/shared";
import { api, ApiError } from "./client";

const ME = ["me"] as const;

// Swap the signed-in user and drop everything cached for the previous one.
// The "me" query is updated in place (not removed) so mounted components that
// observe it re-render.
function setUser(qc: QueryClient, user: PublicUser | null) {
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME[0] });
  qc.setQueryData(ME, user);
}

// The current user, or null when logged out. Never throws for a 401.
export function useMe() {
  return useQuery({
    queryKey: ME,
    queryFn: async () => {
      try {
        return (await api<{ user: PublicUser }>("/auth/me")).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: Infinity,
  });
}

function useStartSession(path: "/auth/login" | "/auth/register") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput | RegisterInput) =>
      api<{ user: PublicUser }>(path, { method: "POST", body: input }),
    onSuccess: ({ user }) => setUser(qc, user),
  });
}

export const useLogin = () => useStartSession("/auth/login");
export const useRegister = () => useStartSession("/auth/register");

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/auth/logout", { method: "POST" }),
    onSuccess: () => setUser(qc, null),
  });
}

// Dashboard numbers: deck totals plus what is ready to study right now.
export function useDashboard() {
  const deck = useQuery({
    queryKey: ["deck", "summary"],
    queryFn: () => api<DeckResponse>("/deck?limit=1"),
  });
  const study = useQuery({
    queryKey: ["study", "counts"],
    queryFn: () => api<StudyResponse>("/study?limit=1"),
  });
  return { deck, study };
}
