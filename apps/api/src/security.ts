import type { FastifyReply, FastifyRequest } from "fastify";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Rejects state-changing requests that a browser marks as coming from another
// origin. Session cookies are SameSite=Lax; this is a second, cheap layer.
// Requests without an Origin header (curl, server-to-server, tests) pass:
// browsers always send Origin on cross-origin POSTs.
export async function originCheck(req: FastifyRequest, reply: FastifyReply) {
  if (SAFE_METHODS.has(req.method)) return;
  const origin = req.headers.origin;
  if (origin === undefined) return;

  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    // "null" and malformed origins fall through and are rejected below.
  }
  if (originHost !== req.headers.host) {
    return reply.code(403).send({ error: "Cross-origin request blocked" });
  }
}

export function helmetOptions(production: boolean) {
  return {
    contentSecurityPolicy: {
      directives: {
        // The default directive would rewrite http:// subresources to https://,
        // which breaks local development over plain http.
        upgradeInsecureRequests: production ? [] : null,
      },
    },
    // HSTS is only meaningful over HTTPS. Not applied to subdomains because
    // other apps may share this domain.
    strictTransportSecurity: production
      ? { maxAge: 15_552_000, includeSubDomains: false }
      : false,
  };
}
