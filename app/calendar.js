// calendar.js — сетка недели и сетка месяца.
// Модуль только рисует и сообщает о действиях пользователя через handlers:
// состояние и запись в базу живут в app.js.

import {
  WEEKDAYS,
  weekDays,
  monthGrid,
  weekdayIndex,
  todayISO,
  timeToMinutes,
  minutesToTime,
  timeRangeLabel,
  addDays,
} from "./recurrence.js";
import { el } from "./ui.js";

/** Пикселей на минуту: час занимает 52 px. */
const PX_PER_MIN = 52 / 60;

/** Порог движения мыши, после которого начинается перенос. */
const DRAG_THRESHOLD = 4;

/** Удержание пальца для переноса на сенсорном экране. */
const TOUCH_HOLD_MS = 260;

function isTouch(event) {
  return event.pointerType === "touch" || event.pointerType === "pen";
}

function studentsMap(students) {
  return new Map(students.map((student) => [student.id, student]));
}

function subjectClass(student) {
  return `subj-${student?.color || "indigo"}`;
}

/* ---------- Сетка недели ---------- */

export function renderWeek({
  weekStart,
  firstDay = 1,
  workHours,
  lessons,
  students,
  handlers = {},
}) {
  const today = todayISO();
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const days = weekDays(weekStart, firstDay);
  const map = studentsMap(students);
  const step = [15, 30, 60].includes(Number(workHours.step)) ? Number(workHours.step) : 30;

  let startMin = timeToMinutes(workHours.start || "08:00");
  let endMin = timeToMinutes(workHours.end || "22:00");
  if (endMin <= startMin) endMin = startMin + 120;

  const visible = lessons.filter((lesson) => days.includes(lesson.date));

  // Выходные можно скрыть, но день с занятиями показываем всегда:
  // иначе занятие стало бы недоступно в расписании.
  const showWeekends = workHours.showWeekends !== false;
  const workdayList = workHours.workdays || [1, 2, 3, 4, 5, 6];
  const shownDays = showWeekends
    ? days
    : days.filter((date) => workdayList.includes(weekdayIndex(date))
        || visible.some((lesson) => lesson.date === date));
  const columns = `var(--gutter) repeat(${shownDays.length}, minmax(0, 1fr))`;

  // Занятие вне графика всё равно должно быть видно — расширяем сетку.
  for (const lesson of visible) {
    const start = timeToMinutes(lesson.startTime);
    const end = start + lesson.duration;
    if (start < startMin) startMin = Math.floor(start / 60) * 60;
    if (end > endMin) endMin = Math.ceil(end / 60) * 60;
  }

  const height = (endMin - startMin) * PX_PER_MIN;
  const stepHeight = step * PX_PER_MIN;
  const hourHeight = 60 * PX_PER_MIN;

  const root = el("div", { class: "week" });
  const head = el("div", { class: "week__head", style: `grid-template-columns:${columns}` }, [
    el("div", { class: "week__corner", "aria-hidden": "true" }),
  ]);

  for (const date of shownDays) {
    const isToday = date === today;
    const isWorkday = workdayList.includes(weekdayIndex(date));
    const dayButton = el("button", {
      class: `week__day-head${isToday ? " is-today" : ""}${isWorkday ? "" : " is-off"}`,
      type: "button",
      title: "Открыть неделю с этого дня",
    }, [
      el("span", { class: "week__day-name", text: WEEKDAYS[weekdayIndex(date) - 1].short }),
      el("span", { class: "week__day-num", text: String(Number(date.slice(8))) }),
    ]);
    dayButton.addEventListener("click", () => handlers.onDayClick?.(date));
    head.append(dayButton);
  }

  const times = el("div", { class: "week__times", style: `height:${height}px` });
  for (let minute = startMin; minute < endMin; minute += 60) {
    times.append(el("div", {
      class: "week__time",
      style: `top:${(minute - startMin) * PX_PER_MIN}px`,
      text: minutesToTime(minute),
    }));
  }

  const cols = el("div", { class: "week__cols", style: `grid-template-columns:repeat(${shownDays.length}, minmax(0, 1fr))` });
  let suppressClick = false;
  let ghost = null;

  function clearGhost() {
    if (ghost) {
      ghost.remove();
      ghost = null;
    }
  }

  function showGhost(target, duration) {
    clearGhost();
    if (!target) return;
    const column = cols.querySelector(`.week__col[data-date="${target.date}"]`);
    if (!column) return;
    ghost = el("div", {
      class: "week__ghost",
      style: `top:${(target.minutes - startMin) * PX_PER_MIN}px;height:${duration * PX_PER_MIN}px`,
    });
    column.append(ghost);
  }

  function slotFromPoint(clientX, clientY) {
    const node = document.elementFromPoint(clientX, clientY);
    const column = node && node.closest ? node.closest(".week__col") : null;
    if (!column || !cols.contains(column)) return null;

    const rect = column.getBoundingClientRect();
    const offsetY = Math.min(Math.max(clientY - rect.top, 0), height);
    const snapped = Math.round((offsetY / PX_PER_MIN) / step) * step;
    const minutes = Math.max(startMin, Math.min(endMin - 15, startMin + snapped));

    return { date: column.dataset.date, minutes, time: minutesToTime(minutes) };
  }

  const ctx = {
    root,
    handlers,
    startMin,
    slotFromPoint,
    showGhost,
    clearGhost,
    suppress: () => {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 300);
    },
  };

  for (const date of shownDays) {
    const isToday = date === today;
    const isWorkday = workdayList.includes(weekdayIndex(date));
    const column = el("div", {
      class: `week__col${isToday ? " is-today" : ""}${isWorkday ? "" : " is-off"}`,
      dataset: { date },
      style: `height:${height}px;--hour-h:${hourHeight}px;--step-h:${stepHeight}px`,
    });

    column.addEventListener("click", (event) => {
      if (suppressClick) return;
      if (event.target.closest(".lesson")) return;

      const rect = column.getBoundingClientRect();
      const offsetY = Math.min(Math.max(event.clientY - rect.top, 0), height);
      const snapped = Math.floor((offsetY / PX_PER_MIN) / step) * step;
      const minutes = Math.max(startMin, Math.min(endMin - 15, startMin + snapped));
      handlers.onCreate?.({ date, time: minutesToTime(minutes) });
    });

    for (const lesson of visible.filter((item) => item.date === date)) {
      column.append(buildLesson(lesson, map.get(lesson.studentId), ctx));
    }

    if (isToday && nowMinutes >= startMin && nowMinutes <= endMin) {
      column.append(el("div", {
        class: "week__now",
        style: `top:${(nowMinutes - startMin) * PX_PER_MIN}px`,
        "aria-hidden": "true",
      }));
    }

    cols.append(column);
  }

  const body = el("div", { class: "week__body" }, [times, cols]);
  root.append(head, body);

  return el("div", { class: "week-scroll" }, [root]);
}

