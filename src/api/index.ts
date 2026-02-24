import { Hono } from "hono";
import { authMiddleware } from "./auth";
import type { Env, User } from "./types";

import authRouter from "./routes/auth";
import adminRouter from "./routes/admin";
import projectRouter from "./routes/project";
import templateRouter from "./routes/template";
import modelsRouter from "./routes/models";
import reportRouter from "./routes/report";

const app = new Hono<{ Bindings: Env; Variables: { user: User | null } }>();

app.use("*", async (c, next) => {
  const originHeader = c.req.header("Origin");
  const allowedOrigins = c.env.APP_ORIGIN
    ? c.env.APP_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
    : [];
  if (originHeader && allowedOrigins.includes(originHeader)) {
    c.header("Access-Control-Allow-Origin", originHeader);
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Vary", "Origin");
  }
  c.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }
  await next();
});

app.use("*", authMiddleware);

app.get("/api/health", (c) => c.json({ ok: true }));

app.route("/api/auth", authRouter);
app.route("/api/admin", adminRouter);
app.route("/api/projects", projectRouter);
app.route("/api/templates", templateRouter);
app.route("/api/models", modelsRouter);
app.route("/api", reportRouter);

app.notFound((c) => c.json({ error: "Not Found" }, 404));

export default app;
