import * as db from "./db.js";
import * as api from "./api.js";
import { LIMITS, validateResult } from "./schema.js";
const jobs = new Map();
const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
const words = text => text.match(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g) || [];
const emit = job => job.listeners.forEach(fn => fn(job));
export function preparationJob(doc) {
  if (jobs.has(doc.id)) return jobs.get(doc.id);
  const job = { doc, status: "loading", done: 0, total: words(doc.body).length, error: "", listeners: new Set(), stop: false };
  job.subscribe = listener => { job.listeners.add(listener); listener(job); return () => job.listeners.delete(listener); };
  job.pause = () => { job.stop = true; };
  job.start = () => {
    if (job.promise) return job.promise;
    job.stop = false;
    job.promise = work(job).finally(() => { job.promise = null; });
    return job.promise;
  };
  jobs.set(doc.id, job);
  return job;
}
async function save(job) {
  await db.put("meta", { id: "preparation:" + job.doc.id, status: job.status });
}
async function plan(job) {
  const cache = new Map((await db.all("cache")).filter(x => x.docId === job.doc.id).map(x => [x.id, x]));
  const sentences = new Map();
  for (const block of job.doc.body.split(/\n\s*\n/)) {
    for (const part of segmenter.segment(block)) {
      const sentence = part.segment.trim();
      if (!words(sentence).length) continue;
      const entry = sentences.get(sentence) || { sentence, weights: new Map() };
      for (const term of words(sentence)) entry.weights.set(term, (entry.weights.get(term) || 0) + 1);
      sentences.set(sentence, entry);
    }
  }
  let done = 0;
  const tasks = [];
  const valid = (id, input) => {
    const item = cache.get(id);
    if (!item) return false;
    try { validateResult(item.result, input); return true; } catch { return false; }
  };
  for (const { sentence, weights } of sentences.values()) {
    const missing = [];
    for (const [term, weight] of weights) {
      const input = { kind: "word", term, sentence }, id = await api.cacheKey(input, job.doc.id);
      if (valid(id, input)) done += weight;
      else missing.push({ term, weight });
    }
    if (missing.length) {
      for (let i = 0; i < missing.length; i += LIMITS.prepareTerms) {
        const slice = missing.slice(i, i + LIMITS.prepareTerms);
        tasks.push({ sentence, terms: slice.map(x => x.term), weight: slice.reduce((n, x) => n + x.weight, 0) });
      }
    } else {
      const input = { kind: "sentence", term: sentence.slice(0, LIMITS.phrase), sentence };
      if (!valid(await api.cacheKey(input, job.doc.id), input)) tasks.push({ sentence, terms: [], weight: 0 });
    }
  }
  job.done = done;
  return tasks;
}
export async function openPreparation(doc, force = false) {
  const job = preparationJob(doc);
  if (job.promise || job.status !== "loading") return job;
  job.promise = (async () => {
    const previous = await db.get("meta", "preparation:" + doc.id);
    const tasks = await plan(job);
    if (!tasks.length) { job.status = "done"; emit(job); return; }
    if (!force && ["error", "paused", "running"].includes(previous?.status)) {
      job.status = previous.status === "running" ? "paused" : previous.status;
      job.error = previous.status === "error" ? "Не удалось завершить перевод." : "Перевод приостановлен.";
      emit(job); return;
    }
    await work(job, tasks);
  })().catch(e => { job.status = "error"; job.error = e.message; emit(job); })
    .finally(() => { job.promise = null; });
  return job;
}
async function work(job, tasks) {
  job.error = "";
  job.status = "running";
  emit(job);
  try {
    tasks ||= await plan(job);
    if (tasks.length && !navigator.onLine) {
      job.status = "paused";
      job.error = "Нет соединения. Уже готовые слова доступны.";
      emit(job);
      await save(job);
      return;
    }
    emit(job);
    let cursor = 0, failure;
    const worker = async () => {
      while (!job.stop && cursor < tasks.length) {
        const task = tasks[cursor++];
        try {
          if (!(await db.get("docs", job.doc.id))) { job.stop = true; return; }
          await api.prepareWords(task.sentence, task.terms, job.doc.id);
          job.done += task.weight;
          emit(job);
        } catch (e) { failure ||= e; job.stop = true; }
      }
    };
    await save(job);
    await Promise.all([worker(), worker()]);
    if (failure) throw failure;
    job.status = cursor === tasks.length && !job.stop ? "done" : "paused";
  } catch (e) {
    job.status = e.code === "SIGN_IN_CANCELLED" ? "paused" : "error";
    job.error = e.message;
  }
  emit(job);
  try { await save(job); } catch { job.error = "Не удалось сохранить состояние перевода."; emit(job); }
}
