import * as db from "./db.js";
import { validateResult, LIMITS } from "./schema.js";
let base = "",
  token = "",
  expires = 0,
  snapshot = null;
const inflight = new Map();
const MAX_SESSION = 7 * 86400000;
export function savedStatus() {
  return snapshot;
}
export function sessionExpires() {
  return expires;
}
async function saveSnapshot(data) {
  const next = { ...(snapshot || {}) };
  for (const key of [
    "model",
    "day",
    "daily",
    "requests",
    "estimated",
    "reserved",
    "budget",
    "inputTokens",
    "outputTokens",
  ]) {
    if (data[key] !== undefined) next[key] = data[key];
  }
  next.updated = Date.now();
  if (data.day !== undefined && data.requests !== undefined)
    next.usageUpdated = Date.now();
  snapshot = next;
  await db.put("meta", { id: "serviceStatus", base, data: next });
}
export async function restoreSession() {
  const [auth, status] = await Promise.all([
    db.get("meta", "authSession"),
    db.get("meta", "serviceStatus"),
  ]);
  if (status?.base === base) snapshot = status.data;
  if (
    auth?.base === base &&
    typeof auth.token === "string" &&
    auth.token.length < 1000 &&
    auth.expires > Date.now() &&
    auth.expires <= Date.now() + MAX_SESSION
  ) {
    token = auth.token;
    expires = auth.expires;
  } else if (auth) await db.remove("meta", "authSession");
}
export function setBase(url) {
  const u = new URL(url);
  if (u.username || u.password || u.search || u.hash || u.pathname !== "/")
    throw new Error("Нужен адрес backend без пути, пароля и параметров");
  if (
    u.protocol !== "https:" &&
    !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))
  )
    throw new Error("Backend должен использовать HTTPS");
  if (base && base !== u.origin) {
    token = "";
    expires = 0;
    snapshot = null;
    db.remove("meta", "authSession").catch(() => {});
    db.remove("meta", "serviceStatus").catch(() => {});
  }
  base = u.origin;
  return base;
}
export async function logout() {
  token = "";
  expires = 0;
  await db.remove("meta", "authSession");
}
export function session() {
  return !!token && expires > Date.now();
}
export async function request(path, body) {
  if (!base)
    throw new Error("Укажите адрес сервиса в дополнительных настройках");
  if (path !== "/login" && !session())
    throw new Error("Войдите в настройках, чтобы получать новые переводы");
  const timeout =
    path === "/generate"
      ? 55000
      : path === "/models"
        ? 35000
        : path === "/model"
          ? 25000
          : 10000;
  let res;
  try {
    res = await fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify(body || {}),
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    throw new Error(
      e.name === "TimeoutError" || e.name === "AbortError"
        ? "Сервис не ответил за " +
            Math.round(timeout / 1000) +
            " секунд. Адрес сохранён. Можно продолжать читать и повторить позже."
        : "Не удалось связаться с сервисом переводов. Адрес сохранён. Проверьте доступность сервиса в дополнительных настройках.",
    );
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(
      "Backend вернул неподходящий ответ. Возможна блокировка сервиса",
    );
  }
  if (!res.ok) {
    if (res.status === 401) await logout();
    throw new Error(data.error || `Ошибка подключения (${res.status})`);
  }
  if (["/status", "/model", "/limits", "/login"].includes(path))
    await saveSnapshot(data);
  return data;
}
export async function login(password, remember = true) {
  const d = await request("/login", { password, remember });
  if (
    typeof d.token !== "string" ||
    d.token.length > 1000 ||
    !Number.isFinite(d.expires) ||
    d.expires <= Date.now() ||
    d.expires > Date.now() + MAX_SESSION
  )
    throw new Error("Сервис вернул некорректную сессию");
  token = d.token;
  expires = d.expires;
  if (remember)
    await db.put("meta", { id: "authSession", base, token, expires });
  else await db.remove("meta", "authSession");
  return d;
}
export async function cacheKey(input, docId) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify({ v: 1, docId, ...input })),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function generate(input, docId) {
  const id = await cacheKey(input, docId),
    store = input.kind === "practice" ? "practices" : "cache";
  const existing = await db.get(store, id);
  if (existing)
    return { result: validateResult(existing.result, input), cached: true, id };
  if (inflight.has(id)) return inflight.get(id);
  const p = (async () => {
    const data = await request("/generate", {
      ...input,
      requestId: crypto.randomUUID(),
    });
    const result = validateResult(data.result, input);
    await db.put(store, {
      id,
      docId,
      ...(store === "practices" ? { text: input.text } : { input }),
      result,
      created: Date.now(),
    });
    return { result, cached: false, id };
  })();
  inflight.set(id, p);
  try {
    return await p;
  } finally {
    inflight.delete(id);
  }
}

// Explicit preparation writes ordinary word-cache records, so reading stays offline.
export async function prepareWords(sentence, terms, docId) {
  const sentenceInput = { kind: "sentence", term: sentence.slice(0, LIMITS.phrase), sentence };
  const sentenceId = await cacheKey(sentenceInput, docId);
  const pending = [];
  for (const term of terms) {
    const input = { kind: "word", term, sentence };
    const id = await cacheKey(input, docId);
    const existing = await db.get("cache", id);
    if (existing) { validateResult(existing.result, input); continue; }
    if (inflight.has(id)) { await inflight.get(id); continue; }
    pending.push({ id, input });
  }
  if (!pending.length) { await generate(sentenceInput, docId); return; }
  const input = { kind: "prepare", sentence, terms: pending.map(x => x.input.term) };
  const batch = (async () => {
    const data = await request("/generate", { ...input, requestId: crypto.randomUUID() });
    const result = validateResult(data.result, input);
    // A bad/incomplete response leaves the existing cache intact.
    await db.tx(["docs", "cache"], "readwrite", t => {
      const doc = t.objectStore("docs").get(docId);
      doc.onsuccess = () => {
        if (!doc.result) return;
        pending.forEach((item, index) => t.objectStore("cache").put({
          id: item.id, docId, input: item.input,
          result: validateResult(result.entries[index], item.input), created: Date.now(),
        }));
        t.objectStore("cache").put({
          id: sentenceId, docId, input: sentenceInput,
          result: { translation: result.sentenceTranslation }, created: Date.now(),
        });
      };
    });
    return result;
  })();
  pending.forEach((item, index) => {
    const value = batch.then(result => ({
      result: validateResult(result.entries[index], item.input), cached: true, id: item.id,
    }));
    value.catch(() => {});
    inflight.set(item.id, value);
  });
  try { await batch; }
  finally { pending.forEach(item => inflight.delete(item.id)); }
}
