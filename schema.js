// Shared by browser and Worker. Return fresh objects with an explicit allowlist.
export const LIMITS = Object.freeze({
  text: 100000,
  sentence: 2400,
  phrase: 500,
  practice: 12000,
  backup: 15000000,
});
export class FormatError extends Error {
  constructor(message = "Неверный формат данных") {
    super(message);
    this.name = "FormatError";
  }
}
export const norm = (s) =>
  s.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
export function str(x, max = 1000, min = 1) {
  if (
    typeof x !== "string" ||
    x.length < min ||
    x.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x)
  )
    throw new FormatError();
  return x;
}
export function num(x, min, max) {
  if (!Number.isFinite(x) || x < min || x > max) throw new FormatError();
  return x;
}
export function integer(x, min, max) {
  num(x, min, max);
  if (!Number.isInteger(x)) throw new FormatError();
  return x;
}
function array(x, max, min = 0) {
  if (!Array.isArray(x) || x.length > max || x.length < min)
    throw new FormatError();
  return x;
}
export function inSource(quote, source) {
  return norm(source).includes(norm(quote));
}
export function ipa(x) {
  if (x === null) return null;
  str(x, 180);
  if (
    !/^\/[a-zA-Z\u00c0-\u024f\u0250-\u02ff\u0300-\u036f\u0370-\u03ffˈˌːˑ‿. ()\-]+\/$/u.test(
      x,
    )
  )
    throw new FormatError("Сервис вернул неподходящий формат IPA");
  return x;
}
export function validateInput(x) {
  if (!x || typeof x !== "object") throw new FormatError();
  if (x.kind === "practice")
    return { kind: x.kind, text: str(x.text, LIMITS.practice, 30) };
  if (x.kind === "check") return { kind: "check" };
  if (!["word", "phrase", "sentence"].includes(x.kind)) throw new FormatError();
  const sentence = str(x.sentence, LIMITS.sentence),
    term = str(x.term, x.kind === "word" ? 80 : LIMITS.phrase);
  if (!inSource(term, sentence))
    throw new FormatError("Выделение не найдено в контексте");
  if (x.kind === "word" && !/^[A-Za-z]+(?:['’\-][A-Za-z]+)*$/.test(term))
    throw new FormatError();
  return { kind: x.kind, term, sentence };
}
export const CHECK_INPUT = {
  kind: "word",
  term: "stores",
  sentence:
    "The processor stores a small amount of data in its cache to reduce waiting time.",
};
export function validateResult(x, input) {
  if (!x || typeof x !== "object")
    throw new FormatError("Пустой ответ сервиса");
  if (input.kind === "check")
    return {
      word: validateResult(x.word, CHECK_INPUT),
      sentenceTranslation: str(x.sentenceTranslation, 1500),
      question: validateQuestion(x.question, CHECK_INPUT.sentence),
    };
  if (input.kind === "practice") {
    return {
      comprehension: array(x.comprehension, 10, 1).map((q) =>
        validateQuestion(q, input.text),
      ),
      vocabulary: array(x.vocabulary, 4, 1).map((q) =>
        validateQuestion(q, input.text),
      ),
      open: array(x.open, 4, 1).map((q) => {
        const evidence = str(q.evidence, 1200);
        if (!inSource(evidence, input.text))
          throw new FormatError("Задание содержит цитату вне текста");
        return {
          question: str(q.question, 500),
          sample: str(q.sample, 1000),
          evidence,
        };
      }),
    };
  }
  const translation = str(x.translation, 2000);
  if (input.kind !== "word") return { translation };
  const phrases = array(x.phrases, 3).map((p) => {
    const term = str(p.term, 180);
    if (
      !inSource(term, input.sentence) ||
      !inSource(input.term, term) ||
      norm(term) === norm(input.term)
    )
      throw new FormatError("Сочетание не найдено в предложении");
    return { term, translation: str(p.translation, 700) };
  });
  return { translation, ipa: ipa(x.ipa), phrases };
}
export function validateQuestion(q, source) {
  const options = array(q?.options, 4, 4).map((v) => str(v, 350)),
    evidence = str(q.evidence, 1200);
  if (new Set(options.map(norm)).size !== 4 || !inSource(evidence, source))
    throw new FormatError("Некорректное задание");
  return {
    question: str(q.question, 500),
    options,
    answer: integer(q.answer, 0, 3),
    explanation: str(q.explanation, 1400),
    evidence,
  };
}
export function cleanDoc(d) {
  return {
    id: str(d.id, 100),
    title: str(d.title, 160),
    body: str(d.body, LIMITS.text),
    created: num(d.created, 0, 1e15),
    updated: num(d.updated, 0, 1e15),
    progress: num(d.progress, 0, 1),
    anchor: integer(d.anchor ?? 0, 0, LIMITS.text),
  };
}
export function cleanWord(w) {
  return {
    id: str(w.id, 100),
    docId: str(w.docId, 100),
    term: str(w.term, 500),
    translation: str(w.translation, 2000),
    ipa: ipa(w.ipa),
    context: str(w.context, 2400),
    sourceTitle: str(w.sourceTitle, 160),
    created: num(w.created, 0, 1e15),
  };
}
export function cleanCache(c) {
  const input = validateInput(c.input);
  return {
    id: str(c.id, 100),
    docId: str(c.docId, 100),
    input,
    result: validateResult(c.result, input),
    created: num(c.created, 0, 1e15),
  };
}
export function cleanPractice(p) {
  const text = str(p.text, LIMITS.practice, 30);
  return {
    id: str(p.id, 100),
    docId: str(p.docId, 100),
    text,
    result: validateResult(p.result, { kind: "practice", text }),
    created: num(p.created, 0, 1e15),
  };
}
export function cleanAttempt(a) {
  const answers = {};
  if (
    !a.answers ||
    typeof a.answers !== "object" ||
    Object.keys(a.answers).length > 30
  )
    throw new FormatError();
  for (const [k, v] of Object.entries(a.answers)) {
    if (!/^[cvo]\d{1,2}$/.test(k)) throw new FormatError();
    answers[k] = k[0] === "o" ? str(v, 2000, 0) : integer(v, 0, 3);
  }
  return {
    id: str(a.id, 100),
    docId: str(a.docId, 100),
    answers,
    updated: num(a.updated, 0, 1e15),
  };
}
export const BACKUP_STORES = {
  docs: cleanDoc,
  words: cleanWord,
  cache: cleanCache,
  practices: cleanPractice,
  attempts: cleanAttempt,
};
export function validateBackup(b) {
  if (b?.format !== "margin-backup" || b.version !== 1)
    throw new FormatError("Это не резервная копия margin версии 1");
  const out = {
    format: "margin-backup",
    version: 1,
    exportedAt: str(b.exportedAt, 40),
  };
  for (const [name, clean] of Object.entries(BACKUP_STORES)) {
    out[name] = array(b[name], name === "docs" ? 500 : 20000).map(clean);
    if (new Set(out[name].map((x) => x.id)).size !== out[name].length)
      throw new FormatError("Повторяющиеся идентификаторы в копии");
  }
  const ids = new Set(out.docs.map((d) => d.id));
  for (const n of ["cache", "practices", "attempts"])
    if (out[n].some((x) => !ids.has(x.docId)))
      throw new FormatError("Нарушены связи данных");
  for (const a of out.attempts)
    if (!out.practices.some((p) => p.id === a.id && p.docId === a.docId))
      throw new FormatError("Не найдена практика для результата");
  return out;
}
