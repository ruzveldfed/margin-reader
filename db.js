import { BACKUP_STORES, validateBackup, norm } from "./schema.js";
export const STORES = [...Object.keys(BACKUP_STORES), "meta"];
const connection = new Promise((resolve, reject) => {
  const req = indexedDB.open("margin-reader", 1);
  req.onupgradeneeded = () => {
    for (const name of STORES)
      req.result.createObjectStore(name, { keyPath: "id" });
  };
  req.onsuccess = () => {
    req.result.onversionchange = () => req.result.close();
    resolve(req.result);
  };
  req.onerror = () => reject(req.error);
  req.onblocked = () =>
    reject(new Error("Закройте другие вкладки margin и обновите страницу"));
});
export async function tx(names, mode, action) {
  const db = await connection;
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, mode);
    let value;
    try {
      value = action(t);
    } catch (e) {
      t.abort();
      reject(e);
      return;
    }
    t.oncomplete = () => resolve(typeof value === "function" ? value() : value);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("Сохранение отменено"));
  });
}
export async function all(name) {
  let req;
  return tx([name], "readonly", (t) => {
    req = t.objectStore(name).getAll();
    return () => req.result;
  });
}
export async function get(name, id) {
  let req;
  return tx([name], "readonly", (t) => {
    req = t.objectStore(name).get(id);
    return () => req.result;
  });
}
export const put = (name, value) =>
  tx([name], "readwrite", (t) => {
    t.objectStore(name).put(value);
  });
export const remove = (name, id) =>
  tx([name], "readwrite", (t) => {
    t.objectStore(name).delete(id);
  });
export async function saveWordUnique(word) {
  let saved;
  return tx(["words"], "readwrite", (t) => {
    const s = t.objectStore("words"),
      req = s.getAll();
    req.onsuccess = () => {
      saved = req.result.find(
        (w) =>
          norm(w.term) === norm(word.term) &&
          norm(w.context) === norm(word.context),
      );
      if (!saved) {
        saved = word;
        s.put(word);
      }
    };
    return () => saved;
  });
}
export async function deleteDoc(id) {
  return tx(["docs", "cache", "practices", "attempts"], "readwrite", (t) => {
    t.objectStore("docs").delete(id);
    for (const name of ["cache", "practices", "attempts"]) {
      const req = t.objectStore(name).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (c) {
          if (c.value.docId === id) c.delete();
          c.continue();
        }
      };
    }
  });
}
export async function exportData() {
  const out = {
    format: "margin-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
  };
  let reqs = {};
  await tx(Object.keys(BACKUP_STORES), "readonly", (t) => {
    for (const n of Object.keys(BACKUP_STORES))
      reqs[n] = t.objectStore(n).getAll();
  });
  for (const n of Object.keys(BACKUP_STORES)) out[n] = reqs[n].result;
  return validateBackup(out);
}
export async function restoreData(input) {
  const b = validateBackup(input);
  return tx(Object.keys(BACKUP_STORES), "readwrite", (t) => {
    for (const n of Object.keys(BACKUP_STORES)) {
      const s = t.objectStore(n);
      s.clear();
      for (const item of b[n]) s.put(item);
    }
  });
}
