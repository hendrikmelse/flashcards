export interface Email {
  to: string;
  subject: string;
  text: string;
}

/** Sends an email. Throws when it could not be handed to the provider. */
export interface Mailer {
  send(email: Email): Promise<void>;
}

/** Sends through Resend's HTTP API. */
export function createResendMailer({
  apiKey,
  from,
  fetchFn = fetch,
}: {
  apiKey: string;
  from: string;
  fetchFn?: typeof fetch;
}): Mailer {
  return {
    async send({ to, subject, text }) {
      const res = await fetchFn("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        // The body says what was wrong (an unverified domain, a bad key); it holds no secrets.
        throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
    },
  };
}

/** Prints emails instead of sending them, for development. */
export function createConsoleMailer(log: (line: string) => void = console.log): Mailer {
  return {
    async send({ to, subject, text }) {
      log(`\n--- email to ${to} ---\nSubject: ${subject}\n\n${text}\n---`);
    },
  };
}

/** Keeps the emails it is given, for tests. */
export function createMemoryMailer(): Mailer & { sent: Email[] } {
  const sent: Email[] = [];
  return {
    sent,
    async send(email) {
      sent.push(email);
    },
  };
}
