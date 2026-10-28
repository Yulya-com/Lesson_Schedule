// ui.js — небольшие DOM-хелперы: создание элементов, модальные окна,
// уведомления, поля формы. Без побочных эффектов при импорте.

/**
 * Создаёт элемент.
 * props: class, text, style, dataset, aria-*, on<Event>, остальные — атрибуты.
 * Разметку через innerHTML хелпер не принимает: любой пользовательский текст
 * (имя ученика, заметка) должен попадать в DOM только как текст.
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === "class") {
      node.className = value;
    } else if (key === "text") {
      node.textContent = String(value);
    } else if (key === "style") {
      // CSP запрещает атрибут style целиком, но присваивание через CSSOM
      // (node.style.setProperty) разрешено. Строку "top: 10px; height: 40px"
      // разбираем на отдельные свойства.
      String(value).split(";").forEach((rule) => {
        const separator = rule.indexOf(":");
        if (separator === -1) return;
        const property = rule.slice(0, separator).trim();
        const setting = rule.slice(separator + 1).trim();
        if (property && setting) node.style.setProperty(property, setting);
      });
    } else if (key === "dataset") {
      Object.assign(node.dataset, value);
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      node.setAttribute(key, "");
    } else {
      node.setAttribute(key, String(value));
    }
  }

  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

let fieldCounter = 0;

const LABELABLE = new Set(["INPUT", "SELECT", "TEXTAREA"]);

/** Поле формы с подписью, подсказкой и местом под ошибку. */
export function field({ label, control, hint, required = false, className = "" }) {
  const labelable = LABELABLE.has(control.tagName);

  if (labelable && !control.id) {
    fieldCounter += 1;
    control.id = `field-${fieldCounter}`;
  }

  const error = el("span", { class: "field__error", role: "alert" });
  const labelNode = el("label", {
    class: "field__label",
    for: labelable ? control.id : null,
  }, [
    label,
    required ? el("span", { class: "field__req", text: "*", "aria-hidden": "true" }) : null,
  ]);

  const wrap = el("div", { class: `field ${className}`.trim() }, [
    labelNode,
    control,
    hint ? el("span", { class: "field__hint", text: hint }) : null,
    error,
  ]);

  wrap.setError = (message) => {
    error.textContent = message || "";
    wrap.classList.toggle("has-error", Boolean(message));
    control.setAttribute("aria-invalid", message ? "true" : "false");
  };

  wrap.setError("");
  return wrap;
}

export function input(props = {}) {
  return el("input", { class: "input", ...props });
}

export function select(options, props = {}) {
  const { value, ...rest } = props;
  const node = el("select", { class: "input", ...rest });
  for (const option of options) {
    node.append(el("option", { value: option.value, text: option.label }));
  }
  if (value !== undefined && value !== null) node.value = String(value);
  return node;
}

export function checkbox({ label, checked = false, name, onChange }) {
  const inputNode = el("input", { type: "checkbox", class: "switch__input", name, checked });
  if (onChange) inputNode.addEventListener("change", onChange);
  const wrap = el("label", { class: "switch" }, [
    inputNode,
    el("span", { class: "switch__track", "aria-hidden": "true" }),
    el("span", { class: "switch__label", text: label }),
  ]);
  // Не используем имя control: у label это встроенное свойство только для чтения.
  wrap.inputNode = inputNode;
  return wrap;
}

/* ---------- Модальные окна ---------- */

let openCount = 0;

/**
 * Открывает модальное окно. Возвращает { close, dialog, body }.
 */
