interface AdminSessionRefreshInput {
  hasActivity: boolean;
  refreshInFlight: boolean;
  refreshForActiveUse: boolean;
  remainingMs: number;
  now: number;
  lastServerRefreshAt: number;
  refreshLeadMs: number;
  refreshThrottleMs: number;
}

export function shouldRefreshAdminSession({
  hasActivity,
  refreshInFlight,
  refreshForActiveUse,
  remainingMs,
  now,
  lastServerRefreshAt,
  refreshLeadMs,
  refreshThrottleMs
}: AdminSessionRefreshInput): boolean {
  if (!hasActivity || refreshInFlight) return false;
  if (now - lastServerRefreshAt < refreshThrottleMs) return false;
  return refreshForActiveUse || remainingMs <= refreshLeadMs;
}