function buildLesson(lesson, student, ctx) {
  const start = timeToMinutes(lesson.startTime);
  const end = start + lesson.duration;
  const top = (start - ctx.startMin) * PX_PER_MIN;
  const height = lesson.duration * PX_PER_MIN;

  const fullName = student ? student.name : "Ученик не найден";
  const lastName = student?.lastName || (student ? "" : "Ученик не найден");
  const firstName = student?.firstName || (student ? "" : "");

  const node = el("button", {
    class: [
      "lesson",
      `lesson--${lesson.status}`,
      subjectClass(student),
      lesson.detached ? "lesson--detached" : "",
      height < 34 ? "lesson--xs" : "",
    ].filter(Boolean).join(" "),
    type: "button",
    dataset: { id: lesson.id },
    style: `top:${top}px;height:${height}px`,
    title: [
      fullName,
      timeRangeLabel(lesson.startTime, lesson.duration),
      lesson.subject || student?.subject || "",
      lesson.paid ? "оплачено" : "не оплачено",
      lesson.detached ? "разово" : "",
    ].filter(Boolean).join(" · "),
  });

  // Совсем низкий блок (15 минут) не вмещает две строки:
  // тогда показываем «Фамилия И.» одной строкой.
  const tiny = height < 24;

  if (tiny) {
    node.classList.add("lesson--tiny");
    const short = lastName && firstName ? `${lastName} ${firstName.charAt(0)}.` : (lastName || firstName);
    node.append(el("span", { class: "lesson__tiny", text: short }));
    if (lesson.paid) {
      node.append(el("span", { class: "lesson__paid", text: "₽", title: "Оплачено", "aria-label": "Оплачено" }));
    }
    node.append(el("span", { class: "lesson__resize", "aria-hidden": "true" }));
    attachLessonHandlers(node, lesson, ctx);
    return node;
  }

  // Первая строка: время и фамилия. Вторая: имя. Так в блоке видны оба поля,
  // а время всё равно читается по сетке.
  const head = el("span", { class: "lesson__head" }, [
    el("span", { class: "lesson__time", text: `${lesson.startTime}–${minutesToTime(end)}` }),
    el("span", { class: "lesson__last", text: lastName }),
  ]);

  if (lesson.paid) {
    head.append(el("span", {
      class: "lesson__paid",
      text: "₽",
      title: "Оплачено",
      "aria-label": "Оплачено",
    }));
  }

  node.append(head);

  if (firstName) node.append(el("span", { class: "lesson__first", text: firstName }));

  // Предмет — только если блок достаточно высокий, чтобы не теснить имя.
  if (height >= 48) {
    const sub = lesson.subject || student?.subject || "";
    if (sub) node.append(el("span", { class: "lesson__sub", text: sub }));
  }

  if (lesson.detached && height >= 48) {
    node.append(el("span", { class: "lesson__flag", text: "разово" }));
  }

  node.append(el("span", { class: "lesson__resize", "aria-hidden": "true" }));

  attachLessonHandlers(node, lesson, ctx);
  return node;
}