export function openModal({ title, subtitle = "", body, footer = null, size = "md", onClose = null } = {}) {
  const previousFocus = document.activeElement;

  const dialog = el("div", {
    class: `modal modal--${size}`,
    role: "dialog",
    "aria-modal": "true",
    "aria-label": title || "Диалог",
    tabindex: "-1",
  });

  const closeButton = el("button", {
    class: "icon-btn",
    type: "button",
    "aria-label": "Закрыть окно",
    text: "✕",
  });

  const bodyNode = el("div", { class: "modal__body" }, body || []);

  const head = el("div", { class: "modal__head" }, [
    el("div", { class: "modal__heading" }, [
      el("h2", { class: "modal__title", text: title || "" }),
      subtitle ? el("p", { class: "modal__subtitle", text: subtitle }) : null,
    ]),
    closeButton,
  ]);

  dialog.append(head, bodyNode);
  if (footer) dialog.append(el("div", { class: "modal__foot" }, footer));

  const overlay = el("div", { class: "modal-overlay" }, [dialog]);
  document.body.append(overlay);
  openCount += 1;
  document.body.classList.add("is-modal");

  function close() {
    if (!overlay.isConnected) return;
    overlay.remove();
    openCount = Math.max(0, openCount - 1);
    if (!openCount) document.body.classList.remove("is-modal");
    document.removeEventListener("keydown", onKeydown, true);
    if (previousFocus && typeof previousFocus.focus === "function") {
      previousFocus.focus();
    }
    if (onClose) onClose();
  }

  function focusable() {
    return [...dialog.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((node) => node.offsetParent !== null || node === document.activeElement);
  }

  function onKeydown(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusable();
    if (!items.length) return;
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  closeButton.addEventListener("click", close);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKeydown, true);

  requestAnimationFrame(() => {
    const firstField = dialog.querySelector("select, input, textarea");
    (firstField || dialog).focus();
  });

  return { close, dialog, body: bodyNode, overlay };
}

/** Подтверждение опасного действия. Возвращает Promise<boolean>. */
export function confirmDialog({
  title,
  message,
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    let result = false;

    const cancel = el("button", { class: "btn btn--ghost", type: "button", text: cancelLabel });
    const confirm = el("button", {
      class: `btn ${danger ? "btn--danger" : "btn--primary"}`,
      type: "button",
      text: confirmLabel,
    });

    const modal = openModal({
      title,
      size: "sm",
      body: el("p", { class: "modal__text", text: message }),
      footer: [cancel, confirm],
      onClose: () => resolve(result),
    });

    cancel.addEventListener("click", () => modal.close());
    confirm.addEventListener("click", () => {
      result = true;
      modal.close();
    });
    confirm.focus();
  });
}

/* ---------- Уведомления ---------- */

export function toast(message, { type = "info", actionLabel = "", onAction = null, timeout = 6000 } = {}) {
  const host = document.getElementById("toasts");
  if (!host) return () => {};

  const node = el("div", { class: `toast toast--${type}`, role: "status" });
  let timer = null;

  const dismiss = () => {
    if (!node.isConnected) return;
    clearTimeout(timer);
    node.classList.add("is-leaving");
    setTimeout(() => node.remove(), 180);
  };

  node.append(el("span", { class: "toast__text", text: message }));

  if (actionLabel && onAction) {
    node.append(el("button", {
      class: "toast__action",
      type: "button",
      text: actionLabel,
      onclick: () => {
        dismiss();
        Promise.resolve(onAction()).catch((error) => console.error(error));
      },
    }));
  }

  node.append(el("button", {
    class: "toast__close",
    type: "button",
    "aria-label": "Закрыть уведомление",
    text: "✕",
    onclick: dismiss,
  }));

  host.append(node);
  timer = setTimeout(dismiss, timeout);
  return dismiss;
}

/* ---------- Мелкие блоки ---------- */

export function emptyState({ title, text, actions = [] }) {
  return el("div", { class: "empty" }, [
    el("h3", { class: "empty__title", text: title }),
    text ? el("p", { class: "empty__text", text }) : null,
    actions.length ? el("div", { class: "empty__actions" }, actions) : null,
  ]);
}

export function badge(text, tone = "neutral") {
  return el("span", { class: `badge badge--${tone}`, text });
}

export function segmented(items, current, onChange, ariaLabel = "") {
  const wrap = el("div", { class: "segmented", role: "tablist", "aria-label": ariaLabel });
  for (const item of items) {
    const active = item.value === current;
    wrap.append(el("button", {
      class: `segmented__item${active ? " is-active" : ""}`,
      type: "button",
      role: "tab",
      "aria-selected": String(active),
      text: item.label,
      onclick: () => onChange(item.value),
    }));
  }
  return wrap;
}
