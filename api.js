import * as db from "./db.js";
import { validateResult } from "./schema.js";
let base = "",
  token = "",
  expires = 0;
const inflight = new Map();
export function setBase(url) {
  const u = new URL(url);
  if (u.username || u.password || u.search || u.hash || u.pathname !== "/")
    throw new Error("Нужен адрес backend без пути, пароля и параметров");
  if (
    u.protocol !== "https:" &&
    !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))
  )
    throw new Error("Backend должен использовать HTTPS");
  if (base !== u.origin) {
    token = "";
    expires = 0;
  }
  base = u.origin;
  return base;
}
export function logout() {
  token = "";
  expires = 0;
}
export function session() {
  return !!token && expires > Date.now();
}
export async function request(path, body) {
  if (!base) throw new Error("Укажите адрес backend в настройках");
  if (path !== "/login" && !session())
    throw new Error("Войдите в настройках. Сессия действует один час");
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
      signal: AbortSignal.timeout(55000),
    });
  } catch {
    throw new Error(
      "Backend не отвечает. Проверьте адрес, соединение и CORS в настройках Worker",
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
    if (res.status === 401) logout();
    throw new Error(data.error || `Ошибка подключения (${res.status})`);
  }
  return data;
}
export async function login(password) {
  const d = await request("/login", { password });
  token = d.token;
  expires = d.expires;
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
