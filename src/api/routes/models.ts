import { Hono } from "hono";
import { requireAuth } from "../auth";
import { listPublicModelsForPlan, listModelNamesByPlan } from "../models";
import { resolveUserPlan } from "../services/core";
import type { Env, User } from "../types";

const app = new Hono<{ Bindings: Env; Variables: { user: User | null } }>();

app.get("/", requireAuth, async (c) => {
    const user = c.get("user");
    const plan = resolveUserPlan(user);
    const result = await listPublicModelsForPlan(c.env, plan);
    return c.json(result);
});

app.get("/tiers", requireAuth, async (c) => {
    const tiers = await listModelNamesByPlan(c.env);
    return c.json({ tiers });
});

export default app;