/** Навешивает открытие, сдвиг с клавиатуры, перетаскивание и растягивание. */
function attachLessonHandlers(node, lesson, ctx) {
  const start = timeToMinutes(lesson.startTime);

  // Клавиатура: Enter/Space дают click с detail === 0.
  node.addEventListener("click", (event) => {
    if (event.detail === 0) ctx.handlers.onOpen?.(lesson);
  });

  node.addEventListener("keydown", (event) => {
    if (!event.altKey) return;
    const shifts = {
      ArrowLeft: { date: addDays(lesson.date, -1), time: lesson.startTime },
      ArrowRight: { date: addDays(lesson.date, 1), time: lesson.startTime },
      ArrowUp: { date: lesson.date, time: minutesToTime(Math.max(0, start - 15)) },
      ArrowDown: { date: lesson.date, time: minutesToTime(start + 15) },
    };
    const shift = shifts[event.key];
    if (!shift) return;
    event.preventDefault();
    ctx.handlers.onMove?.(lesson, shift);
  });

  node.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest(".lesson__resize")) return;
    startDrag(event, node, lesson, ctx);
  });

  const handle = node.querySelector(".lesson__resize");
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    startResize(event, node, lesson, ctx);
  });
}

function startDrag(event, node, lesson, ctx) {
  event.preventDefault();

  const startX = event.clientX;
  const startY = event.clientY;
  const touch = isTouch(event);
  let active = false;
  let holdTimer = null;
  let cancelled = false;

  capturePointer(node, event.pointerId);
  node.classList.add("is-pressed");

  // На сенсорном экране перенос начинается только после удержания,
  // иначе обычный свайп по расписанию превращался бы в перенос занятия.
  if (touch) {
    holdTimer = setTimeout(() => {
      if (cancelled) return;
      node.classList.add("is-touch-armed");
    }, TOUCH_HOLD_MS);
  }

  function onPointerMove(moveEvent) {
    if (touch) {
      const armed = node.classList.contains("is-touch-armed");
      const moved = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
      // До удержания двигаем — значит человек листает расписание, отменяем.
      if (!armed && moved > 8) {
        cancel();
        return;
      }
      if (!armed) return;
    }

    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;

    if (!active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!active) {
      active = true;
      node.classList.add("is-dragging");
      ctx.root.classList.add("is-dragging");
    }

    node.style.transform = `translate(${dx}px, ${dy}px)`;
    ctx.showGhost(ctx.slotFromPoint(moveEvent.clientX, moveEvent.clientY), lesson.duration);
    autoScroll(moveEvent.clientX, moveEvent.clientY);
  }

  function finish(upEvent) {
    cleanup();
    if (!active) {
      ctx.handlers.onOpen?.(lesson);
      return;
    }

    ctx.suppress();
    const target = ctx.slotFromPoint(upEvent.clientX, upEvent.clientY);
    if (!target) return;
    if (target.date === lesson.date && target.time === lesson.startTime) return;
    ctx.handlers.onMove?.(lesson, { date: target.date, time: target.time });
  }

  function cancel() {
    cleanup();
  }

  function cleanup() {
    cancelled = true;
    clearTimeout(holdTimer);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", cancel);
    releasePointer(node, event.pointerId);
    node.classList.remove("is-pressed", "is-dragging", "is-touch-armed");
    node.style.transform = "";
    ctx.root.classList.remove("is-dragging");
    ctx.clearGhost();
    stopAutoScroll();
  }

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", cancel);
}

/* ---------- Автопрокрутка при переносе ---------- */

let scrollTimer = null;
let scrollDirection = 0;

/**
 * Когда занятие тащат к краю видимой области, расписание прокручивается —
 * иначе на узком экране до соседнего дня просто не добраться.
 */
