import * as db from "./db.js";
import * as api from "./api.js";
import { DEMO } from "./demo.js";
import { LIMITS, norm, validateBackup } from "./schema.js";
const $ = (s) => document.querySelector(s),
  main = $("#main"),
  modal = $("#translation"),
  content = $("#translation-content");
const node = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== null && text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
const add = (parent, ...children) => {
  parent.append(...children.filter(Boolean));
  return parent;
};
const button = (text, fn, cls = "") => {
  const b = node("button", text, cls);
  b.type = "button";
  b.addEventListener("click", () => run(() => fn(b)));
  return b;
};
const link = (text, href, cls = "") => {
  const a = node("a", text, cls);
  a.href = href;
  return a;
};
const para = (text, cls = "") => node("p", text, cls);
let settings = { fontSize: 21, backend: "" },
  current = null,
  view = "",
  renderId = 0,
  translationId = 0,
  selection = null,
  toastTimer,
  scrollTimer,
  tapTimer,
  wordList = [];
function toast(text) {
  clearTimeout(toastTimer);
  $("#toast").textContent = text;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 4200);
}
async function run(fn) {
  try {
    await fn();
  } catch (e) {
    toast(e.message || "Не удалось выполнить действие");
  }
}
function errorView(target, e) {
  target.replaceChildren(
    para(e.message || "Не удалось выполнить действие", "error"),
  );
}
async function saveSettings() {
  await db.put("meta", { id: "settings", ...settings });
}
function activeNav(name) {
  for (const a of document.querySelectorAll("nav a")) {
    if (a.hash === "#" + name) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}
function pageTop(title, action) {
  return add(node("div", null, "page-top"), node("h1", title), action);
}
function date(ts) {
  return new Date(ts).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
}
function words(body) {
  return body.match(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g) || [];
}
function resetSelection() {
  selection = null;
  $("#selection-action").hidden = true;
}
function closeTranslation() {
  translationId++;
  modal.close();
}
$("#close-translation").onclick = closeTranslation;
modal.addEventListener("close", () => {
  translationId++;
  document.body.classList.remove("sheet-open");
  document
    .querySelectorAll(".word.active")
    .forEach((w) => w.classList.remove("active"));
});
modal.addEventListener("click", (e) => {
  if (e.target === modal) {
    const r = modal.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      closeTranslation();
  }
});
$("#close-editor").onclick = () => $("#editor").close();
function showEditor() {
  $("#text-form").reset();
  $("#editor-note").textContent = "До 100 000 знаков · TXT в UTF-8";
  $("#editor").showModal();
  $("#text-title").focus();
}
$("#txt-file").addEventListener("change", () =>
  run(async () => {
    const f = $("#txt-file").files[0];
    if (!f) return;
    if (f.size > 400000)
      throw new Error("TXT слишком большой: максимум 400 КБ");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      await f.arrayBuffer(),
    );
    if (!text.trim() || text.length > LIMITS.text)
      throw new Error("Нужен непустой текст до 100 000 знаков");
    $("#text-body").value = text.replace(/^\uFEFF/, "");
    if (!$("#text-title").value)
      $("#text-title").value = f.name.replace(/\.txt$/i, "").slice(0, 160);
    $("#editor-note").textContent = f.name;
  }),
);
$("#text-form").addEventListener("submit", (e) => {
  e.preventDefault();
  run(async () => {
    const title = $("#text-title").value.trim(),
      body = $("#text-body").value.trim();
    if (!title || !body || body.length > LIMITS.text)
      throw new Error("Проверьте название и длину текста");
    const now = Date.now(),
      d = {
        id: crypto.randomUUID(),
        title,
        body,
        created: now,
        updated: now,
        progress: 0,
        anchor: 0,
      };
    await db.put("docs", d);
    $("#editor").close();
    location.hash = "#read/" + d.id;
  });
});
async function library() {
  activeNav("texts");
  const docs = (await db.all("docs")).sort((a, b) => b.updated - a.updated);
  main.replaceChildren(
    pageTop("Тексты", button("+ Добавить текст", showEditor, "primary")),
  );
  add(
    main,
    add(
      node("div", null, "library-label"),
      node(
        "span",
        docs.length + " " + (docs.length === 1 ? "ТЕКСТ" : "ТЕКСТОВ"),
        "eyebrow",
      ),
      node("span", "НА ЭТОМ УСТРОЙСТВЕ", "eyebrow"),
    ),
  );
  if (!docs.length)
    add(main, para("Добавьте текст, который хотите прочитать.", "empty"));
  docs.forEach((d, i) => {
    const row = node("article", null, "text-row"),
      info = node("div", null, "text-info"),
      n = words(d.body).length;
    add(
      info,
      link(d.title, "#read/" + d.id, "text-link"),
      para(d.body.slice(0, 230), "text-excerpt"),
      add(
        node("div", null, "row-meta"),
        node("span", n + " слов · " + Math.max(1, Math.ceil(n / 130)) + " мин"),
        node(
          "span",
          d.progress > 0
            ? "Прочитано " + Math.round(d.progress * 100) + "%"
            : "Ещё не начат",
        ),
        node("span", date(d.created)),
      ),
    );
    const details = node("details", null, "more-actions"),
      summary = node("summary", "⋯");
    summary.setAttribute("aria-label", "Действия с текстом " + d.title);
    add(
      details,
      summary,
      add(
        node("div", null, "menu"),
        button("Переименовать", async () => {
          details.open = false;
          const title = prompt("Название текста", d.title);
          if (title === null) return;
          if (!title.trim() || title.length > 160)
            throw new Error("Название: от 1 до 160 знаков");
          await db.put("docs", {
            ...d,
            title: title.trim(),
            updated: Date.now(),
          });
          await library();
        }),
        button(
          "Удалить",
          async () => {
            details.open = false;
            if (
              confirm(
                "Удалить «" +
                  d.title +
                  "» и связанную практику? Слова останутся в словаре.",
              )
            ) {
              await db.deleteDoc(d.id);
              await library();
            }
          },
          "danger",
        ),
      ),
    );
    add(
      row,
      node("span", String(i + 1).padStart(2, "0"), "text-number"),
      info,
      add(
        node("div", null, "text-actions"),
        link(
          d.progress > 0 ? "Продолжить →" : "Читать →",
          "#read/" + d.id,
          "small",
        ),
        details,
      ),
    );
    main.append(row);
  });
  add(
    main,
    add(
      node("div", null, "library-footer"),
      link("Резервная копия", "#settings", "small"),
      node("span", "Сохранено в браузере", "small muted"),
    ),
  );
}
const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
function readingBody(d) {
  const article = node("div", null, "reading-text");
  article.id = "reading-text";
  article.lang = "en";
  let offset = 0,
    si = 0;
  for (const block of d.body.split(/(\n\s*\n)/)) {
    if (/^\n\s*\n$/.test(block)) {
      offset += block.length;
      continue;
    }
    if (!block) continue;
    const p = node("p");
    for (const part of segmenter.segment(block)) {
      const s = node("span", null, "sentence");
      s.dataset.si = String(si++);
      s.dataset.offset = String(offset + part.index);
      const pieces = part.segment.split(/([A-Za-z]+(?:['’\-][A-Za-z]+)*)/g);
      for (const piece of pieces) {
        if (/^[A-Za-z]+(?:['’\-][A-Za-z]+)*$/.test(piece)) {
          const w = node("span", piece, "word");
          w.tabIndex = 0;
          w.setAttribute("role", "button");
          w.setAttribute("aria-label", "Перевести " + piece);
          if (
            wordList.some(
              (x) =>
                norm(x.term) === norm(piece) &&
                x.context === part.segment.trim(),
            )
          )
            w.classList.add("saved");
          s.append(w);
        } else s.append(document.createTextNode(piece));
      }
      p.append(s);
    }
    article.append(p);
    offset += block.length;
  }
  article.addEventListener("contextmenu", () => {
    clearTimeout(tapTimer);
  });
  article.addEventListener("click", (e) => {
    const w = e.target.closest(".word");
    if (!w) return;
    clearTimeout(tapTimer);
    if (e.detail > 1) return;
    tapTimer = setTimeout(() => {
      if (!window.getSelection()?.isCollapsed) return;
      run(() => openWord(w));
    }, 260);
  });
  article.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches(".word")) {
      e.preventDefault();
      run(() => openWord(e.target));
    }
  });
  return article;
}
async function read(id, ticket) {
  activeNav("texts");
  const d = await db.get("docs", id);
  if (ticket !== renderId) return;
  if (!d) {
    main.replaceChildren(
      para("Текст не найден. Возможно, он был удалён.", "notice"),
      link("К текстам", "#texts"),
    );
    return;
  }
  current = d;
  wordList = await db.all("words");
  const root = node("article", null, "reader");
  const tools = add(
    node("div", null, "font-tools"),
    button("A−", async () => {
      settings.fontSize = Math.max(17, settings.fontSize - 1);
      applyFont();
      await saveSettings();
    }),
    button("A+", async () => {
      settings.fontSize = Math.min(29, settings.fontSize + 1);
      applyFont();
      await saveSettings();
    }),
  );
  tools.firstChild.setAttribute("aria-label", "Уменьшить шрифт");
  tools.lastChild.setAttribute("aria-label", "Увеличить шрифт");
  add(
    root,
    add(
      node("div", null, "reader-top"),
      link("← Все тексты", "#texts", "back"),
      tools,
    ),
    node("span", "ЧТЕНИЕ", "eyebrow"),
    node("h1", d.title),
    add(
      node("div", null, "reader-meta"),
      node("span", words(d.body).length + " слов"),
      node("span", "EN → RU"),
      node("span", "Место чтения сохраняется"),
    ),
    readingBody(d),
    add(
      node("div", null, "reading-end"),
      add(
        node("div"),
        node("h3", "Проверьте понимание"),
        para("Вопросы по тексту и практика слов.", "muted small"),
      ),
      button(
        "Открыть практику →",
        () => {
          location.hash = "#practice/" + id;
        },
        "primary",
      ),
    ),
  );
  if (ticket !== renderId) return;
  main.replaceChildren(root);
  requestAnimationFrame(() => {
    if (d.anchor > 0) {
      const sentences = [...document.querySelectorAll(".sentence")];
      const target = sentences
        .filter((s) => +s.dataset.offset <= d.anchor)
        .at(-1);
      if (target)
        window.scrollTo(
          0,
          target.getBoundingClientRect().top +
            scrollY -
            document.querySelector(".header").offsetHeight -
            20,
        );
    } else window.scrollTo(0, 0);
  });
}
function applyFont() {
  document.documentElement.style.setProperty(
    "--reading-size",
    settings.fontSize + "px",
  );
}
async function saveProgress() {
  if (!current || view !== "read") return;
  const sentences = [...document.querySelectorAll(".sentence")];
  if (!sentences.length) return;
  const top =
    document.querySelector(".header").getBoundingClientRect().bottom + 10;
  const first =
    sentences.find((s) => s.getBoundingClientRect().bottom > top) ||
    sentences.at(-1);
  const article = $("#reading-text"),
    rect = article.getBoundingClientRect();
  const progress = Math.min(
    1,
    Math.max(0, (innerHeight - rect.top) / rect.height),
  );
  const id = current.id,
    stored = await db.get("docs", id);
  if (!stored) return;
  current = {
    ...stored,
    anchor: Math.max(0, +first.dataset.offset),
    progress,
    updated: Date.now(),
  };
  await db.put("docs", current);
}
window.addEventListener(
  "scroll",
  () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => run(saveProgress), 350);
  },
  { passive: true },
);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) run(saveProgress);
});
async function openWord(w) {
  resetSelection();
  w.classList.add("active");
  const sentence = w.closest(".sentence").textContent.trim();
  await translate({ kind: "word", term: w.textContent, sentence }, current);
}
document.addEventListener("selectionchange", () => {
  if (modal.open || view !== "read") return;
  const s = window.getSelection(),
    article = $("#reading-text");
  if (
    !s ||
    s.isCollapsed ||
    !article ||
    !article.contains(s.anchorNode) ||
    !article.contains(s.focusNode)
  ) {
    resetSelection();
    return;
  }
  clearTimeout(tapTimer);
  const term = s.toString().trim();
  if (!term || term.length > LIMITS.phrase) {
    resetSelection();
    return;
  }
  const range = s.getRangeAt(0),
    start = (
      range.startContainer.nodeType === 1
        ? range.startContainer
        : range.startContainer.parentElement
    ).closest(".sentence"),
    end = (
      range.endContainer.nodeType === 1
        ? range.endContainer
        : range.endContainer.parentElement
    ).closest(".sentence");
  let sentence = term;
  if (start === end && start) sentence = start.textContent.trim();
  else if (start && end) {
    const all = [...article.querySelectorAll(".sentence")];
    sentence = all
      .slice(all.indexOf(start), all.indexOf(end) + 1)
      .map((x) => x.textContent)
      .join(" ")
      .trim();
  }
  if (sentence.length > LIMITS.sentence) sentence = term;
  selection = { kind: "phrase", term, sentence };
  $("#selection-action").hidden = false;
});
$("#selection-action").addEventListener("pointerdown", (e) =>
  e.preventDefault(),
);
$("#selection-action").onclick = () => {
  if (selection) {
    const data = { ...selection };
    resetSelection();
    window.getSelection()?.removeAllRanges();
    run(() => translate(data, current));
  }
};
function translationHeading(term) {
  const h = node("h2", term);
  h.id = "translation-title";
  return h;
}
async function translate(input, doc) {
  const ticket = ++translationId;
  document.body.classList.add("sheet-open");
  content.replaceChildren(
    translationHeading(input.term),
    para("Получаем перевод", "loading"),
  );
  if (!modal.open) modal.showModal();
  try {
    const data = await api.generate(input, doc.id);
    if (ticket !== translationId || !modal.open) return;
    const r = data.result;
    content.replaceChildren(translationHeading(input.term));
    if (input.kind === "word")
      add(content, para(r.ipa || "IPA не предоставлена сервисом", "ipa"));
    add(
      content,
      translationRow(
        input.term,
        r.translation,
        r.ipa || null,
        input.sentence,
        doc,
      ),
    );
    if (r.phrases?.length) {
      add(content, node("p", "СОЧЕТАНИЯ ИЗ ПРЕДЛОЖЕНИЯ", "eyebrow"));
      for (const p of r.phrases)
        add(
          content,
          translationRow(p.term, p.translation, null, input.sentence, doc),
        );
    }
    add(content, para(input.sentence, "translation-context"));
    if (input.kind !== "sentence") {
      const out = node("div");
      add(
        content,
        button(
          "Перевести предложение",
          async (b) => {
            b.disabled = true;
            try {
              const sentenceInput = {
                kind: "sentence",
                term: input.sentence.slice(0, LIMITS.phrase),
                sentence: input.sentence,
              };
              const translated = await api.generate(sentenceInput, doc.id);
              out.replaceChildren(
                para(translated.result.translation, "sentence-result"),
              );
              b.remove();
            } finally {
              b.disabled = false;
            }
          },
          "quiet",
        ),
        out,
      );
    }
    add(
      content,
      para(
        data.cached
          ? "Сохранённый перевод · без запроса к API"
          : "ODIRouter · британский IPA запрошен у модели",
        "translation-foot",
      ),
    );
  } catch (e) {
    if (ticket !== translationId) return;
    content.replaceChildren(
      translationHeading(input.term),
      para(e.message, "error"),
      link("Открыть настройки", "#settings", "small"),
    );
    content.querySelector("a").onclick = closeTranslation;
  }
}
function translationRow(term, translation, ipa, context, doc) {
  const same = wordList.find(
    (w) => norm(w.term) === norm(term) && norm(w.context) === norm(context),
  );
  return add(
    node("div", null, "translation-row"),
    add(node("div"), para(term, "en"), para(translation, "ru")),
    button(
      same ? "Сохранено" : "В словарь",
      async (b) => {
        b.disabled = true;
        try {
          const w = await db.saveWordUnique({
            id: crypto.randomUUID(),
            docId: doc.id,
            term,
            translation,
            ipa,
            context,
            sourceTitle: doc.title,
            created: Date.now(),
          });
          if (!wordList.some((x) => x.id === w.id)) wordList.push(w);
          b.textContent = "Сохранено";
        } catch (e) {
          b.disabled = false;
          throw e;
        }
        document
          .querySelectorAll(".word.active")
          .forEach((x) => x.classList.add("saved"));
      },
      "save-word",
    ),
  );
}
async function dictionary() {
  activeNav("words");
  wordList = (await db.all("words")).sort((a, b) => b.created - a.created);
  main.replaceChildren(
    pageTop(
      "Словарь",
      node("span", wordList.length + " записей", "muted small"),
    ),
  );
  const search = node("input");
  search.type = "search";
  search.placeholder = "Найти слово или перевод";
  search.setAttribute("aria-label", "Найти в словаре");
  const list = node("div");
  add(main, add(node("label", null, "search-label"), search), list);
  function paint() {
    list.replaceChildren();
    const filtered = wordList.filter((w) =>
      norm(w.term + " " + w.translation).includes(norm(search.value)),
    );
    if (!filtered.length)
      list.append(
        para(
          wordList.length
            ? "Ничего не найдено."
            : "Сохраняйте слова и сочетания во время чтения.",
          "empty",
        ),
      );
    for (const w of filtered) {
      const info = add(
        node("div"),
        node("h3", w.term),
        w.ipa ? para(w.ipa, "ipa") : null,
        para(w.translation, "translation"),
        para(w.context, "context"),
        para(w.sourceTitle, "muted small"),
      );
      const actions = add(
        node("div", null, "word-actions"),
        button("Изменить", async () => {
          const value = prompt("Перевод", w.translation);
          if (value === null) return;
          if (!value.trim() || value.length > 2000)
            throw new Error("Перевод: от 1 до 2000 знаков");
          w.translation = value.trim();
          await db.put("words", w);
          paint();
        }),
        button(
          "Удалить",
          async () => {
            if (!confirm("Удалить «" + w.term + "» из словаря?")) return;
            await db.remove("words", w.id);
            wordList = wordList.filter((x) => x.id !== w.id);
            paint();
          },
          "quiet danger",
        ),
      );
      list.append(add(node("article", null, "word-row"), info, actions));
    }
  }
  search.oninput = paint;
  paint();
}
async function practice(id, ticket) {
  activeNav("texts");
  const d = await db.get("docs", id);
  if (ticket !== renderId) return;
  if (!d) {
    main.replaceChildren(para("Текст не найден"));
    return;
  }
  const text = d.body.slice(0, LIMITS.practice),
    input = { kind: "practice", text },
    pid = await api.cacheKey(input, d.id),
    saved = await db.get("practices", pid);
  const root = node("div", null, "quiz");
  add(
    root,
    link("← Вернуться к чтению", "#read/" + id, "back"),
    node("h1", "Практика"),
    para(d.title, "muted"),
  );
  main.replaceChildren(root);
  if (!saved) {
    add(
      root,
      para(
        "5 вопросов на понимание, 3 задания на лексику и 2 коротких ответа. Уровень A2–B1.",
        "quiz-intro",
      ),
    );
    if (d.body.length > LIMITS.practice)
      add(
        root,
        para("Практика будет по первым 12 000 знаков этого текста.", "notice"),
      );
    if (text.trim().length < 30) {
      add(root, para("Для практики нужен текст от 30 знаков.", "notice"));
      return;
    }
    add(
      root,
      button(
        "Подготовить задания",
        async (b) => {
          b.disabled = true;
          b.textContent = "Готовим задания…";
          try {
            await api.generate(input, d.id);
            if (ticket === renderId) await practice(id, ticket);
          } finally {
            b.disabled = false;
            b.textContent = "Подготовить задания";
          }
        },
        "primary",
      ),
      para(
        "Один запрос. Готовые задания сохранятся для повторения.",
        "small muted",
      ),
    );
    return;
  }
  const attempt = (await db.get("attempts", pid)) || {
    id: pid,
    docId: id,
    answers: {},
    updated: Date.now(),
  };
  let writeQueue = Promise.resolve();
  const persist = () => {
    attempt.updated = Date.now();
    const snapshot = structuredClone(attempt);
    writeQueue = writeQueue.then(() => db.put("attempts", snapshot));
    writeQueue.catch((e) => toast("Не удалось сохранить ответ: " + e.message));
    return writeQueue;
  };
  let total = 0,
    correct = 0;
  const score = para("", "muted small");
  root.append(score);
  const refreshScore = () => {
    total = 0;
    correct = 0;
    for (const [group, key] of [
      [saved.result.comprehension, "c"],
      [saved.result.vocabulary, "v"],
    ])
      group.forEach((q, i) => {
        if (attempt.answers[key + i] !== undefined) {
          total++;
          if (attempt.answers[key + i] === q.answer) correct++;
        }
      });
    score.textContent = total
      ? `Ответов: ${total} · верных: ${correct}`
      : "Ответы появятся после вашего выбора";
  };
  for (const [group, key, label] of [
    [saved.result.comprehension, "c", "ПОНИМАНИЕ"],
    [saved.result.vocabulary, "v", "СЛОВА И СОЧЕТАНИЯ"],
  ]) {
    group.forEach((q, i) => {
      const section = node("section", null, "question"),
        qid = key + i;
      add(
        section,
        node("span", label + " / " + String(i + 1).padStart(2, "0"), "eyebrow"),
        node("h3", q.question),
      );
      const options = node("div", null, "options"),
        feedback = node("div");
      function paint() {
        options.replaceChildren();
        const chosen = attempt.answers[qid];
        q.options.forEach((option, j) => {
          const b = button(
            "",
            async () => {
              if (attempt.answers[qid] !== undefined) return;
              attempt.answers[qid] = j;
              paint();
              refreshScore();
              await persist();
            },
            "option" + (chosen === j ? " selected" : ""),
          );
          add(
            b,
            node("span", String.fromCharCode(65 + j)),
            node("div", option),
          );
          b.disabled = chosen !== undefined;
          options.append(b);
        });
        feedback.replaceChildren();
        if (chosen !== undefined)
          add(
            feedback,
            add(
              node("div", null, "answer"),
              node(
                "strong",
                chosen === q.answer
                  ? "Верно. "
                  : "Верный ответ: " + q.options[q.answer] + ". ",
              ),
              document.createTextNode(q.explanation),
              para("“" + q.evidence + "”", "muted small"),
            ),
          );
      }
      paint();
      add(section, options, feedback);
      root.append(section);
    });
  }
  saved.result.open.forEach((q, i) => {
    const section = node("section", null, "question"),
      area = node("textarea"),
      sample = node("div"),
      qid = "o" + i;
    area.rows = 3;
    area.maxLength = 2000;
    area.lang = "en";
    area.placeholder = "Your short answer…";
    area.setAttribute("aria-label", q.question);
    area.value = attempt.answers[qid] || "";
    area.oninput = () => {
      attempt.answers[qid] = area.value;
      persist();
    };
    add(
      section,
      node(
        "span",
        "КОРОТКИЙ ОТВЕТ / " + String(i + 1).padStart(2, "0"),
        "eyebrow",
      ),
      node("h3", q.question),
      area,
      button(
        "Показать образец",
        (b) => {
          sample.replaceChildren(
            para(q.sample, "answer"),
            para("“" + q.evidence + "”", "muted small"),
          );
          b.remove();
        },
        "quiet",
      ),
      sample,
    );
    root.append(section);
  });
  add(
    root,
    add(
      node("div", null, "quiz-result"),
      button("Пройти заново", async () => {
        if (!confirm("Сбросить ответы этого прохождения? Задания останутся."))
          return;
        await writeQueue;
        await db.remove("attempts", pid);
        await practice(id, ticket);
      }),
      para(
        "Повторение не обращается к API. Открытые ответы проверяйте по образцу.",
        "small muted",
      ),
    ),
  );
  refreshScore();
}
async function settingsPage() {
  activeNav("settings");
  const root = node("div", null, "settings");
  add(root, pageTop("Настройки"));
  const conn = node("section", null, "settings-section");
  add(
    conn,
    node("h2", "Подключение"),
    para(
      "Ключ ODIRouter хранится в серверном секрете. Здесь нужен только адрес вашего Worker.",
    ),
  );
  const url = node("input");
  url.type = "url";
  url.placeholder = "https://your-worker.workers.dev";
  url.value = settings.backend;
  const urlLabel = add(node("label", "Адрес backend"), url);
  add(
    conn,
    urlLabel,
    button("Сохранить адрес", async () => {
      settings.backend = api.setBase(url.value.trim());
      await saveSettings();
      url.value = settings.backend;
      toast("Адрес сохранён");
    }),
  );
  const password = node("input");
  password.type = "password";
  password.autocomplete = "current-password";
  password.placeholder = "Пароль доступа к вашему backend";
  const loginForm = add(
    node("form", null, "inline-form"),
    add(node("label", "Пароль доступа"), password),
  );
  const enter = node(
    "button",
    api.session() ? "Войти снова" : "Войти",
    "primary",
  );
  enter.type = "submit";
  loginForm.append(enter);
  loginForm.onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      enter.disabled = true;
      try {
        await api.login(password.value);
        password.value = "";
        await settingsPage();
        toast("Вход выполнен на один час");
      } finally {
        password.value = "";
        enter.disabled = false;
      }
    });
  };
  add(
    conn,
    loginForm,
    para(
      api.session()
        ? "Сессия активна. Токен хранится в памяти этой вкладки."
        : "Пароль и токен не сохраняются. После обновления страницы войдите снова.",
      "small muted",
    ),
  );
  if (api.session())
    add(
      conn,
      button("Выйти", async () => {
        api.logout();
        await settingsPage();
      }),
    );
  root.append(conn);
  const model = node("section", null, "settings-section");
  add(
    model,
    node("h2", "Модель и проверка"),
    para(
      "Начните с недорогой Flash-Lite. Выбирайте точный ID из каталога вашего ключа. Сервер отклоняет тарифы выше $0.50 за ввод и $2 за вывод на 1 млн токенов.",
    ),
  );
  const modelOut = node("div");
  const select = node("select");
  select.setAttribute("aria-label", "Модель из каталога ODIRouter");
  add(
    model,
    button("Загрузить каталог", async (b) => {
      b.disabled = true;
      try {
        const d = await api.request("/models");
        select.replaceChildren();
        for (const m of d.models) {
          const o = node("option", m.name + " · " + m.id);
          o.value = m.id;
          select.append(o);
        }
        modelOut.replaceChildren(
          select,
          button(
            "Выбрать и проверить цену",
            async () => {
              const info = await api.request("/model", { id: select.value });
              toast("Модель сохранена: " + info.model.id);
              await settingsPage();
            },
            "primary",
          ),
        );
        if (!d.models.length)
          modelOut.replaceChildren(
            para("В каталоге нет текстовых моделей.", "notice"),
          );
      } finally {
        b.disabled = false;
      }
    }),
    modelOut,
    button("Короткий тест API", async (b) => {
      b.disabled = true;
      try {
        const d = await api.request("/generate", {
          kind: "check",
          requestId: crypto.randomUUID(),
        });
        modelOut.replaceChildren(
          para(
            "JSON и структура приняты. Время: " +
              d.elapsedMs +
              " мс. Проверьте смысл и IPA:",
            "notice",
          ),
          para(
            "stores " +
              (d.result.word.ipa || "(IPA отсутствует)") +
              " — " +
              d.result.word.translation,
          ),
          para(d.result.sentenceTranslation),
        );
        for (const p of d.result.word.phrases)
          add(modelOut, para(p.term + " — " + p.translation, "small"));
        add(
          modelOut,
          para(d.result.question.question, "small"),
          para(d.result.question.options.join(" / "), "small"),
          para(
            "Ответ: " +
              d.result.question.options[d.result.question.answer] +
              " · " +
              d.result.question.explanation,
            "small",
          ),
        );
      } finally {
        b.disabled = false;
      }
    }),
    para(
      "Тест: одно предложение, слово stores, IPA, сочетание и вопрос. До 600 выходных токенов; максимум 3 проверки в день.",
      "small muted",
    ),
  );
  root.append(model);
  const usage = node("section", null, "settings-section"),
    usageOut = node("div");
  add(
    usage,
    node("h2", "Лимит и расход"),
    para(
      "Сервер считает все начатые запросы к модели, включая ошибки. День — по UTC. Кэш и повторная практика не расходуют лимит.",
    ),
  );
  const daily = node("input");
  daily.type = "number";
  daily.min = "1";
  daily.max = "200";
  daily.value = "40";
  add(
    usage,
    add(
      node("div", null, "inline-form"),
      add(node("label", "Запросов в день (до серверного максимума)"), daily),
      button("Сохранить лимит", async () => {
        await api.request("/limits", { daily: Number(daily.value) });
        toast("Лимит сохранён");
        await refreshUsage();
      }),
    ),
    button("Обновить расход", refreshUsage),
    usageOut,
  );
  async function refreshUsage() {
    const d = await api.request("/status");
    daily.value = d.daily;
    const m = d.model;
    usageOut.replaceChildren(
      para(
        `${d.day} UTC\nЗапросы: ${d.requests} / ${d.daily}\nОценка по токенам: $${d.estimated.toFixed(6)}\nВерхняя резервная оценка: $${d.reserved.toFixed(5)} / $${d.budget.toFixed(2)}\nПодтверждено провайдером: ${d.inputTokens} входных, ${d.outputTokens} выходных токенов\nСписание в деньгах: смотрите кабинет ODIRouter${m ? "\nМодель: " + m.id + "\nТариф за 1 млн: $" + m.input + " / $" + m.output : ""}`,
        "usage",
      ),
      para(
        "Резерв включает запросы, для которых провайдер не вернул usage. Это ограничитель расходов, а не подтверждённый счёт.",
        "small muted",
      ),
    );
  }
  root.append(usage);
  const typography = node("section", null, "settings-section"),
    range = node("input");
  range.type = "range";
  range.min = "17";
  range.max = "29";
  range.value = settings.fontSize;
  const rangeLabel = add(
    node("label", "Размер текста: " + settings.fontSize + " px"),
    range,
  );
  range.oninput = () =>
    run(async () => {
      settings.fontSize = Number(range.value);
      rangeLabel.firstChild.textContent =
        "Размер текста: " + settings.fontSize + " px";
      applyFont();
      await saveSettings();
    });
  add(
    typography,
    node("h2", "Чтение"),
    rangeLabel,
    para(
      "Нажмите на слово для перевода. Для фразы удерживайте слово, расширьте системное выделение и нажмите «Перевести выделенное». До 500 знаков.",
      "small muted",
    ),
  );
  root.append(typography);
  const backup = node("section", null, "settings-section"),
    upload = node("input");
  upload.type = "file";
  upload.accept = ".json,application/json";
  upload.hidden = true;
  upload.onchange = () =>
    run(async () => {
      try {
        const f = upload.files[0];
        if (!f) return;
        if (f.size > LIMITS.backup)
          throw new Error("Резервная копия больше 15 МБ");
        const b = validateBackup(JSON.parse(await f.text()));
        if (
          !confirm(
            `Восстановить ${b.docs.length} текстов и ${b.words.length} записей? Текущая библиотека, переводы и результаты будут заменены. Сначала экспортируйте их, если они нужны.`,
          )
        )
          return;
        await db.restoreData(b);
        toast("Библиотека восстановлена");
      } finally {
        upload.value = "";
      }
    });
  const uploadLabel = add(node("label", "Импорт JSON", "file-button"), upload);
  add(
    backup,
    node("h2", "Резервная копия"),
    para(
      "Данные привязаны к браузеру и устройству. Для переноса на телефон или компьютер экспортируйте JSON и импортируйте его там. Ключи, пароль и настройки подключения в копию не входят.",
    ),
    add(
      node("div", null, "backup-controls"),
      button("Экспорт JSON", async () => {
        const data = await db.exportData(),
          url = URL.createObjectURL(
            new Blob([JSON.stringify(data, null, 2)], {
              type: "application/json",
            }),
          ),
          a = link("", "");
        a.href = url;
        a.download =
          "margin-backup-" + new Date().toISOString().slice(0, 10) + ".json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast("Резервная копия подготовлена");
      }),
      uploadLabel,
    ),
    para(
      "Очистка данных браузера удалит библиотеку. Делайте копии регулярно. Облачной синхронизации нет.",
      "small muted",
    ),
    button("Защитить локальное хранение от очистки", async () => {
      const granted = await navigator.storage?.persist?.();
      toast(
        granted
          ? "Браузер разрешил постоянное хранение"
          : "Браузер не предоставил постоянное хранение. Сохраняйте JSON-копии.",
      );
    }),
  );
  root.append(backup);
  main.replaceChildren(root);
  if (api.session())
    try {
      await refreshUsage();
    } catch (e) {
      errorView(usageOut, e);
    }
}
async function route() {
  await saveProgress();
  const ticket = ++renderId;
  resetSelection();
  if (modal.open) closeTranslation();
  clearTimeout(tapTimer);
  const [name, id] = location.hash.slice(1).split("/");
  view = name || "texts";
  current = null;
  window.scrollTo(0, 0);
  try {
    if (view === "read") await read(id, ticket);
    else if (view === "practice") await practice(id, ticket);
    else if (view === "words") await dictionary();
    else if (view === "settings") await settingsPage();
    else await library();
  } catch (e) {
    errorView(main, e);
  }
}
window.addEventListener("hashchange", () => run(route));
try {
  const stored = await db.get("meta", "settings");
  if (stored) {
    settings.fontSize = Math.max(
      17,
      Math.min(29, Number(stored.fontSize) || 21),
    );
    if (stored.backend)
      try {
        settings.backend = api.setBase(stored.backend);
      } catch {}
  }
  applyFont();
  if (!(await db.get("meta", "initialized"))) {
    await db.tx(["docs", "meta"], "readwrite", (t) => {
      t.objectStore("docs").put(DEMO);
      t.objectStore("meta").put({ id: "initialized", value: true });
    });
  }
  await route();
  if ("serviceWorker" in navigator)
    navigator.serviceWorker.register("./sw.js").catch(() => {});
} catch (e) {
  errorView(
    main,
    new Error("Не удалось открыть локальное хранилище: " + e.message),
  );
}
