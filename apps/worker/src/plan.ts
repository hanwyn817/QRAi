import type { PlanTier } from "./types";

export const PLAN_TIERS: PlanTier[] = ["free", "pro", "max"];

const PLAN_LIMITS: Record<PlanTier, number | null> = {
  free: 3,
  pro: 20,
  max: null
};

export function normalizePlanTier(value: unknown): PlanTier | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return PLAN_TIERS.includes(trimmed as PlanTier) ? (trimmed as PlanTier) : null;
}

export function getPlanMonthlyLimit(plan: PlanTier): number | null {
  return PLAN_LIMITS[plan];
}