function autoScroll(x, y) {
  const container = document.querySelector(".week-scroll");
  if (!container) return;

  const rect = container.getBoundingClientRect();
  const zone = 60;
  let direction = 0;

  if (x < rect.left + zone) direction = -1;
  else if (x > rect.right - zone) direction = 1;

  if (direction === scrollDirection && scrollTimer) return;

  stopAutoScroll();
  scrollDirection = direction;
  if (!direction) return;

  scrollTimer = setInterval(() => {
    const node = document.querySelector(".week-scroll");
    if (!node) return stopAutoScroll();
    node.scrollLeft += direction * 12;
  }, 16);
}

function stopAutoScroll() {
  if (scrollTimer) clearInterval(scrollTimer);
  scrollTimer = null;
  scrollDirection = 0;
}

function startResize(event, node, lesson, ctx) {
  const startY = event.clientY;
  const startHeight = lesson.duration * PX_PER_MIN;
  let duration = lesson.duration;

  capturePointer(node, event.pointerId);
  node.classList.add("is-resizing");

  function onPointerMove(moveEvent) {
    const delta = moveEvent.clientY - startY;
    const rawMinutes = lesson.duration + (delta / PX_PER_MIN);
    duration = Math.max(15, Math.min(240, Math.round(rawMinutes / 15) * 15));
    node.style.height = `${duration * PX_PER_MIN}px`;
  }

  function finish() {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    releasePointer(node, event.pointerId);
    node.classList.remove("is-resizing");

    if (duration === lesson.duration) {
      node.style.height = `${startHeight}px`;
      return;
    }

    ctx.suppress();
    ctx.handlers.onMove?.(lesson, {
      date: lesson.date,
      time: lesson.startTime,
      duration,
    });
  }

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
}

// Захват указателя нужен, чтобы блок не терял события при выходе за свои границы.
// В синтетических событиях (тесты, автоматизация) идентификатор может быть невалидным.
function capturePointer(node, pointerId) {
  try {
    node.setPointerCapture(pointerId);
  } catch {
    /* указатель уже отпущен — глобальные обработчики справятся сами */
  }
}

function releasePointer(node, pointerId) {
  try {
    if (node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId);
  } catch {
    /* нечего отпускать */
  }
}

/* ---------- Сетка месяца ---------- */

export function renderMonth({
  anchor,
  firstDay = 1,
  lessons,
  students,
  handlers = {},
}) {
  const today = todayISO();
  const days = monthGrid(anchor, firstDay);
  const map = studentsMap(students);
  const monthPrefix = anchor.slice(0, 7);

  const root = el("div", { class: "month" });

  const head = el("div", { class: "month__head" });
  for (let index = 0; index < 7; index += 1) {
    const dayIndex = ((firstDay - 1 + index) % 7) + 1;
    head.append(el("div", { class: "month__head-cell", text: WEEKDAYS[dayIndex - 1].short }));
  }

  const body = el("div", { class: "month__body" });

  for (const date of days) {
    const dayLessons = lessons
      .filter((lesson) => lesson.date === date)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    const cell = el("div", {
      class: [
        "month__cell",
        date === today ? "is-today" : "",
        date.slice(0, 7) !== monthPrefix ? "is-outside" : "",
      ].filter(Boolean).join(" "),
      dataset: { date },
    });

    const number = el("button", {
      class: "month__date",
      type: "button",
      text: String(Number(date.slice(8))),
      title: "Открыть неделю с этого дня",
    });
    number.addEventListener("click", () => handlers.onDayClick?.(date));

    cell.append(number);

    const chips = el("div", { class: "month__chips" });
    const visible = dayLessons.slice(0, 3);

    for (const lesson of visible) {
      const student = map.get(lesson.studentId);
      const chip = el("button", {
        class: `month__chip ${subjectClass(student)}${lesson.status === "cancelled" ? " is-cancelled" : ""}`,
        type: "button",
        title: `${student?.name || "Ученик не найден"} · ${lesson.startTime}`,
      }, [
        el("span", { class: "month__chip-time", text: lesson.startTime }),
        el("span", { class: "month__chip-name", text: student?.name || "Без ученика" }),
      ]);
      chip.addEventListener("click", () => handlers.onOpen?.(lesson));
      chips.append(chip);
    }

    if (dayLessons.length > visible.length) {
      const more = el("button", {
        class: "month__more",
        type: "button",
        text: `+${dayLessons.length - visible.length} ещё`,
      });
      more.addEventListener("click", () => handlers.onDayClick?.(date));
      chips.append(more);
    }

    cell.append(chips);
    cell.addEventListener("dblclick", () => handlers.onCreate?.({ date, time: "16:00" }));

    body.append(cell);
  }

  root.append(head, body);
  return root;
}
