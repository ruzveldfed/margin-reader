import * as api from "./api.js";
let pending;
export function ensureSession() {
  if (api.session()) return Promise.resolve();
  if (pending) return pending;
  const dialog = document.querySelector("#sign-in"), form = document.querySelector("#sign-in-form");
  const password = document.querySelector("#sign-in-password"), out = document.querySelector("#sign-in-error");
  const submit = form.querySelector('[type="submit"]');
  password.value = "";
  out.textContent = "";
  pending = new Promise((resolve, reject) => {
    let completed = false;
    form.onsubmit = async event => {
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      out.textContent = "";
      try {
        await api.login(password.value, true);
        completed = true;
        dialog.close();
        resolve();
      } catch (e) { out.textContent = e.message; }
      finally { password.value = ""; submit.disabled = false; }
    };
    dialog.addEventListener("close", () => {
      password.value = "";
      form.onsubmit = null;
      if (!completed) reject(Object.assign(new Error("Вход отменён. Текст сохранён."), { code: "SIGN_IN_CANCELLED" }));
    }, { once: true });
    document.querySelector("#close-sign-in").onclick = () => dialog.close();
    dialog.showModal();
    password.focus();
  }).finally(() => { pending = null; });
  return pending;
}
