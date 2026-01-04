import type { Env, PlanTier } from "./types";
import { getPlanMonthlyLimit } from "./plan";
import { nowIso } from "./utils";

export type QuotaSnapshot = {
  remaining: number | null;
  cycleStart: string;
  cycleEnd: string;
  isUnlimited: boolean;
};

type QuotaRow = {
  remaining: number | null;
  cycle_start: string;
};

function addMonthsUtc(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = date.getUTCSeconds();
  const milliseconds = date.getUTCMilliseconds();
  const targetMonth = month + months;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDay);
  return new Date(Date.UTC(targetYear, normalizedMonth, clampedDay, hours, minutes, seconds, milliseconds));
}

function getCycleWindow(anchorIso: string, now = new Date()): { start: Date; end: Date } {
  let start = new Date(anchorIso);
  if (Number.isNaN(start.getTime())) {
    start = now;
  }
  let end = addMonthsUtc(start, 1);
  while (now.getTime() >= end.getTime()) {
    start = end;
    end = addMonthsUtc(start, 1);
  }
  return { start, end };
}

async function ensureQuotaRow(env: Env, userId: string, plan: PlanTier): Promise<QuotaRow> {
  const row = await env.DB.prepare("SELECT remaining, cycle_start FROM user_quotas WHERE user_id = ?")
    .bind(userId)
    .first();
  if (row) {
    return {
      remaining: row.remaining as number | null,
      cycle_start: row.cycle_start as string
    };
  }

  const user = await env.DB.prepare("SELECT created_at FROM users WHERE id = ?").bind(userId).first();
  const createdAt = typeof user?.created_at === "string" ? user.created_at : null;
  const anchor = plan === "free" && createdAt ? createdAt : nowIso();
  const limit = getPlanMonthlyLimit(plan);
  const remaining = plan === "max" ? null : limit ?? 0;
  await env.DB.prepare(
    "INSERT INTO user_quotas (user_id, cycle_start, remaining, updated_at) VALUES (?, ?, ?, ?)"
  )
    .bind(userId, anchor, remaining, nowIso())
    .run();

  return { remaining, cycle_start: anchor };
}

async function syncQuotaCycle(
  env: Env,
  userId: string,
  plan: PlanTier,
  row: QuotaRow
): Promise<QuotaSnapshot> {
  const now = new Date();
  const { start, end } = getCycleWindow(row.cycle_start, now);
  const cycleStartIso = start.toISOString();
  const cycleEndIso = end.toISOString();
  const limit = getPlanMonthlyLimit(plan);
  let remaining = row.remaining;
  let updated = false;

  if (plan === "max") {
    if (remaining !== null) {
      remaining = null;
      updated = true;
    }
  } else if (remaining === null || Number.isNaN(Number(remaining))) {
    remaining = limit ?? 0;
    updated = true;
  }

  if (cycleStartIso !== row.cycle_start) {
    updated = true;
    if (plan !== "max") {
      remaining = limit ?? 0;
    }
  }

  if (updated) {
    await env.DB.prepare(
      "UPDATE user_quotas SET cycle_start = ?, remaining = ?, updated_at = ? WHERE user_id = ?"
    )
      .bind(cycleStartIso, remaining, nowIso(), userId)
      .run();
  }

  return {
    remaining,
    cycleStart: cycleStartIso,
    cycleEnd: cycleEndIso,
    isUnlimited: plan === "max"
  };
}

export async function getUserQuotaSnapshot(env: Env, userId: string, plan: PlanTier): Promise<QuotaSnapshot> {
  const row = await ensureQuotaRow(env, userId, plan);
  return await syncQuotaCycle(env, userId, plan, row);
}

export async function consumeUserQuota(
  env: Env,
  userId: string,
  plan: PlanTier
): Promise<{ ok: boolean; snapshot: QuotaSnapshot }> {
  const snapshot = await getUserQuotaSnapshot(env, userId, plan);
  if (snapshot.isUnlimited) {
    return { ok: true, snapshot };
  }
  if ((snapshot.remaining ?? 0) <= 0) {
    return { ok: false, snapshot };
  }
  const nextRemaining = (snapshot.remaining ?? 0) - 1;
  await env.DB.prepare("UPDATE user_quotas SET remaining = ?, updated_at = ? WHERE user_id = ?")
    .bind(nextRemaining, nowIso(), userId)
    .run();
  return { ok: true, snapshot: { ...snapshot, remaining: nextRemaining } };
}

export async function resetUserQuotaForPlan(
  env: Env,
  userId: string,
  plan: PlanTier,
  anchorIso?: string
): Promise<QuotaSnapshot> {
  const now = new Date();
  const anchor = anchorIso ?? nowIso();
  const { start, end } = getCycleWindow(anchor, now);
  const remaining = plan === "max" ? null : getPlanMonthlyLimit(plan) ?? 0;
  const cycleStartIso = start.toISOString();
  const cycleEndIso = end.toISOString();
  await env.DB.prepare(
    "INSERT INTO user_quotas (user_id, cycle_start, remaining, updated_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET cycle_start = excluded.cycle_start, remaining = excluded.remaining, updated_at = excluded.updated_at"
  )
    .bind(userId, cycleStartIso, remaining, nowIso())
    .run();
  return {
    remaining,
    cycleStart: cycleStartIso,
    cycleEnd: cycleEndIso,
    isUnlimited: plan === "max"
  };
}

export async function setUserQuotaRemaining(
  env: Env,
  userId: string,
  plan: PlanTier,
  remaining: number
): Promise<{ ok: boolean; snapshot: QuotaSnapshot }> {
  const snapshot = await getUserQuotaSnapshot(env, userId, plan);
  if (snapshot.isUnlimited) {
    return { ok: false, snapshot };
  }
  const normalized = Math.max(0, Math.floor(remaining));
  await env.DB.prepare("UPDATE user_quotas SET remaining = ?, updated_at = ? WHERE user_id = ?")
    .bind(normalized, nowIso(), userId)
    .run();
  return { ok: true, snapshot: { ...snapshot, remaining: normalized } };
}
