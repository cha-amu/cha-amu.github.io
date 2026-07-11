export function resolveControlSnapshot<T>(
  result: PromiseSettledResult<T>,
  cachedSnapshot: T | null
): T {
  if (result.status === 'fulfilled') return result.value;
  if (cachedSnapshot !== null) return cachedSnapshot;
  throw result.reason;
}
