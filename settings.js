export async function renderSettings(ui) {
  const { main, settings, saveSettings, applyFont, applyTheme, node, add, button, para } = ui;
  const root = node("div", null, "settings appearance-settings");
  const size = node("output", settings.fontSize + " px");
  size.setAttribute("aria-live", "polite");
  const change = async delta => {
    settings.fontSize = Math.max(17, Math.min(29, settings.fontSize + delta));
    size.textContent = settings.fontSize + " px";
    smaller.disabled = settings.fontSize === 17;
    larger.disabled = settings.fontSize === 29;
    applyFont();
    await saveSettings();
  };
  const smaller = button("A−", () => change(-1)), larger = button("A+", () => change(1));
  smaller.setAttribute("aria-label", "Уменьшить шрифт");
  larger.setAttribute("aria-label", "Увеличить шрифт");
  smaller.disabled = settings.fontSize === 17;
  larger.disabled = settings.fontSize === 29;
  const dark = node("input");
  dark.type = "checkbox";
  dark.setAttribute("role", "switch");
  dark.checked = settings.theme === "dark";
  dark.onchange = () => ui.run(async () => {
    settings.theme = dark.checked ? "dark" : "light";
    applyTheme();
    await saveSettings();
  });
  add(root, node("h1", "Настройки"),
    add(node("section", null, "appearance-row"), node("h2", "Размер текста"),
      add(node("div", null, "size-controls"), smaller, size, larger)),
    add(node("section", null, "appearance-row"), add(node("label", null, "theme-control"),
      node("span", "Тёмная тема"), dark)),
    para("The best way to learn is to keep reading.", "appearance-preview"));
  main.replaceChildren(root);
}
