import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import workerApp from "./api/index";
import { createEnv } from "./env";

const env = createEnv();
const port = Number(process.env.PORT ?? 8787);
const currentDir = dirname(fileURLToPath(import.meta.url));
const staticRoot = process.env.WEB_DIST_DIR ?? resolve(currentDir, "../web/dist");
const indexHtmlPath = resolve(staticRoot, "index.html");
const indexHtml = readFileSync(indexHtmlPath, "utf8");

const app = new Hono();
app.use("/api", async (c) => workerApp.fetch(c.req.raw, env));
app.use("/api/*", async (c) => workerApp.fetch(c.req.raw, env));
app.use("/*", serveStatic({ root: staticRoot }));
app.get("*", (c) => c.html(indexHtml));

serve({
  port,
  fetch: (request) => app.fetch(request, env)
});

// eslint-disable-next-line no-console
console.log(`QRAi mono server running on http://localhost:${port}`);
