export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

type Options = { method?: "GET" | "POST" | "PATCH"; body?: unknown };

// All requests go to the same origin under /api (see vite.config.ts), so the
// session cookie is sent automatically.
export async function api<T>(path: string, { method = "GET", body }: Options = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return undefined as T;

  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: unknown }).error)
        : res.statusText;
    throw new ApiError(res.status, message, data);
  }
  return data as T;
}
