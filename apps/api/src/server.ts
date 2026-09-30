import { buildApp } from "./app.js";
import { config } from "./config.js";
import { db } from "./db/client.js";

const app = await buildApp({ db });
await app.listen({ port: config.PORT, host: "0.0.0.0" });
