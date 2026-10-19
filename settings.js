import * as api from "./api.js";
import * as db from "./db.js";
import { LIMITS, validateBackup } from "./schema.js";

export async function renderSettings(ui) {
  const {
    main,
    settings,
    saveSettings,
    applyFont,
    toast,
    node,
    add,
    button,
    para,
    link,
    onRender,
  } = ui;
  const root = node("div", null, "settings");
  root.append(node("h1", "Настройки"));
  const section = (title) =>
    add(node("section", null, "settings-section"), node("h2", title));
  const feedback = () => {
    const el = node("div", null, "settings-feedback");
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    return el;
  };
  const message = (el, text, isError = false) => {
    el.replaceChildren(para(text, isError ? "error" : "small muted"));
  };
  const busy = async (b, label, out, task) => {
    const original = b.textContent;
    b.disabled = true;
    b.textContent = label;
    out?.replaceChildren();
    try {
      await task();
    } catch (e) {
      if (out) message(out, e.message, true);
      else toast(e.message);
      if (connected && !api.session()) {
        connection.replaceChildren(
          node("h2", "Переводы"),
          para("Сессия истекла. Войдите снова для новых переводов.", "notice"),
          button("Войти снова", onRender, "primary"),
        );
        choose.disabled = true;
        refresh.disabled = true;
        saveLimit.disabled = true;
        check.disabled = true;
        apiTest.disabled = true;
      }
    } finally {
      b.disabled = connected && !api.session();
      b.textContent = original;
    }
  };

  const connection = section("Переводы"),
    connected = api.session();
  const status = add(
    node("div", null, "connection-state"),
    node("span", null, "status-dot"),
    node("strong", connected ? "Вход сохранён" : "Нужен вход"),
  );
  if (!connected) status.classList.add("inactive");
  connection.append(status);
  if (connected) {
    const until = new Date(api.sessionExpires()).toLocaleString("ru-RU", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
    connection.append(
      para(
        "На этом устройстве — до " +
          until +
          ". Повторный ввод пароля пока не нужен.",
        "small muted",
      ),
    );
    connection.append(
      button(
        "Выйти",
        async () => {
          await api.logout();
          await onRender();
        },
        "quiet",
      ),
    );
  } else {
    connection.append(
      para(
        "Войдите на этом устройстве, чтобы получать новые переводы. Сохранённые тексты доступны без входа.",
      ),
    );
    const form = node("form"),
      password = node("input"),
      remember = node("input"),
      out = feedback();
    password.type = "password";
    password.autocomplete = "current-password";
    password.name = "password";
    password.maxLength = 256;
    password.required = true;
    password.placeholder = "Ваш пароль доступа";
    remember.type = "checkbox";
    remember.checked = true;
    const enter = node("button", "Войти", "primary");
    enter.type = "submit";
    add(
      form,
      add(
        node("div", null, "inline-form"),
        add(node("label", "Пароль доступа"), password),
        enter,
      ),
      add(
        node("label", null, "check-label"),
        remember,
        node("span", "Запомнить вход на этом устройстве"),
      ),
      para("Сессия до 7 дней. Пароль не сохраняется.", "small muted"),
      out,
    );
    form.onsubmit = (e) => {
      e.preventDefault();
      busy(enter, "Подключаемся…", out, async () => {
        try {
          await api.login(password.value, remember.checked);
        } finally {
          password.value = "";
        }
        await onRender();
        toast("Вход выполнен");
      });
    };
    connection.append(form);
  }
  root.append(connection);

  const model = section("Модель перевода"),
    modelSummary = node("div"),
    picker = node("div"),
    modelFeedback = feedback();
  const paintModel = () => {
    const current = api.savedStatus()?.model;
    modelSummary.replaceChildren(
      current
        ? para(current.id, "model-name")
        : para("Ещё не выбрана", "muted"),
    );
    modelSummary.append(
      para(
        current
          ? "Модель сохранена. Повторно выбирать её не нужно."
          : "Выберите модель один раз после входа. Она будет переводить слова и готовить упражнения.",
        "small muted",
      ),
    );
  };
  paintModel();
  const choose = button(
    api.savedStatus()?.model ? "Изменить модель" : "Выбрать модель",
    async (b) => {
      await busy(b, "Загружаем модели…", modelFeedback, async () => {
        const data = await api.request("/models");
        const select = node("select");
        select.setAttribute("aria-label", "Модель перевода");
        for (const m of data.models) {
          const o = node("option", m.name + " · " + m.id);
          o.value = m.id;
          select.append(o);
        }
        if (!data.models.length) {
          message(
            modelFeedback,
            "В каталоге нет доступных текстовых моделей.",
            true,
          );
          return;
        }
        const selected = api.savedStatus()?.model?.id;
        if (selected && data.models.some((m) => m.id === selected))
          select.value = selected;
        picker.replaceChildren(
          add(node("label", "Доступные модели"), select),
          para(
            "Проверенный вариант — DeepSeek V4 Flash. Перед сохранением сервис проверит стоимость. Другие маршруты могут быть недоступны у провайдера.",
            "small muted",
          ),
          button(
            "Использовать модель",
            async (save) => {
              await busy(save, "Проверяем цену…", modelFeedback, async () => {
                await api.request("/model", { id: select.value });
                paintModel();
                picker.replaceChildren();
                choose.textContent = "Изменить модель";
                message(
                  modelFeedback,
                  "Готово. Модель сохранена для дальнейшего чтения.",
                );
              });
            },
            "primary",
          ),
        );
      });
    },
  );
  choose.disabled = !connected;
  add(model, modelSummary, choose, picker, modelFeedback);
  root.append(model);

  const reading = section("Чтение"),
    range = node("input");
  range.type = "range";
  range.min = "17";
  range.max = "29";
  range.value = settings.fontSize;
  const rangeLabel = add(
    node("label", "Размер текста: " + settings.fontSize + " px"),
    range,
  );
  range.oninput = async () => {
    settings.fontSize = Number(range.value);
    rangeLabel.firstChild.textContent =
      "Размер текста: " + settings.fontSize + " px";
    applyFont();
    try {
      await saveSettings();
    } catch (e) {
      toast(e.message);
    }
  };
  add(
    reading,
    rangeLabel,
    para(
      "Нажмите на слово для перевода. Для фразы удерживайте слово и расширьте обычное выделение текста.",
      "small muted",
    ),
  );
  root.append(reading);

  const usage = section("Дневной лимит"),
    daily = node("input"),
    usageInfo = node("div"),
    usageFeedback = feedback();
  daily.type = "number";
  daily.min = "1";
  daily.max = "200";
  daily.value = api.savedStatus()?.daily || 40;
  const paintUsage = () => {
    const data = api.savedStatus();
    usageInfo.replaceChildren();
    if (!data?.day) {
      usageInfo.append(
        para(
          "Расход появится после обновления. Открытие настроек не делает запросов.",
          "small muted",
        ),
      );
      return;
    }
    const fresh = data.day === new Date().toISOString().slice(0, 10);
    add(
      usageInfo,
      add(
        node("div", null, "usage-summary"),
        add(
          node("div"),
          node("strong", String(data.requests || 0)),
          node("span", " запросов"),
        ),
        add(
          node("div"),
          node("strong", "$" + Number(data.estimated || 0).toFixed(5)),
          node("span", " примерно"),
        ),
      ),
      para(
        (fresh ? "Сегодня" : "Данные за " + data.day) +
          " · последнее обновление " +
            new Date(data.usageUpdated || data.updated).toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        "small muted",
      ),
      para(
        "Это расчёт по токенам. Фактические списания смотрите в ODIRouter.",
        "small muted",
      ),
    );
  };
  paintUsage();
  const limitForm = node("form"),
    saveLimit = node("button", "Сохранить лимит");
  saveLimit.type = "submit";
  saveLimit.disabled = !connected;
  add(
    limitForm,
    add(
      node("div", null, "inline-form"),
      add(node("label", "Новых запросов в день"), daily),
      saveLimit,
    ),
  );
  limitForm.onsubmit = (e) => {
    e.preventDefault();
    busy(saveLimit, "Сохраняем…", usageFeedback, async () => {
      await api.request("/limits", { daily: Number(daily.value) });
      message(usageFeedback, "Лимит сохранён.");
    });
  };
  const refresh = button("Обновить расход", async (b) =>
    busy(b, "Обновляем…", usageFeedback, async () => {
      const data = await api.request("/status");
      daily.value = data.daily;
      paintUsage();
      paintModel();
      message(usageFeedback, "Данные обновлены.");
    }),
  );
  refresh.disabled = !connected;
  add(
    usage,
    para(
      "Повторный перевод из памяти и готовая практика не расходуют лимит.",
      "small muted",
    ),
    limitForm,
    refresh,
    usageInfo,
    usageFeedback,
  );
  root.append(usage);

  const backup = section("Резервная копия"),
    upload = node("input");
  upload.type = "file";
  upload.accept = ".json,application/json";
  upload.hidden = true;
  upload.onchange = async () => {
    try {
      const f = upload.files[0];
      if (!f) return;
      if (f.size > LIMITS.backup)
        throw new Error("Резервная копия больше 15 МБ");
      const b = validateBackup(JSON.parse(await f.text()));
      if (
        !confirm(
          `Восстановить ${b.docs.length} текстов и ${b.words.length} записей? Текущая библиотека и результаты будут заменены.`,
        )
      )
        return;
      await db.restoreData(b);
      toast("Библиотека восстановлена");
    } catch (e) {
      toast(e.message);
    } finally {
      upload.value = "";
    }
  };
  add(
    backup,
    para(
      "Тексты и словарь хранятся в этом браузере. Для переноса на другое устройство сохраните JSON и импортируйте его там.",
      "small muted",
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
      add(node("label", "Импорт JSON", "file-button"), upload),
    ),
    para("Ключ, пароль и сохранённый вход в копию не входят.", "small muted"),
  );
  root.append(backup);

  const advanced = node("details", null, "settings-details"),
    technicalFeedback = feedback(),
    address = node("input");
  address.type = "url";
  address.value = settings.backend;
  address.required = true;
  const addressForm = node("form"),
    saveAddress = node("button", "Сохранить адрес");
  saveAddress.type = "submit";
  add(addressForm, add(node("label", "Адрес сервиса"), address), saveAddress);
  addressForm.onsubmit = (e) => {
    e.preventDefault();
    busy(saveAddress, "Сохраняем…", technicalFeedback, async () => {
      const old = settings.backend;
      settings.backend = api.setBase(address.value.trim());
      await saveSettings();
      address.value = settings.backend;
      if (old !== settings.backend) {
        await onRender();
        toast("Адрес изменён. Войдите для нового сервиса.");
      } else
        message(
          technicalFeedback,
          "Адрес сохранён. Повторно вводить его не нужно.",
        );
    });
  };
  const check = button("Проверить соединение", async (b) =>
    busy(b, "Проверяем…", technicalFeedback, async () => {
      await api.request("/status");
      paintModel();
      paintUsage();
      message(
        technicalFeedback,
        "Соединение работает. Вход подтверждён. Проверка не вызывает модель.",
      );
    }),
  );
  check.disabled = !connected;
  const apiTest = button("Проверить перевод", async (b) =>
    busy(b, "Получаем тестовый перевод…", technicalFeedback, async () => {
      const data = await api.request("/generate", {
          kind: "check",
          requestId: crypto.randomUUID(),
        }),
        r = data.result;
      technicalFeedback.replaceChildren(
        para(
          "Перевод получен за " +
            (data.elapsedMs / 1000).toFixed(1) +
            " с. Проверьте смысл и произношение.",
          "notice",
        ),
        para(
          "stores " +
            (r.word.ipa || "(IPA отсутствует)") +
            " — " +
            r.word.translation,
        ),
        para(r.sentenceTranslation),
      );
      for (const p of r.word.phrases)
        technicalFeedback.append(para(p.term + " — " + p.translation, "small"));
      add(
        technicalFeedback,
        para(r.question.question, "small"),
        para(r.question.options.join(" / "), "small"),
        para(
          "Ответ: " +
            r.question.options[r.question.answer] +
            " · " +
            r.question.explanation,
          "small",
        ),
      );
    }),
  );
  apiTest.disabled = !connected;
  const diagnostic = node("details", null, "diagnostic-details");
  const price = api.savedStatus()?.model;
  add(
    diagnostic,
    node("summary", "Стоимость и технические ограничения"),
    para(
      (price
        ? "Тариф за 1 млн токенов: $" +
          price.input +
          " ввод / $" +
          price.output +
          " вывод. "
        : "") +
        "Допустимый тариф: до $0.50 / $2 за 1 млн токенов. Дневной резерв по умолчанию — $0.10; уточняйте его после обновления расхода. День начинается в 00:00 UTC.",
      "small muted",
    ),
    para(
      "Проверка перевода — один запрос до 600 выходных токенов. Она учитывается в общем дневном лимите и бюджете; отдельного ограничения числа проверок нет. Автоматических повторов и смены модели нет.",
      "small muted",
    ),
  );
  add(
    advanced,
    node("summary", "Дополнительно"),
    para(
      "Адрес сервиса уже задан для этого сайта. Меняйте его только при переносе серверной части.",
      "small muted",
    ),
    addressForm,
    add(node("div", null, "settings-actions"), check, apiTest),
    technicalFeedback,
    diagnostic,
    button("Защитить локальное хранение от очистки", async () => {
      const ok = await navigator.storage?.persist?.();
      toast(
        ok
          ? "Браузер разрешил постоянное хранение"
          : "Браузер не предоставил постоянное хранение. Делайте JSON-копии.",
      );
    }),
  );
  root.append(advanced);
  main.replaceChildren(root);
}
