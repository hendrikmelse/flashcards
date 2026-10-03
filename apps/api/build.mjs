// Bundles the API into dist/ for production. Third-party dependencies stay
// external (installed in the runtime image); workspace packages such as
// @flashcards/shared ship as TypeScript source, so they are bundled in.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith("@flashcards/"));

await build({
  entryPoints: {
    server: "src/server.ts",
    migrate: "src/db/migrate.ts",
    "seed-languages": "src/db/seed-languages-cli.ts",
    "import-content": "src/db/import-content-cli.ts",
    reports: "src/db/reports-cli.ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outdir: "dist",
  sourcemap: true,
  external,
  logLevel: "info",
});
