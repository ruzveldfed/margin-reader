export const MAX_SESSION = 30 * 86400000;
// The server issues absolute timestamps using its own clock. Validate the
// duration on that same clock, then use a local deadline for the browser.
export function sessionDeadline(data, elapsedMs = 0, now = Date.now()) {
  if (!data || typeof data.token !== "string" || data.token.length > 1000 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(data.token) ||
      !Number.isSafeInteger(data.expires) ||
      (data.issuedAt !== undefined && !Number.isSafeInteger(data.issuedAt)) ||
      !Number.isFinite(elapsedMs) || !Number.isFinite(now)) throw new Error("Не удалось подтвердить вход. Обновите страницу и попробуйте снова.");
  let lifetime;
  if (Number.isSafeInteger(data.issuedAt)) lifetime = data.expires - data.issuedAt;
  else {
    // Compatibility with an earlier server during deployment. Only a small
    // clock tolerance is allowed; the server still verifies token expiry.
    lifetime = data.expires - now;
    if (lifetime > MAX_SESSION + 5 * 60000) lifetime = -1;
    lifetime = Math.min(MAX_SESSION, lifetime);
  }
  const remaining = lifetime - Math.max(0, elapsedMs);
  if (lifetime <= 0 || lifetime > MAX_SESSION || remaining <= 0)
    throw new Error("Не удалось подтвердить срок входа. Попробуйте войти снова.");
  return now + remaining;
}
