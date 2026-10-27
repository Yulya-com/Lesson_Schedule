// app.js — состояние приложения, экраны и пользовательские сценарии.
// Данные читаются и пишутся через db.js, календарь рисует calendar.js.

import * as db from "./db.js";
import {
  el, clear, field, input, select, checkbox, toast,
  openModal, confirmDialog, emptyState, badge, segmented,
} from "./ui.js";
import { renderWeek, renderMonth } from "./calendar.js";
import {
  WEEKDAYS, todayISO, addDays, addMonths, startOfWeek, startOfMonth, endOfMonth,
  weekdayIndex, weekDays, minutesToTime, formatDate, formatDateLong, formatWeekday,
  formatWeekRange, formatMonthTitle, formatMoney, formatHours, durationLabel,
  timeRangeLabel, buildOccurrences, describeRule, plural,
} from "./recurrence.js";

/* ---------- Состояние ---------- */

const state = {
  db: null,
  view: "schedule",
  mode: "week",
  anchor: todayISO(),
  students: [],
  lessons: [],
  series: [],
  notes: [],
  settings: structuredClone(db.DEFAULT_SETTINGS),
  filter: { query: "", status: "all", paid: "all", studentId: "all" },
  studentQuery: "",
  showArchived: false,
  noteQuery: "",
  summaryMonth: todayISO(),
};

const NAV_ITEMS = [
  { id: "schedule", label: "Расписание" },
  { id: "students", label: "Ученики" },
  { id: "notes", label: "Заметки" },
  { id: "summary", label: "Сводка" },
  { id: "settings", label: "Настройки" },
];

/* ---------- Запуск ---------- */

boot();

async function boot() {
  try {
    state.db = await db.openDatabase();
    state.settings = await db.getSettings(state.db);
    state.mode = state.settings.view.mode === "month" ? "month" : "week";
    await reload();
  } catch (error) {
    renderFatal(error);
    return;
  }

  document.getElementById("btn-new-lesson").addEventListener("click", () => {
    openLessonModal({ date: todayISO() });
  });

  bindShortcuts();
  render();
}

async function reload() {
  const [students, lessons, series, notes] = await Promise.all([
    db.getAllStudents(state.db),
    db.getAllLessons(state.db),
    db.getAllSeries(state.db),
    db.getAllNotes(state.db),
  ]);
  state.students = students;
  state.lessons = lessons;
  state.series = series;
  state.notes = notes;
}

async function refresh() {
  await reload();
  render();
}

function renderFatal(error) {
  const view = document.getElementById("view");
  clear(view);
  view.append(emptyState({
    title: "Не удалось открыть хранилище",
    text: error?.message || "Браузер не дал доступ к IndexedDB. Проверьте настройки приватности.",
  }));
}

/* ---------- Общие помощники ---------- */

function getStudent(id) {
  return state.students.find((student) => student.id === id) || null;
}

function activeStudents() {
  return state.students.filter((student) => !student.archived);
}

function computeStats(lessons) {
  let count = 0;
  let minutes = 0;
  let done = 0;
  let due = 0;
  let paid = 0;

  for (const lesson of lessons) {
    if (lesson.status === "cancelled") continue;
    count += 1;
    if (lesson.status !== "noShow") minutes += lesson.duration;
    if (lesson.status === "done") done += 1;
    if ((lesson.status === "planned" || lesson.status === "done") && !lesson.paid) due += lesson.price;
    if (lesson.paid) paid += lesson.price;
  }

  return { count, minutes, done, due, paid };
}

function studentColor(student) {
  return `subj-${student?.color || "indigo"}`;
}

function sortLessons(lessons) {
  return [...lessons].sort((a, b) =>
    `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`)
  );
}

function lessonsOfStudent(studentId) {
  return sortLessons(state.lessons.filter((lesson) => lesson.studentId === studentId));
}

/* ---------- Навигация и рендеринг ---------- */

function renderNav() {
  const nav = document.getElementById("nav");
  clear(nav);

  for (const item of NAV_ITEMS) {
    const active = state.view === item.id;
    nav.append(el("button", {
      class: `nav__item${active ? " is-active" : ""}`,
      type: "button",
      text: item.label,
      "aria-current": active ? "page" : null,
      onclick: () => {
        state.view = item.id;
        render();
      },
    }));
  }
}

function render() {
  const view = document.getElementById("view");
  const active = document.activeElement;
  const focusId = active && active.id ? active.id : null;

  clear(view);
  renderNav();

  if (state.view === "schedule") view.append(renderScheduleView());
  else if (state.view === "students") view.append(renderStudentsView());
  else if (state.view === "notes") view.append(renderNotesView());
  else if (state.view === "summary") view.append(renderSummaryView());
  else view.append(renderSettingsView());

  if (focusId) {
    const node = document.getElementById(focusId);
    if (node && typeof node.focus === "function") node.focus();
  }
}

/* ---------- Период ---------- */

function currentPeriod() {
  const firstDay = state.settings.view.firstDay || 1;

  if (state.mode === "week") {
    const start = startOfWeek(state.anchor, firstDay);
    const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
    return {
      from: days[0],
      to: days[6],
      days,
      title: formatWeekRange(days[0], days[6]),
      subtitle: "Все занятия недели — целиком. Перетащите занятие, чтобы перенести",
      lessons: state.lessons.filter((lesson) => days.includes(lesson.date)),
    };
  }

  const from = startOfMonth(state.anchor);
  const to = endOfMonth(state.anchor);
  const lessons = state.lessons.filter((lesson) => lesson.date >= from && lesson.date <= to);

  return {
    from,
    to,
    title: formatMonthTitle(state.anchor),
    subtitle: state.mode === "month"
      ? "Обзор загруженности. Перетащите занятие на другой день"
      : "Список занятий месяца",
    lessons,
  };
}

function shiftPeriod(direction) {
  state.anchor = state.mode === "week"
    ? addDays(state.anchor, 7 * direction)
    : addMonths(state.anchor, direction);
  render();
}

function goToday() {
  state.view = "schedule";
  state.anchor = todayISO();
  render();
}

/* ---------- Расписание ---------- */

function renderScheduleView() {
  const page = el("div", { class: "page" });
  const period = currentPeriod();

  const modes = segmented(
    [
      { value: "week", label: "Неделя" },
      { value: "month", label: "Месяц" },
      { value: "list", label: "Список" },
    ],
    state.mode,
    (value) => {
      state.mode = value;
      db.saveSettings(state.db, { view: { mode: value } }).catch(() => {});
      render();
    },
    "Вид расписания"
  );

  const nav = el("div", { class: "datenav" }, [
    el("button", {
      class: "icon-btn", type: "button", "aria-label": "Предыдущий период", text: "‹",
      onclick: () => shiftPeriod(-1),
    }),
    el("button", {
      class: "btn btn--ghost btn--sm", type: "button", text: "Сегодня",
      onclick: goToday,
    }),
    el("button", {
      class: "icon-btn", type: "button", "aria-label": "Следующий период", text: "›",
      onclick: () => shiftPeriod(1),
    }),
  ]);

  page.append(el("header", { class: "page__head" }, [
    el("div", { class: "page__heading" }, [
      el("h1", { class: "page__title", text: period.title }),
      el("p", { class: "page__sub", text: period.subtitle }),
    ]),
    el("div", { class: "page__tools" }, [modes, nav]),
  ]));

  if (!state.students.length) {
    page.append(emptyState({
      title: "Пока нет ни одного ученика",
      text: "Добавьте первого ученика — и в расписании появятся занятия. "
        + "Или загрузите демонстрационные данные, чтобы посмотреть, как всё устроено.",
      actions: [
        el("button", {
          class: "btn btn--primary", type: "button", text: "Добавить ученика",
          onclick: () => openStudentModal(),
        }),
        el("button", {
          class: "btn btn--ghost", type: "button", text: "Загрузить пример",
          onclick: loadDemo,
        }),
      ],
    }));
    return page;
  }

  page.append(statCards(period));

  if (state.mode === "week") {
    const host = el("div", { class: "calendar" });
    host.append(renderWeek({
      weekStart: period.from,
      firstDay: state.settings.view.firstDay || 1,
      workHours: state.settings.workHours,
      lessons: period.lessons,
      students: state.students,
      handlers: {
        onOpen: (lesson) => openLessonModal({ lesson }),
        onCreate: ({ date, time }) => openLessonModal({ date, time }),
        onMove: moveLesson,
        onDayClick: (date) => {
          state.anchor = date;
          render();
        },
      },
    }));

    if (!period.lessons.length) {
      host.append(el("p", { class: "hint", text: "На этой неделе занятий нет. Кликните по свободному слоту, чтобы поставить первое." }));
    }

    page.append(host);
    return page;
  }

  if (state.mode === "month") {
    page.append(el("p", {
      class: "hint",
      text: "Перетащите занятие на другой день. Время начала сохранится — изменить его можно в карточке занятия.",
    }));
    page.append(renderMonth({
      anchor: state.anchor,
      firstDay: state.settings.view.firstDay || 1,
      lessons: period.lessons,
      students: state.students,
      handlers: {
        onOpen: (lesson) => openLessonModal({ lesson }),
        onCreate: ({ date, time }) => openLessonModal({ date, time }),
        onMove: moveLesson,
        onDayClick: (date) => {
          state.mode = "week";
          state.anchor = date;
          render();
        },
      },
    }));
    return page;
  }

  page.append(renderLessonList(period));
  return page;
}

function statCards(period) {
  const stats = computeStats(period.lessons);
  const unpaidCount = period.lessons.filter(
    (lesson) => (lesson.status === "planned" || lesson.status === "done") && !lesson.paid
  ).length;

  return el("div", { class: "stats" }, [
    statCard("Занятий", String(stats.count), "без отменённых"),
    statCard("Часов", formatHours(stats.minutes), "суммарная длительность"),
    statCard("Проведено", String(stats.done), "отмечено как проведённое"),
    statCard(
      "К оплате",
      formatMoney(stats.due),
      unpaidCount ? `не оплачено занятий: ${unpaidCount}` : "всё оплачено",
      () => openDueList(period)
    ),
  ]);
}

function statCard(label, value, note, onClick) {
  const props = { class: `stat${onClick ? " stat--link" : ""}` };
  if (onClick) {
    props.type = "button";
    props.onclick = onClick;
  }
  const node = el(onClick ? "button" : "div", props, [
    el("span", { class: "stat__label", text: label }),
    el("strong", { class: "stat__value", text: value }),
    el("span", { class: "stat__note", text: note }),
  ]);
  return node;
}

function openDueList(period) {
  const unpaid = sortLessons(period.lessons.filter(
    (lesson) => (lesson.status === "planned" || lesson.status === "done") && !lesson.paid
  ));

  const body = unpaid.length
    ? el("div", { class: "due-list" }, unpaid.map((lesson) => {
        const student = getStudent(lesson.studentId);
        const payButton = el("button", {
          class: "btn btn--ghost btn--sm", type: "button", text: "Оплачено",
        });
        payButton.addEventListener("click", async () => {
          await db.saveLesson(state.db, { ...lesson, paid: true });
          await db.addActivity(state.db, {
            type: "payment",
            message: `Отмечена оплата: ${student?.name || "ученик"} ${formatDate(lesson.date)}`,
          });
          modal.close();
          await refresh();
          toast("Оплата отмечена", { type: "success" });
        });

        return el("div", { class: "due-row" }, [
          el("div", { class: "due-row__main" }, [
            el("strong", { text: student?.name || "Ученик не найден" }),
            el("span", { class: "due-row__meta", text: `${formatDate(lesson.date)} · ${timeRangeLabel(lesson.startTime, lesson.duration)}` }),
          ]),
          el("span", { class: "due-row__sum", text: formatMoney(lesson.price) }),
          payButton,
        ]);
      }))
    : el("p", { class: "modal__text", text: "Неоплаченных занятий за период нет." });

  const modal = openModal({
    title: "К оплате",
    subtitle: `Неоплаченные занятия: ${formatMoney(computeStats(unpaid).due)}`,
    size: "md",
    body,
  });

  return modal;
}

/* ---------- Список занятий ---------- */

function matchFilter(lesson) {
  const filter = state.filter;
  if (filter.status !== "all" && lesson.status !== filter.status) return false;
  if (filter.paid === "paid" && !lesson.paid) return false;
  if (filter.paid === "unpaid" && lesson.paid) return false;
  if (filter.studentId !== "all" && lesson.studentId !== filter.studentId) return false;

  const query = filter.query.trim().toLowerCase();
  if (query) {
    const student = getStudent(lesson.studentId);
    const haystack = `${student?.name || ""} ${student?.subject || ""} ${lesson.subject || ""}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  return true;
}

function renderLessonList(period) {
  const wrap = el("div", { class: "list" });

  const queryInput = input({
    type: "search",
    placeholder: "Поиск по ученику или предмету",
    value: state.filter.query,
    "aria-label": "Поиск занятий",
  });

  const statusSelect = select([
    { value: "all", label: "Все статусы" },
    ...db.STATUSES.map((value) => ({ value, label: db.STATUS_LABELS[value] })),
  ], { value: state.filter.status, "aria-label": "Статус занятия" });

  const paidSelect = select([
    { value: "all", label: "Любая оплата" },
    { value: "unpaid", label: "Не оплачено" },
    { value: "paid", label: "Оплачено" },
  ], { value: state.filter.paid, "aria-label": "Оплата" });

  const studentSelect = select([
    { value: "all", label: "Все ученики" },
    ...state.students.map((student) => ({ value: student.id, label: student.name })),
  ], { value: state.filter.studentId, "aria-label": "Ученик" });

  const results = el("div", { class: "list__results" });

  function paint() {
    clear(results);
    const items = sortLessons(period.lessons.filter(matchFilter));

    if (!items.length) {
      results.append(emptyState({
        title: "Занятий не найдено",
        text: "Измените фильтры или сбросьте поиск.",
        actions: [
          el("button", {
            class: "btn btn--ghost", type: "button", text: "Сбросить фильтры",
            onclick: () => {
              state.filter = { query: "", status: "all", paid: "all", studentId: "all" };
              render();
            },
          }),
        ],
      }));
      return;
    }

    const groups = new Map();
    for (const lesson of items) {
      if (!groups.has(lesson.date)) groups.set(lesson.date, []);
      groups.get(lesson.date).push(lesson);
    }

    for (const [date, dayLessons] of groups) {
      const isToday = date === todayISO();
      results.append(el("section", { class: `list__day${isToday ? " is-today" : ""}` }, [
        el("h3", { class: "list__date" }, [
          el("span", { text: `${formatWeekday(date, "full")}, ${formatDateLong(date)}` }),
          isToday ? badge("сегодня", "mint") : null,
        ]),
        ...dayLessons.map(lessonRow),
      ]));
    }
  }

  function apply() {
    state.filter.query = queryInput.value;
    state.filter.status = statusSelect.value;
    state.filter.paid = paidSelect.value;
    state.filter.studentId = studentSelect.value;
    paint();
  }

  queryInput.addEventListener("input", apply);
  statusSelect.addEventListener("change", apply);
  paidSelect.addEventListener("change", apply);
  studentSelect.addEventListener("change", apply);

  wrap.append(el("div", { class: "filters" }, [queryInput, statusSelect, paidSelect, studentSelect]));
  wrap.append(results);
  paint();

  return wrap;
}

function lessonRow(lesson) {
  const student = getStudent(lesson.studentId);

  const paidToggle = el("button", {
    class: `pill${lesson.paid ? " pill--on" : ""}`,
    type: "button",
    text: lesson.paid ? "Оплачено" : "Не оплачено",
    "aria-pressed": String(lesson.paid),
    title: "Переключить отметку об оплате",
  });

  paidToggle.addEventListener("click", async () => {
    await db.saveLesson(state.db, { ...lesson, paid: !lesson.paid });
    await refresh();
  });

  const openButton = el("button", {
    class: "btn btn--ghost btn--sm",
    type: "button",
    text: "Открыть",
  });
  openButton.addEventListener("click", () => openLessonModal({ lesson }));

  return el("article", { class: `row ${studentColor(student)}` }, [
    el("div", { class: "row__time", text: lesson.startTime }),
    el("div", { class: "row__main" }, [
      el("strong", { class: "row__name", text: student?.name || "Ученик не найден" }),
      el("span", { class: "row__meta", text: `${lesson.subject || student?.subject || ""} · ${durationLabel(lesson.duration)}` }),
    ]),
    el("div", { class: "row__tags" }, [
      badge(db.STATUS_LABELS[lesson.status], db.STATUS_TONES[lesson.status]),
      lesson.seriesId ? badge("серия", "neutral") : null,
    ]),
    el("div", { class: "row__price", text: formatMoney(lesson.price) }),
    paidToggle,
    openButton,
  ]);
}

/* ---------- Занятие: форма ---------- */

function openLessonModal({ lesson = null, date = null, time = null } = {}) {
  const isNew = !lesson;
  const series = lesson?.seriesId ? state.series.find((item) => item.id === lesson.seriesId) : null;
  const editingSeries = Boolean(series && lesson && !lesson.detached);
  const note = lesson ? state.notes.find((item) => item.lessonId === lesson.id) : null;

  const initial = isNew
    ? {
        studentId: "",
        subject: "",
        date: date || state.anchor,
        startTime: time || "18:00",
        duration: state.settings.defaults.duration,
        status: "planned",
        price: 0,
        paid: false,
      }
    : { ...lesson };

  const formId = `lesson-form-${Math.random().toString(36).slice(2, 8)}`;
  let priceTouched = !isNew && initial.price > 0;
  let status = initial.status;
  let scope = "one";

  /* Ученик */
  const studentOptions = [{ value: "", label: "— выберите ученика —" }];
  for (const student of activeStudents()) {
    studentOptions.push({ value: student.id, label: `${student.name} · ${student.subject}` });
  }
  if (initial.studentId && !activeStudents().some((student) => student.id === initial.studentId)) {
    const archived = state.students.find((student) => student.id === initial.studentId);
    if (archived) {
      studentOptions.push({ value: archived.id, label: `${archived.name} · ${archived.subject} (в архиве)` });
    }
  }

  const studentSelect = select(studentOptions, { name: "studentId", required: true });
  studentSelect.value = initial.studentId || "";

  const studentField = field({
    label: "Ученик",
    control: studentSelect,
    required: true,
    hint: "Без ученика занятие создать нельзя",
  });

  /* Предмет */
  const subjectListId = `subjects-${Math.random().toString(36).slice(2, 8)}`;
  const subjectInput = input({
    type: "text",
    name: "subject",
    list: subjectListId,
    placeholder: "Например, Математика",
    value: initial.subject || "",
  });
  const subjectDatalist = el("datalist", { id: subjectListId });
  const subjectOptions = [...new Set([
    ...db.DEMO_SUBJECTS,
    ...state.students.map((student) => student.subject).filter(Boolean),
  ])].sort((a, b) => a.localeCompare(b, "ru"));
  subjectOptions.forEach((value) => subjectDatalist.append(el("option", { value })));

  const subjectField = field({
    label: "Предмет",
    control: subjectInput,
  });

  /* Дата и время */
  const dateInput = input({ type: "date", name: "date", required: true, value: initial.date || "" });
  const dateField = field({ label: "Дата", control: dateInput, required: true });

  const timeInput = input({ type: "time", name: "startTime", step: "900", required: true, value: initial.startTime || "" });
  const timeField = field({ label: "Начало", control: timeInput, required: true });

  const durationSelect = select(
    [15, 30, 45, 60, 75, 90, 120, 150, 180, 240].map((value) => ({
      value: String(value),
      label: durationLabel(value),
    })),
    { name: "duration", value: String(initial.duration || 60) }
  );
  const durationField = field({ label: "Длительность", control: durationSelect });

  const scheduleRow = el("div", { class: "form__row form__row--3" }, [dateField, timeField, durationField]);

  /* Статус */
  const statusRow = el("div", { class: "chips", role: "group", "aria-label": "Статус занятия" });
  const statusButtons = db.STATUSES.map((value) => {
    const button = el("button", {
      class: `chip${status === value ? " is-active" : ""}`,
      type: "button",
      text: db.STATUS_LABELS[value],
      "aria-pressed": String(status === value),
    });
    button.dataset.value = value;
    button.addEventListener("click", () => {
      status = value;
      statusButtons.forEach((node) => {
        const active = node.dataset.value === value;
        node.classList.toggle("is-active", active);
        node.setAttribute("aria-pressed", String(active));
      });
    });
    return button;
  });
  statusRow.append(...statusButtons);

  const statusField = field({ label: "Статус", control: statusRow });

  /* Стоимость и оплата */
  const priceInput = input({
    type: "number", name: "price", min: "0", step: "10",
    value: String(initial.price || 0), inputmode: "numeric",
  });
  priceInput.addEventListener("input", () => { priceTouched = true; });

  const priceField = field({
    label: "Стоимость, ₽",
    control: priceInput,
    hint: "Считается от ставки ученика, можно изменить",
  });

  const paidToggle = checkbox({ label: "Оплачено", checked: Boolean(initial.paid) });
  const paidField = el("div", { class: "field field--switch" }, [
    el("span", { class: "field__label", text: "Оплата" }),
    paidToggle,
  ]);

  const moneyRow = el("div", { class: "form__row" }, [priceField, paidField]);

  /* Заметка */
  const noteInput = el("textarea", {
    class: "input input--area",
    name: "note",
    rows: "4",
    placeholder: "Что прошли, что задать, на что обратить внимание",
  });
  noteInput.value = note?.text || "";

  const noteField = field({ label: "Заметка к занятию", control: noteInput });

  /* Повтор для нового занятия */
  const repeatToggle = el("input", { type: "checkbox", id: `repeat-${formId}` });
  const repeatSwitch = el("label", { class: "switch", for: `repeat-${formId}` }, [
    repeatToggle,
    el("span", { class: "switch__track", "aria-hidden": "true" }),
    el("span", { class: "switch__label", text: "Повторять занятие" }),
  ]);

  const weekdayChips = WEEKDAYS.map((day) => {
    const button = el("button", {
      class: "chip", type: "button", text: day.short, "aria-pressed": "false",
      title: day.full,
    });
    button.dataset.value = String(day.index);
    button.addEventListener("click", () => {
      const active = button.classList.toggle("is-active");
      button.setAttribute("aria-pressed", String(active));
      updateRepeatPreview();
    });
    return button;
  });

  const defaultWeekday = weekdayIndex(initial.date || todayISO());
  weekdayChips[defaultWeekday - 1].classList.add("is-active");
  weekdayChips[defaultWeekday - 1].setAttribute("aria-pressed", "true");

  const intervalSelect = select([
    { value: "1", label: "Каждую неделю" },
    { value: "2", label: "Через неделю" },
    { value: "3", label: "Каждые 3 недели" },
    { value: "4", label: "Каждые 4 недели" },
  ], { value: "1" });

  const endDateInput = input({
    type: "date",
    value: addDays(initial.date || todayISO(), 90),
  });

  const repeatPreview = el("p", { class: "repeat__preview", "aria-live": "polite" });

  const repeatPanel = el("div", { class: "repeat is-hidden" }, [
    el("div", { class: "field" }, [
      el("span", { class: "field__label", text: "Дни недели" }),
      el("div", { class: "chips" }, weekdayChips),
    ]),
    el("div", { class: "form__row" }, [
      field({ label: "Периодичность", control: intervalSelect }),
      field({ label: "Повторять до", control: endDateInput }),
    ]),
    repeatPreview,
  ]);

  const repeatField = field({ label: "Повтор", control: repeatSwitch });

  /* Применение к серии */
  const scopeRow = el("div", { class: "chips", role: "group", "aria-label": "К чему применить изменения" });
  if (editingSeries) {
    const scopeButtons = [
      { value: "one", label: "Только это занятие" },
      { value: "series", label: "Всё будущее серии" },
    ].map((item) => {
      const button = el("button", {
        class: `chip${scope === item.value ? " is-active" : ""}`,
        type: "button",
        text: item.label,
        "aria-pressed": String(scope === item.value),
      });
      button.dataset.value = item.value;
      button.addEventListener("click", () => {
        scope = item.value;
        scopeButtons.forEach((node) => {
          const active = node.dataset.value === scope;
          node.classList.toggle("is-active", active);
          node.setAttribute("aria-pressed", String(active));
        });
        scopeField.setError("");
      });
      return button;
    });
    scopeRow.append(...scopeButtons);
  }

  const scopeField = field({
    label: "Изменения",
    control: editingSeries
      ? scopeRow
      : el("p", { class: "field__static", text: "Изменения применяются к одному занятию." }),
  });

  const seriesBanner = editingSeries
    ? el("div", { class: "series-note" }, [
        el("strong", { text: "Занятие из серии" }),
        el("span", { text: describeRule(series) }),
        el("span", { class: "series-note__meta", text: `до ${formatDate(series.endDate)}` }),
      ])
    : null;

  /* Перенос занятия.
     Поля даты и времени здесь те же, что и в блоке «Дата и время»:
     второй набор полей только запутывал, и «Сохранить» не переносил занятие. */
  let moveSection = null;

  if (!isNew) {
    const quickShift = (days) => {
      const base = dateInput.value || lesson.date;
      dateInput.value = addDays(base, days);
      dateField.setError("");
      dateInput.dispatchEvent(new Event("input", { bubbles: true }));
    };

    const quickRow = el("div", { class: "move-box__quick" }, [
      el("button", { class: "chip", type: "button", text: "−1 день", onclick: () => quickShift(-1) }),
      el("button", { class: "chip", type: "button", text: "+1 день", onclick: () => quickShift(1) }),
      el("button", { class: "chip", type: "button", text: "+7 дней", onclick: () => quickShift(7) }),
      el("button", {
        class: "chip",
        type: "button",
        text: "Сегодня",
        onclick: () => {
          dateInput.value = todayISO();
          dateField.setError("");
          dateInput.dispatchEvent(new Event("input", { bubbles: true }));
        },
      }),
    ]);

    const moveButton = el("button", {
      class: "btn btn--primary",
      type: "button",
      text: "Перенести",
    });

    const moveHint = el("span", { class: "move-box__note" });

    const updateMoveHint = () => {
      const changed = dateInput.value !== lesson.date || timeInput.value !== lesson.startTime;
      moveHint.textContent = changed
        ? `Занятие переедет на ${formatDate(dateInput.value)}, ${timeInput.value}`
        : "Измените дату или время выше — тогда занятие переедет";
    };

    ["input", "change"].forEach((eventName) => {
      dateInput.addEventListener(eventName, updateMoveHint);
      timeInput.addEventListener(eventName, updateMoveHint);
    });

    // Кнопка «Перенести» делает то же, что «Сохранить»: применяет дату и время
    // из полей выше. Один путь — одно поведение.
    moveButton.addEventListener("click", () => {
      dateField.setError("");
      timeField.setError("");

      if (!dateInput.value) {
        dateField.setError("Укажите дату занятия.");
        dateInput.focus();
        return;
      }
      if (!timeInput.value) {
        timeField.setError("Укажите время начала.");
        timeInput.focus();
        return;
      }
      if (dateInput.value === lesson.date && timeInput.value === lesson.startTime) {
        dateField.setError("Это те же дата и время — измените дату или время, чтобы перенести.");
        dateInput.focus();
        return;
      }
      form.requestSubmit();
    });

    moveSection = el("section", { class: "move-box" }, [
      el("div", { class: "move-box__head" }, [
        el("strong", { text: "Перенести занятие" }),
        el("span", {
          class: "move-box__hint",
          text: `Сейчас: ${formatDate(lesson.date)}, ${lesson.startTime}`,
        }),
      ]),
      quickRow,
      el("div", { class: "move-box__actions" }, [moveButton, moveHint]),
    ]);

    updateMoveHint();
  }

  /* Сборка формы */
  const form = el("form", { class: "form", id: formId, novalidate: true }, [
    studentField,
    subjectField,
    subjectDatalist,
    scheduleRow,
    statusField,
    moneyRow,
    noteField,
    seriesBanner,
    moveSection,
    editingSeries ? scopeField : null,
    isNew ? repeatField : null,
    isNew ? repeatPanel : null,
  ]);

  const saveButton = el("button", {
    class: "btn btn--primary",
    type: "submit",
    form: formId,
    text: isNew ? "Создать занятие" : "Сохранить",
  });

  const hint = el("span", { class: "modal__hint" });

  const footer = [];
  if (!isNew) {
    const deleteButton = el("button", {
      class: "btn btn--ghost btn--danger-text", type: "button", text: "Удалить",
    });
    deleteButton.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Удалить занятие?",
        message: `Занятие ${formatDate(lesson.date)} в ${lesson.startTime} будет удалено. Вернуть его можно будет сразу после удаления.`,
        confirmLabel: "Удалить",
        danger: true,
      });
      if (!ok) return;
      modal.close();
      await removeLesson(lesson);
    });
    footer.push(deleteButton);
  }

  footer.push(el("div", { class: "modal__spacer" }), hint);
  footer.push(el("button", {
    class: "btn btn--ghost", type: "button", text: "Отмена",
    onclick: () => modal.close(),
  }));
  footer.push(saveButton);

  const modal = openModal({
    title: isNew ? "Новое занятие" : "Занятие",
    subtitle: isNew ? "Выберите ученика, дату и время" : `${formatDate(initial.date)} · ${initial.startTime}`,
    size: "lg",
    body: [form],
    footer,
  });

  /* Поведение */

  function recalcPrice(force = false) {
    if (!force && priceTouched) return;
    const student = getStudent(studentSelect.value);
    const rate = student ? Number(student.rate) || 0 : Number(state.settings.defaults.rate) || 0;
    const minutes = Number(durationSelect.value) || 60;
    priceInput.value = String(Math.round((rate * minutes) / 60 / 10) * 10);
  }

  function updateSaveState() {
    const ready = Boolean(studentSelect.value && dateInput.value && timeInput.value);
    saveButton.disabled = !ready;
    saveButton.title = ready ? "" : "Заполните ученика, дату и время";
    hint.textContent = ready ? "" : "Ученик, дата и время обязательны";
  }

  function repeatRule() {
    return {
      startDate: dateInput.value,
      endDate: endDateInput.value,
      weekdays: weekdayChips
        .filter((chip) => chip.classList.contains("is-active"))
        .map((chip) => Number(chip.dataset.value)),
      intervalWeeks: Number(intervalSelect.value),
    };
  }

  function updateRepeatPreview() {
    if (!repeatToggle.checked) return;
    const rule = repeatRule();
    if (!rule.startDate || !rule.endDate) {
      repeatPreview.textContent = "Укажите даты, чтобы увидеть количество занятий.";
      return;
    }
    if (rule.endDate < rule.startDate) {
      repeatPreview.textContent = "Дата окончания должна быть позже даты начала.";
      return;
    }
    if (!rule.weekdays.length) {
      repeatPreview.textContent = "Выберите хотя бы один день недели.";
      return;
    }
    const { dates, total, truncated } = buildOccurrences(rule);
    if (!dates.length) {
      repeatPreview.textContent = "По этому правилу занятий не будет.";
      return;
    }
    repeatPreview.textContent = truncated
      ? `Правило даёт ${total} занятий, будет создано ${dates.length}.`
      : `Будет создано занятий: ${dates.length}.`;
  }

  studentSelect.addEventListener("change", () => {
    const student = getStudent(studentSelect.value);
    if (student && !subjectInput.value.trim()) subjectInput.value = student.subject;
    recalcPrice();
    updateSaveState();
  });

  durationSelect.addEventListener("change", () => recalcPrice());
  dateInput.addEventListener("change", updateRepeatPreview);
  endDateInput.addEventListener("change", updateRepeatPreview);
  intervalSelect.addEventListener("change", updateRepeatPreview);
  timeInput.addEventListener("input", updateSaveState);
  dateInput.addEventListener("input", updateSaveState);

  repeatToggle.addEventListener("change", () => {
    repeatPanel.classList.toggle("is-hidden", !repeatToggle.checked);
    if (repeatToggle.checked) updateRepeatPreview();
  });

  recalcPrice(isNew);
  updateSaveState();

  /* Отправка */

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    [studentField, dateField, timeField, durationField].forEach((node) => node.setError(""));

    if (!studentSelect.value) {
      studentField.setError("Выберите ученика — без него занятие создать нельзя.");
      studentSelect.focus();
      return;
    }
    if (!dateInput.value) {
      dateField.setError("Укажите дату занятия.");
      dateInput.focus();
      return;
    }
    if (!timeInput.value) {
      timeField.setError("Укажите время начала.");
      timeInput.focus();
      return;
    }

    const duration = Number(durationSelect.value);
    const payload = {
      ...(isNew ? {} : initial),
      studentId: studentSelect.value,
      subject: subjectInput.value.trim(),
      date: dateInput.value,
      startTime: timeInput.value,
      duration,
      status,
      price: Number(priceInput.value) || 0,
      paid: paidToggle.inputNode.checked,
    };

    // Для новой серии сначала проверяем само правило: пользователю важнее
    // узнать про лимит 400 занятий до вопроса о наложении.
    let seriesPlan = null;
    if (isNew && repeatToggle.checked) {
      const rule = repeatRule();
      repeatPreview.textContent = "";

      if (!rule.weekdays.length) {
        repeatPreview.textContent = "Выберите хотя бы один день недели.";
        return;
      }
      if (!rule.endDate || rule.endDate < rule.startDate) {
        repeatPreview.textContent = "Дата окончания должна быть позже даты начала.";
        return;
      }

      const built = buildOccurrences(rule);
      if (!built.dates.length) {
        repeatPreview.textContent = "По этому правилу занятий не будет.";
        return;
      }
      if (built.truncated) {
        const ok = await confirmDialog({
          title: "Серия слишком длинная",
          message: `Правило создаст ${built.total} ${plural(built.total, ["занятие", "занятия", "занятий"])}, а за один раз можно создать не больше ${built.dates.length}. Создать первые ${built.dates.length}?`,
          confirmLabel: "Создать",
        });
        if (!ok) return;
      }

      seriesPlan = { rule, dates: built.dates };
    }

    const conflicts = db.findConflicts(state.lessons, payload, { ignoreId: lesson?.id || null });
    const sameStudent = conflicts.filter((item) => item.studentId === payload.studentId);
    if (sameStudent.length) {
      const other = sameStudent[0];
      durationField.setError(
        `У ученика уже есть занятие ${other.startTime}–${minutesToTime(
          Number(other.startTime.slice(0, 2)) * 60 + Number(other.startTime.slice(3)) + other.duration
        )}. Выберите другое время.`
      );
      timeInput.focus();
      return;
    }
    if (conflicts.length) {
      const other = conflicts[0];
      const otherStudent = getStudent(other.studentId);
      const ok = await confirmDialog({
        title: "Наложение занятий",
        message: `В это время уже стоит занятие другого ученика: ${otherStudent?.name || "без имени"}, ${other.startTime}. Всё равно сохранить?`,
        confirmLabel: "Сохранить",
      });
      if (!ok) return;
    }

    try {
      if (seriesPlan) {
        const { rule, dates } = seriesPlan;

        const result = await db.createSeries(
          state.db,
          {
            studentId: payload.studentId,
            subject: payload.subject,
            weekdays: rule.weekdays,
            intervalWeeks: rule.intervalWeeks,
            startTime: payload.startTime,
            duration: payload.duration,
            startDate: payload.date,
            endDate: rule.endDate,
          },
          dates.map((date) => ({
            studentId: payload.studentId,
            subject: payload.subject,
            date,
            startTime: payload.startTime,
            duration: payload.duration,
            status: payload.status,
            price: payload.price,
            paid: payload.paid,
          }))
        );

        if (noteInput.value.trim()) {
          await db.saveNoteForLesson(state.db, {
            lessonId: result.lessons[0].id,
            studentId: payload.studentId,
            text: noteInput.value,
          });
        }

        await db.addActivity(state.db, {
          type: "series",
          message: `Создана серия из ${result.lessons.length} ${plural(result.lessons.length, ["занятия", "занятий", "занятий"])}`,
        });

        modal.close();
        await refresh();
        toast(`Создано ${result.lessons.length} ${plural(result.lessons.length, ["занятие", "занятия", "занятий"])}`, { type: "success" });
        return;
      }

      if (editingSeries && scope === "series") {
        const saved = await applySeriesUpdate(series, lesson, payload);
        modal.close();
        await refresh();
        toast(
          `Серия обновлена: создано ${saved.created} ${plural(saved.created, ["занятие", "занятия", "занятий"])}, `
            + `убрано ${saved.removed}`,
          { type: "success" }
        );
        return;
      }

      if (!isNew && lesson.seriesId) {
        const changedSchedule = payload.date !== lesson.date
          || payload.startTime !== lesson.startTime
          || payload.duration !== lesson.duration;
        if (changedSchedule) {
          payload.detached = true;
          await db.addSeriesException(state.db, lesson.seriesId, lesson.occurrenceDate || lesson.date);
        }
      }

      const beforeSchedule = isNew
        ? null
        : { date: lesson.date, startTime: lesson.startTime, duration: lesson.duration };

      const saved = await db.saveLesson(state.db, payload);

      if (noteInput.value.trim() || note) {
        await db.saveNoteForLesson(state.db, {
          lessonId: saved.id,
          studentId: saved.studentId,
          text: noteInput.value,
        });
      }

      const movedInCard = beforeSchedule && (
        beforeSchedule.date !== saved.date
        || beforeSchedule.startTime !== saved.startTime
        || beforeSchedule.duration !== saved.duration
      );

      await db.addActivity(state.db, {
        type: isNew ? "create" : movedInCard ? "move" : "update",
        message: `${isNew ? "Создано" : "Изменено"} занятие ${formatDate(saved.date)} ${saved.startTime}`,
      });

      modal.close();

      // Если дата или время изменились, расписание должно показать новое место.
      if (movedInCard && state.view === "schedule") {
        const firstDay = state.settings.view.firstDay || 1;
        if (state.mode === "week") {
          if (!weekDays(state.anchor, firstDay).includes(saved.date)) state.anchor = saved.date;
        } else if (saved.date.slice(0, 7) !== state.anchor.slice(0, 7)) {
          state.anchor = saved.date;
        }
      }

      await refresh();

      if (movedInCard) {
        const movedTime = beforeSchedule.date === saved.date
          && beforeSchedule.startTime === saved.startTime
          && beforeSchedule.duration !== saved.duration;
        toast(
          movedTime
            ? `Длительность: ${durationLabel(saved.duration)}`
            : `Перенесено на ${formatDate(saved.date)}, ${saved.startTime}`,
          {
            type: "success",
            actionLabel: "Вернуть на прежнее место",
            timeout: 8000,
            onAction: async () => {
              await db.saveLesson(state.db, {
                ...saved,
                date: beforeSchedule.date,
                startTime: beforeSchedule.startTime,
                duration: beforeSchedule.duration,
              });
              if (lesson.seriesId) {
                const exceptions = (state.series.find((item) => item.id === lesson.seriesId)?.exceptions || [])
                  .filter((date) => date !== (lesson.occurrenceDate || lesson.date));
                await db.setSeriesExceptions(state.db, lesson.seriesId, exceptions);
              }
              await refresh();
              toast("Занятие вернулось на прежнее место", { type: "info" });
            },
          }
        );
      } else {
        toast(isNew ? "Занятие создано" : "Изменения сохранены", { type: "success" });
      }
    } catch (error) {
      if (error instanceof db.ValidationError && error.field === "studentId") {
        studentField.setError(error.message);
        studentSelect.focus();
        return;
      }
      if (error instanceof db.ValidationError && error.field) {
        const map = { date: dateField, startTime: timeField, duration: durationField };
        (map[error.field] || studentField).setError(error.message);
        return;
      }
      console.error(error);
      toast(error?.message || "Не удалось сохранить занятие", { type: "error" });
    }
  });
}

/* ---------- Занятие: перенос, удаление, серия ---------- */

/**
 * Проверяет и выполняет перенос занятия.
 * Возвращает { ok: true, info } либо { ok: false, reason, other }.
 * Общий путь для перетаскивания мышью и для кнопки в карточке занятия.
 */
async function performMove(lesson, target, { silent = false } = {}) {
  const nextDate = target.date;
  const nextTime = target.time;
  const nextDuration = target.duration || lesson.duration;

  if (nextDate === lesson.date && nextTime === lesson.startTime && nextDuration === lesson.duration) {
    return { ok: false, reason: "unchanged" };
  }

  const candidate = { ...lesson, date: nextDate, startTime: nextTime, duration: nextDuration };
  const conflicts = db.findConflicts(state.lessons, candidate, { ignoreId: lesson.id });
  const sameStudent = conflicts.filter((item) => item.studentId === lesson.studentId);

  if (sameStudent.length) {
    if (!silent) {
      toast(`У ученика уже есть занятие в это время (${sameStudent[0].startTime}). Перенос не выполнен.`, { type: "error" });
    }
    return { ok: false, reason: "same-student", other: sameStudent[0] };
  }

  if (conflicts.length) {
    const other = conflicts[0];
    const otherStudent = getStudent(other.studentId);
    const ok = await confirmDialog({
      title: "Наложение занятий",
      message: `В это время стоит занятие другого ученика: ${otherStudent?.name || "без имени"}, ${other.startTime}. Всё равно перенести?`,
      confirmLabel: "Перенести",
    });
    if (!ok) return { ok: false, reason: "declined", other };
  }

  const before = {
    date: lesson.date,
    startTime: lesson.startTime,
    duration: lesson.duration,
    detached: lesson.detached,
  };
  const exceptionsBefore = lesson.seriesId
    ? [...(state.series.find((item) => item.id === lesson.seriesId)?.exceptions || [])]
    : null;

  const updated = { ...lesson, date: nextDate, startTime: nextTime, duration: nextDuration };

  if (lesson.seriesId) {
    updated.detached = true;
    await db.addSeriesException(state.db, lesson.seriesId, lesson.occurrenceDate || lesson.date);
  }

  await db.saveLesson(state.db, updated);
  await db.addActivity(state.db, {
    type: "move",
    message: `Занятие перенесено на ${formatDate(nextDate)} ${nextTime}`,
  });

  // Если занятие уехало за пределы видимого периода, показываем его новое место,
  // иначе пользователь не увидит результат переноса.
  if (state.view === "schedule") {
    const firstDay = state.settings.view.firstDay || 1;
    if (state.mode === "week") {
      if (!weekDays(state.anchor, firstDay).includes(nextDate)) state.anchor = nextDate;
    } else if (state.mode === "month" && nextDate.slice(0, 7) !== state.anchor.slice(0, 7)) {
      state.anchor = nextDate;
    } else if (state.mode === "list" && nextDate.slice(0, 7) !== state.anchor.slice(0, 7)) {
      state.anchor = nextDate;
    }
  }

  await refresh();

  const info = {
    lesson,
    updated,
    before,
    exceptionsBefore,
    nextDate,
    nextTime,
    nextDuration,
  };

  return { ok: true, info };
}

/** Уведомление о переносе с возможностью вернуть занятие на прежнее место. */
function notifyMove(info) {
  const { lesson, updated, before, exceptionsBefore, nextDate, nextTime, nextDuration } = info;

  const whatChanged = nextDuration !== before.duration && nextDate === before.date && nextTime === before.startTime
    ? `Длительность: ${durationLabel(nextDuration)}`
    : `Перенесено на ${formatDate(nextDate)}, ${nextTime}`;

  toast(whatChanged, {
    type: "success",
    actionLabel: "Вернуть на прежнее место",
    timeout: 8000,
    onAction: async () => {
      await db.saveLesson(state.db, { ...updated, ...before });
      if (lesson.seriesId && exceptionsBefore) {
        await db.setSeriesExceptions(state.db, lesson.seriesId, exceptionsBefore);
      }
      await refresh();
      toast("Занятие вернулось на прежнее место", { type: "info" });
    },
  });
}

async function moveLesson(lesson, target) {
  const result = await performMove(lesson, target);
  if (result.ok) notifyMove(result.info);
}

async function removeLesson(lesson) {
  const exceptionsBefore = lesson.seriesId
    ? [...(state.series.find((item) => item.id === lesson.seriesId)?.exceptions || [])]
    : null;

  if (lesson.seriesId) {
    await db.addSeriesException(state.db, lesson.seriesId, lesson.occurrenceDate || lesson.date);
  }

  await db.deleteLesson(state.db, lesson.id);
  await db.addActivity(state.db, {
    type: "delete",
    message: `Удалено занятие ${formatDate(lesson.date)} ${lesson.startTime}`,
  });
  await refresh();

  toast(`Занятие ${formatDate(lesson.date)} удалено`, {
    type: "success",
    actionLabel: "Вернуть занятие",
    timeout: 8000,
    onAction: async () => {
      await db.saveLesson(state.db, lesson);
      if (lesson.seriesId && exceptionsBefore) {
        await db.setSeriesExceptions(state.db, lesson.seriesId, exceptionsBefore);
      }
      await refresh();
      toast("Занятие восстановлено", { type: "info" });
    },
  });
}

async function applySeriesUpdate(series, lesson, values) {
  const fromDate = values.date || lesson.date;
  const rule = {
    startDate: fromDate,
    endDate: values.endDate || series.endDate,
    weekdays: series.weekdays,
    intervalWeeks: series.intervalWeeks,
  };

  const { dates } = buildOccurrences(rule);
  const exceptions = new Set(series.exceptions || []);

  const existing = state.lessons.filter(
    (item) => item.seriesId === series.id && item.date >= fromDate
  );
  const keep = existing.filter(
    (item) => item.detached || item.status !== "planned" || item.date < todayISO()
  );
  const keepIds = new Set(keep.map((item) => item.id));
  const keepDates = new Set(keep.map((item) => item.occurrenceDate || item.date));
  const removeIds = existing.filter((item) => !keepIds.has(item.id)).map((item) => item.id);

  const created = dates
    .filter((date) => !keepDates.has(date) && !exceptions.has(date))
    .map((date) => ({
      studentId: values.studentId,
      subject: values.subject,
      date,
      startTime: values.startTime,
      duration: values.duration,
      status: "planned",
      price: values.price,
      paid: false,
    }));

  await db.updateSeries(state.db, {
    ...series,
    studentId: values.studentId,
    subject: values.subject,
    startTime: values.startTime,
    duration: values.duration,
    endDate: values.endDate || series.endDate,
  });

  await db.replaceSeriesLessons(state.db, series.id, removeIds, created);
  await db.addActivity(state.db, {
    type: "series",
    message: `Серия обновлена: создано ${created.length}, убрано ${removeIds.length}`,
  });

  return { created: created.length, removed: removeIds.length };
}

/* ---------- Ученики ---------- */

function renderStudentsView() {
  const page = el("div", { class: "page" });

  const search = input({
    type: "search",
    id: "student-search",
    placeholder: "Фамилия, имя или предмет",
    value: state.studentQuery,
    "aria-label": "Поиск учеников",
  });

  const archivedToggle = checkbox({
    label: "Показывать архив",
    checked: state.showArchived,
    onChange: (event) => {
      state.showArchived = event.target.checked;
      render();
    },
  });

  page.append(el("header", { class: "page__head" }, [
    el("div", { class: "page__heading" }, [
      el("h1", { class: "page__title", text: "Ученики" }),
      el("p", { class: "page__sub", text: "Фамилия и имя, предмет, контакт и ставка за 60 минут" }),
    ]),
    el("div", { class: "page__tools" }, [
      el("button", {
        class: "btn btn--primary", type: "button", text: "Добавить ученика",
        onclick: () => openStudentModal(),
      }),
    ]),
  ]));

  page.append(el("div", { class: "filters" }, [search, archivedToggle]));

  const grid = el("div", { class: "students" });

  function paint() {
    clear(grid);
    const query = state.studentQuery.trim().toLowerCase();

    const list = state.students.filter((student) => {
      if (!state.showArchived && student.archived) return false;
      if (!query) return true;
      return `${student.name} ${student.subject} ${student.contact}`.toLowerCase().includes(query);
    });

    if (!list.length) {
      grid.append(emptyState({
        title: state.students.length ? "Никого не найдено" : "Пока нет учеников",
        text: state.students.length
          ? "Измените запрос или включите показ архива."
          : "Добавьте первого ученика — имя, фамилия, предмет и ставка понадобятся для расписания.",
        actions: state.students.length ? [] : [
          el("button", {
            class: "btn btn--primary", type: "button", text: "Добавить ученика",
            onclick: () => openStudentModal(),
          }),
        ],
      }));
      return;
    }

    list.forEach((student) => grid.append(studentCard(student)));
  }

  search.addEventListener("input", () => {
    state.studentQuery = search.value;
    paint();
  });

  page.append(grid);
  paint();
  return page;
}

function studentCard(student) {
  const lessons = lessonsOfStudent(student.id);
  const stats = computeStats(lessons);
  const upcoming = lessons.find(
    (lesson) => lesson.date >= todayISO() && lesson.status === "planned"
  );

  const card = el("article", { class: `student-card${student.archived ? " is-archived" : ""}` });

  const head = el("div", { class: "student-card__head" }, [
    el("span", { class: `student-card__dot ${studentColor(student)}`, "aria-hidden": "true" }),
    el("div", { class: "student-card__name" }, [
      el("strong", { text: student.name }),
      el("span", { class: "student-card__subject", text: student.subject }),
    ]),
    student.archived ? badge("архив", "neutral") : null,
  ]);

  const body = el("dl", { class: "student-card__facts" }, [
    el("div", {}, [el("dt", { text: "Контакт" }), el("dd", { text: student.contact || "—" })]),
    el("div", {}, [el("dt", { text: "Ставка" }), el("dd", { text: `${formatMoney(student.rate)} / 60 мин` })]),
    el("div", {}, [el("dt", { text: "Занятий" }), el("dd", { text: `${stats.count} · ${formatHours(stats.minutes)} ч` })]),
    el("div", {}, [el("dt", { text: "Долг" }), el("dd", { class: stats.due ? "is-due" : "", text: formatMoney(stats.due) })]),
  ]);

  const footer = el("div", { class: "student-card__foot" }, [
    el("span", {
      class: "student-card__next",
      text: upcoming
        ? `Ближайшее: ${formatDate(upcoming.date)}, ${upcoming.startTime}`
        : "Занятий не запланировано",
    }),
  ]);

  const openButton = el("button", {
    class: "btn btn--ghost btn--sm", type: "button", text: "Карточка",
  });
  openButton.addEventListener("click", () => openStudentModal(student));
  footer.append(openButton);

  card.append(head, body, footer);
  return card;
}

function openStudentModal(student = null) {
  const isNew = !student;
  const formId = `student-form-${Math.random().toString(36).slice(2, 8)}`;

  const initial = isNew
    ? { firstName: "", lastName: "", subject: "", contact: "", rate: state.settings.defaults.rate, color: db.SUBJECT_COLORS[0], comment: "" }
    : { ...student };

  const firstNameInput = input({
    type: "text", name: "firstName", value: initial.firstName || "",
    required: true, placeholder: "Анна", autocomplete: "off",
  });
  const firstNameField = field({ label: "Имя", control: firstNameInput, required: true });

  const lastNameInput = input({
    type: "text", name: "lastName", value: initial.lastName || "",
    required: true, placeholder: "Ковалёва", autocomplete: "off",
  });
  const lastNameField = field({
    label: "Фамилия",
    control: lastNameInput,
    required: true,
    hint: "В расписании видно и фамилию, и имя",
  });

  const subjectListId = `student-subjects-${formId}`;
  const subjectInput = input({ type: "text", name: "subject", value: initial.subject, list: subjectListId, placeholder: "Например, Математика", required: true });
  const subjectDatalist = el("datalist", { id: subjectListId });
  [...new Set([...db.DEMO_SUBJECTS, ...state.students.map((item) => item.subject).filter(Boolean)])]
    .sort((a, b) => a.localeCompare(b, "ru"))
    .forEach((value) => subjectDatalist.append(el("option", { value })));
  const subjectField = field({ label: "Предмет", control: subjectInput, required: true });

  const contactInput = input({ type: "text", name: "contact", value: initial.contact, placeholder: "+7…, @ник или email" });
  const contactField = field({
    label: "Контакт",
    control: contactInput,
    hint: "Телефон, @ник или email",
  });

  const rateInput = input({ type: "number", name: "rate", min: "0", step: "50", value: String(initial.rate ?? 0), inputmode: "numeric" });
  const rateField = field({ label: "Ставка за 60 минут, ₽", control: rateInput });

  let color = initial.color || db.SUBJECT_COLORS[0];
  const colorRow = el("div", { class: "colors", role: "group", "aria-label": "Цвет в расписании" });
  const colorButtons = db.SUBJECT_COLORS.map((value) => {
    const button = el("button", {
      class: `color-dot subj-${value}${color === value ? " is-active" : ""}`,
      type: "button",
      "aria-label": `Цвет ${value}`,
      "aria-pressed": String(color === value),
    });
    button.dataset.value = value;
    button.addEventListener("click", () => {
      color = value;
      colorButtons.forEach((node) => {
        const active = node.dataset.value === value;
        node.classList.toggle("is-active", active);
        node.setAttribute("aria-pressed", String(active));
      });
    });
    return button;
  });
  colorRow.append(...colorButtons);
  const colorField = field({ label: "Цвет в расписании", control: colorRow });

  const commentInput = el("textarea", { class: "input input--area", name: "comment", rows: "3", placeholder: "Цель занятий, особенности, договорённости" });
  commentInput.value = initial.comment || "";
  const commentField = field({ label: "Комментарий", control: commentInput });

  const form = el("form", { class: "form", id: formId, novalidate: true }, [
    el("div", { class: "form__row" }, [lastNameField, firstNameField]),
    subjectField, subjectDatalist,
    el("div", { class: "form__row" }, [contactField, rateField]),
    colorField, commentField,
  ]);

  const saveButton = el("button", {
    class: "btn btn--primary", type: "submit", form: formId, text: isNew ? "Добавить" : "Сохранить",
  });

  const footer = [];
  if (!isNew) {
    const archiveButton = el("button", {
      class: "btn btn--ghost", type: "button",
      text: student.archived ? "Вернуть из архива" : "В архив",
    });
    archiveButton.addEventListener("click", async () => {
      await db.setStudentArchived(state.db, student.id, !student.archived);
      await db.addActivity(state.db, {
        type: "student",
        message: `${student.archived ? "Возвращён из архива" : "Отправлен в архив"}: ${student.name}`,
      });
      modal.close();
      await refresh();
      toast(student.archived ? "Ученик возвращён из архива" : "Ученик отправлен в архив", { type: "info" });
    });
    footer.push(archiveButton);
  }

  footer.push(el("div", { class: "modal__spacer" }));
  footer.push(el("button", {
    class: "btn btn--ghost", type: "button", text: "Отмена", onclick: () => modal.close(),
  }));
  footer.push(saveButton);

  const body = [form];

  if (!isNew) {
    const lessons = lessonsOfStudent(student.id);
    const stats = computeStats(lessons);
    const history = el("div", { class: "history" });

    if (!lessons.length) {
      history.append(el("p", { class: "field__hint", text: "Занятий пока нет." }));
    } else {
      lessons.slice(-12).reverse().forEach((lesson) => {
        history.append(el("div", { class: "history__row" }, [
          el("span", { class: "history__date", text: `${formatDate(lesson.date)} ${lesson.startTime}` }),
          badge(db.STATUS_LABELS[lesson.status], db.STATUS_TONES[lesson.status]),
          el("span", { class: "history__sum", text: formatMoney(lesson.price) }),
          el("span", { class: "history__paid", text: lesson.paid ? "оплачено" : "не оплачено" }),
        ]));
      });
    }

    body.push(el("section", { class: "modal__section" }, [
      el("h3", { class: "modal__section-title", text: "История и суммы" }),
      el("div", { class: "mini-stats" }, [
        miniStat("Занятий", String(stats.count)),
        miniStat("Часов", formatHours(stats.minutes)),
        miniStat("Оплачено", formatMoney(stats.paid)),
        miniStat("Долг", formatMoney(stats.due)),
      ]),
      history,
    ]));
  }

  const modal = openModal({
    title: isNew ? "Новый ученик" : student.name,
    subtitle: isNew ? "Имя, фамилия, предмет и ставка обязательны" : student.subject,
    size: "md",
    body,
    footer,
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    [firstNameField, lastNameField, subjectField, contactField, rateField]
      .forEach((node) => node.setError(""));

    try {
      const saved = await db.saveStudent(state.db, {
        ...(isNew ? {} : initial),
        firstName: firstNameInput.value,
        lastName: lastNameInput.value,
        subject: subjectInput.value,
        contact: contactInput.value,
        rate: rateInput.value,
        color,
        comment: commentInput.value,
      });

      await db.addActivity(state.db, {
        type: "student",
        message: `${isNew ? "Добавлен" : "Изменён"} ученик: ${saved.name}`,
      });

      modal.close();
      await refresh();
      toast(isNew ? "Ученик добавлен" : "Данные ученика сохранены", { type: "success" });
    } catch (error) {
      if (error instanceof db.ValidationError) {
        const map = {
          firstName: firstNameField,
          lastName: lastNameField,
          subject: subjectField,
          contact: contactField,
          rate: rateField,
        };
        const target = map[error.field] || firstNameField;
        target.setError(error.message);
        target.querySelector("input")?.focus();
        return;
      }
      console.error(error);
      toast(error?.message || "Не удалось сохранить ученика", { type: "error" });
    }
  });
}

function miniStat(label, value) {
  return el("div", { class: "mini-stat" }, [
    el("span", { class: "mini-stat__label", text: label }),
    el("strong", { class: "mini-stat__value", text: value }),
  ]);
}

/* ---------- Заметки ---------- */

function renderNotesView() {
  const page = el("div", { class: "page" });

  page.append(el("header", { class: "page__head" }, [
    el("div", { class: "page__heading" }, [
      el("h1", { class: "page__title", text: "Заметки" }),
      el("p", { class: "page__sub", text: "Что прошли, что задать, на что обратить внимание" }),
    ]),
  ]));

  const search = input({
    type: "search",
    placeholder: "Поиск по тексту или ученику",
    value: state.noteQuery,
    "aria-label": "Поиск заметок",
  });

  const list = el("div", { class: "notes" });

  function paint() {
    clear(list);
    const query = state.noteQuery.trim().toLowerCase();

    const items = state.notes
      .map((note) => ({ note, lesson: state.lessons.find((lesson) => lesson.id === note.lessonId) }))
      .filter(({ note, lesson }) => {
        if (!lesson) return false;
        if (!query) return true;
        const student = getStudent(lesson.studentId);
        return `${note.text} ${student?.name || ""} ${student?.subject || ""}`.toLowerCase().includes(query);
      })
      .sort((a, b) => `${b.lesson.date} ${b.lesson.startTime}`.localeCompare(`${a.lesson.date} ${a.lesson.startTime}`));

    if (!items.length) {
      list.append(emptyState({
        title: state.notes.length ? "Заметок не найдено" : "Заметок пока нет",
        text: state.notes.length
          ? "Измените запрос."
          : "Откройте занятие и запишите, что прошли и что задать. Заметка появится здесь.",
      }));
      return;
    }

    for (const { note, lesson } of items) {
      list.append(noteCard(note, lesson));
    }
  }

  search.addEventListener("input", () => {
    state.noteQuery = search.value;
    paint();
  });

  page.append(el("div", { class: "filters" }, [search]));
  page.append(list);
  paint();
  return page;
}

function noteCard(note, lesson) {
  const student = getStudent(lesson.studentId);

  const textarea = el("textarea", { class: "note__text input input--area", rows: "4" });
  textarea.value = note.text;

  const status = el("span", { class: "note__status", "aria-live": "polite", text: "Сохранено" });
  let timer = null;

  textarea.addEventListener("input", () => {
    clearTimeout(timer);
    status.textContent = "Сохраняем…";
    timer = setTimeout(async () => {
      try {
        const saved = await db.saveNoteForLesson(state.db, {
          lessonId: note.lessonId,
          studentId: note.studentId,
          text: textarea.value,
        });
        state.notes = state.notes.filter((item) => item.lessonId !== note.lessonId);
        if (saved) state.notes.push(saved);
        status.textContent = saved ? "Сохранено" : "Пустая заметка не сохраняется";
      } catch (error) {
        console.error(error);
        status.textContent = "Не удалось сохранить";
      }
    }, 700);
  });

  const openButton = el("button", {
    class: "btn btn--ghost btn--sm", type: "button", text: "Открыть занятие",
  });
  openButton.addEventListener("click", () => openLessonModal({ lesson }));

  return el("article", { class: `note ${studentColor(student)}` }, [
    el("header", { class: "note__head" }, [
      el("div", { class: "note__who" }, [
        el("strong", { text: student?.name || "Ученик не найден" }),
        el("span", { class: "note__meta", text: `${formatDate(lesson.date)} · ${timeRangeLabel(lesson.startTime, lesson.duration)}` }),
      ]),
      badge(db.STATUS_LABELS[lesson.status], db.STATUS_TONES[lesson.status]),
    ]),
    textarea,
    el("footer", { class: "note__foot" }, [status, openButton]),
  ]);
}

/* ---------- Сводка ---------- */

function renderSummaryView() {
  const page = el("div", { class: "page" });
  const month = state.summaryMonth;
  const from = startOfMonth(month);
  const to = endOfMonth(month);
  const lessons = state.lessons.filter((lesson) => lesson.date >= from && lesson.date <= to);
  const stats = computeStats(lessons);

  const nav = el("div", { class: "datenav" }, [
    el("button", {
      class: "icon-btn", type: "button", "aria-label": "Предыдущий месяц", text: "‹",
      onclick: () => { state.summaryMonth = addMonths(month, -1); render(); },
    }),
    el("button", {
      class: "btn btn--ghost btn--sm", type: "button", text: "Текущий месяц",
      onclick: () => { state.summaryMonth = todayISO(); render(); },
    }),
    el("button", {
      class: "icon-btn", type: "button", "aria-label": "Следующий месяц", text: "›",
      onclick: () => { state.summaryMonth = addMonths(month, 1); render(); },
    }),
  ]);

  page.append(el("header", { class: "page__head" }, [
    el("div", { class: "page__heading" }, [
      el("h1", { class: "page__title", text: formatMonthTitle(month) }),
      el("p", { class: "page__sub", text: "Часы, суммы и долг по ученикам" }),
    ]),
    el("div", { class: "page__tools" }, [nav]),
  ]));

  page.append(el("div", { class: "stats" }, [
    statCard("Занятий", String(stats.count), "без отменённых"),
    statCard("Часов", formatHours(stats.minutes), "суммарная длительность"),
    statCard("Оплачено", formatMoney(stats.paid), "по отметкам об оплате"),
    statCard("К оплате", formatMoney(stats.due), "долг за месяц"),
  ]));

  const rows = state.students
    .map((student) => {
      const own = lessons.filter((lesson) => lesson.studentId === student.id);
      return { student, stats: computeStats(own) };
    })
    .filter((row) => row.stats.count > 0)
    .sort((a, b) => b.stats.due - a.stats.due);

  if (!rows.length) {
    page.append(emptyState({
      title: "В этом месяце занятий нет",
      text: "Выберите другой месяц или поставьте занятия в расписании.",
    }));
    return page;
  }

  const table = el("table", { class: "table" }, [
    el("thead", {}, [
      el("tr", {}, [
        el("th", { text: "Ученик" }),
        el("th", { text: "Предмет" }),
        el("th", { class: "is-num", text: "Занятий" }),
        el("th", { class: "is-num", text: "Часов" }),
        el("th", { class: "is-num", text: "Сумма" }),
        el("th", { class: "is-num", text: "Оплачено" }),
        el("th", { class: "is-num", text: "Долг" }),
      ]),
    ]),
    el("tbody", {}, rows.map(({ student, stats: own }) => el("tr", {}, [
      el("td", {}, [el("span", { class: `dot ${studentColor(student)}` }), el("span", { text: student.name })]),
      el("td", { text: student.subject }),
      el("td", { class: "is-num", text: String(own.count) }),
      el("td", { class: "is-num", text: formatHours(own.minutes) }),
      el("td", { class: "is-num", text: formatMoney(own.paid + own.due) }),
      el("td", { class: "is-num", text: formatMoney(own.paid) }),
      el("td", { class: `is-num${own.due ? " is-due" : ""}`, text: formatMoney(own.due) }),
    ]))),
  ]);

  page.append(el("div", { class: "table-wrap" }, [table]));
  return page;
}

/* ---------- Настройки ---------- */

function renderSettingsView() {
  const page = el("div", { class: "page" });

  page.append(el("header", { class: "page__head" }, [
    el("div", { class: "page__heading" }, [
      el("h1", { class: "page__title", text: "Настройки" }),
      el("p", { class: "page__sub", text: "График работы, значения по умолчанию и данные" }),
    ]),
  ]));

  /* График работы */
  const startInput = input({ type: "time", step: "900", value: state.settings.workHours.start });
  const endInput = input({ type: "time", step: "900", value: state.settings.workHours.end });
  const stepSelect = select([
    { value: "15", label: "15 минут" },
    { value: "30", label: "30 минут" },
    { value: "60", label: "60 минут" },
  ], { value: String(state.settings.workHours.step) });

  const workdayChips = WEEKDAYS.map((day) => {
    const active = state.settings.workHours.workdays.includes(day.index);
    const button = el("button", {
      class: `chip${active ? " is-active" : ""}`,
      type: "button",
      text: day.short,
      title: day.full,
      "aria-pressed": String(active),
    });
    button.dataset.value = String(day.index);
    button.addEventListener("click", () => {
      const isActive = button.classList.toggle("is-active");
      button.setAttribute("aria-pressed", String(isActive));
      saveWorkHours();
    });
    return button;
  });

  const weekendsToggle = checkbox({
    label: "Показывать выходные",
    checked: state.settings.workHours.showWeekends,
    onChange: () => saveWorkHours(),
  });

  const durationSelect = select(
    [15, 30, 45, 60, 75, 90, 120].map((value) => ({ value: String(value), label: durationLabel(value) })),
    { value: String(state.settings.defaults.duration) }
  );

  const rateInput = input({
    type: "number", min: "0", step: "50",
    value: String(state.settings.defaults.rate), inputmode: "numeric",
  });

  const firstDaySelect = select([
    { value: "1", label: "С понедельника" },
    { value: "7", label: "С воскресенья" },
  ], { value: String(state.settings.view.firstDay) });

  async function saveWorkHours() {
    state.settings = await db.saveSettings(state.db, {
      workHours: {
        start: startInput.value || "08:00",
        end: endInput.value || "22:00",
        step: Number(stepSelect.value),
        workdays: workdayChips
          .filter((chip) => chip.classList.contains("is-active"))
          .map((chip) => Number(chip.dataset.value)),
        showWeekends: weekendsToggle.inputNode.checked,
      },
      defaults: {
        duration: Number(durationSelect.value),
        rate: Number(rateInput.value) || 0,
      },
      view: {
        firstDay: Number(firstDaySelect.value),
      },
    });
    render();
  }

  [startInput, endInput].forEach((node) => node.addEventListener("change", saveWorkHours));
  [stepSelect, durationSelect, rateInput, firstDaySelect].forEach((node) => node.addEventListener("change", saveWorkHours));

  page.append(el("section", { class: "card" }, [
    el("h2", { class: "card__title", text: "График работы" }),
    el("p", { class: "card__sub", text: "Сетка недели подстраивается под эти значения" }),
    el("div", { class: "form__row form__row--3" }, [
      field({ label: "Начало дня", control: startInput }),
      field({ label: "Конец дня", control: endInput }),
      field({ label: "Шаг сетки", control: stepSelect }),
    ]),
    el("div", { class: "field" }, [
      el("span", { class: "field__label", text: "Рабочие дни" }),
      el("div", { class: "chips" }, workdayChips),
    ]),
    weekendsToggle,
    el("div", { class: "form__row form__row--3" }, [
      field({ label: "Занятие по умолчанию", control: durationSelect }),
      field({ label: "Ставка по умолчанию, ₽", control: rateInput }),
      field({ label: "Неделя начинается", control: firstDaySelect }),
    ]),
  ]));

  /* Данные */
  const exportButton = el("button", { class: "btn btn--ghost", type: "button", text: "Экспорт JSON" });
  exportButton.addEventListener("click", exportBackup);

  const importInput = el("input", { type: "file", accept: "application/json,.json", class: "visually-hidden" });
  importInput.id = "import-file";
  const importButton = el("button", { class: "btn btn--ghost", type: "button", text: "Импорт JSON" });
  importButton.addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", importBackup);

  const demoButton = el("button", { class: "btn btn--ghost", type: "button", text: "Загрузить пример" });
  demoButton.addEventListener("click", loadDemo);

  const demoCount = state.students.filter((item) => item.demo).length;
  const removeDemoButton = el("button", {
    class: "btn btn--ghost",
    type: "button",
    text: demoCount ? `Удалить демо-данные (${demoCount})` : "Удалить демо-данные",
  });
  removeDemoButton.addEventListener("click", removeDemo);

  const clearButton = el("button", { class: "btn btn--ghost btn--danger-text", type: "button", text: "Очистить всё" });
  clearButton.addEventListener("click", clearEverything);

  page.append(el("section", { class: "card" }, [
    el("h2", { class: "card__title", text: "Данные" }),
    el("p", { class: "card__sub", text: "Всё хранится локально в этом браузере" }),
    el("div", { class: "card__actions" }, [exportButton, importButton, importInput, demoButton, removeDemoButton, clearButton]),
    el("p", {
      class: "card__text",
      text: "«Удалить демо-данные» убирает только записи из примера. Ваши ученики, занятия и заметки остаются.",
    }),
    el("dl", { class: "facts" }, [
      el("div", {}, [el("dt", { text: "Учеников" }), el("dd", { text: String(state.students.length) })]),
      el("div", {}, [el("dt", { text: "Занятий" }), el("dd", { text: String(state.lessons.length) })]),
      el("div", {}, [el("dt", { text: "Серий" }), el("dd", { text: String(state.series.length) })]),
      el("div", {}, [el("dt", { text: "Заметок" }), el("dd", { text: String(state.notes.length) })]),
    ]),
  ]));

  page.append(el("section", { class: "card" }, [
    el("h2", { class: "card__title", text: "О приложении" }),
    el("p", { class: "card__sub", text: "TutorFlow — локальный планировщик занятий репетитора" }),
    el("p", { class: "card__text", text: "Данные не отправляются в сеть. Резервная копия — единственный способ перенести расписание на другой компьютер." }),
    el("p", { class: "card__text", text: `Схема хранилища: версия ${db.DB_VERSION}. Горячие клавиши: N — новое занятие, T — сегодня, 1–3 — вид расписания.` }),
  ]));

  return page;
}

/* ---------- Данные ---------- */

async function exportBackup() {
  try {
    const data = await db.exportData(state.db);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = el("a", {
      href: url,
      download: `tutorflow-${todayISO()}.json`,
      class: "visually-hidden",
    });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Резервная копия сохранена", { type: "success" });
  } catch (error) {
    console.error(error);
    toast("Не удалось создать файл копии", { type: "error" });
  }
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Файл повреждён: это не корректный JSON.");
    }

    const normalized = db.validateBackup(data);
    const counts = normalized;
    const ok = await confirmDialog({
      title: "Заменить все данные?",
      message: `В файле учеников: ${counts.students.length}, занятий: ${counts.lessons.length}, заметок: ${counts.notes.length}. `
        + "Текущие данные будут полностью заменены. Отменить это действие нельзя.",
      confirmLabel: "Заменить",
      danger: true,
    });
    if (!ok) return;

    const result = await db.importData(state.db, normalized);
    await refresh();
    toast(`Импортировано: учеников ${result.students}, занятий ${result.lessons}, заметок ${result.notes}`, { type: "success" });
  } catch (error) {
    console.error(error);
    toast(error?.message || "Не удалось прочитать файл", { type: "error" });
  } finally {
    event.target.value = "";
  }
}

async function loadDemo() {
  const realStudents = state.students.filter((item) => !item.demo).length;
  const realLessons = state.lessons.filter((item) => !item.demo).length;

  const message = realStudents || realLessons
    ? `Внимание: в базе уже есть ваши записи — учеников ${realStudents}, занятий ${realLessons}. `
      + "Загрузка примера удалит их безвозвратно. Сначала сделайте резервную копию. Продолжить?"
    : "Текущие демонстрационные данные будут заменены свежим примером на пять недель. Все записи вымышленные.";

  const ok = await confirmDialog({
    title: "Загрузить демонстрационные данные?",
    message,
    confirmLabel: "Загрузить",
    danger: Boolean(realStudents || realLessons),
  });
  if (!ok) return;

  try {
    const result = await db.seedDemoData(state.db);
    state.anchor = todayISO();
    await refresh();
    toast(`Пример загружен: учеников ${result.students}, занятий ${result.lessons}`, { type: "success" });
  } catch (error) {
    console.error(error);
    toast("Не удалось загрузить пример", { type: "error" });
  }
}

/** Удаляет только демонстрационные записи, не трогая настоящие справочники. */
async function removeDemo() {
  let found;
  try {
    found = await db.findDemoRecords(state.db);
  } catch (error) {
    console.error(error);
    toast("Не удалось проверить демо-данные", { type: "error" });
    return;
  }

  const total = found.students.length + found.lessons.length + found.notes.length;
  if (!total) {
    toast("Демонстрационных данных нет", { type: "info" });
    return;
  }

  const ok = await confirmDialog({
    title: "Удалить демо-данные?",
    message: `Будет удалено: учеников ${found.students.length}, занятий ${found.lessons.length}, `
      + `серий ${found.series.length}, заметок ${found.notes.length}. `
      + "Ваши собственные записи останутся.",
    confirmLabel: "Удалить демо",
  });
  if (!ok) return;

  try {
    const result = await db.removeDemoData(state.db);
    await refresh();
    toast(
      `Демо-данные удалены: учеников ${result.students}, занятий ${result.lessons}`,
      { type: "success" }
    );
  } catch (error) {
    console.error(error);
    toast("Не удалось удалить демо-данные", { type: "error" });
  }
}

async function clearEverything() {
  const ok = await confirmDialog({
    title: "Очистить все данные?",
    message: "Будут удалены все ученики, занятия, серии и заметки. Действие необратимо — сначала сделайте резервную копию.",
    confirmLabel: "Очистить",
    danger: true,
  });
  if (!ok) return;

  try {
    await db.clearAll(state.db);
    state.settings = structuredClone(db.DEFAULT_SETTINGS);
    await refresh();
    toast("Все данные удалены", { type: "info" });
  } catch (error) {
    console.error(error);
    toast("Не удалось очистить данные", { type: "error" });
  }
}

/* ---------- Горячие клавиши ---------- */

function bindShortcuts() {
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (document.body.classList.contains("is-modal")) return;

    const target = event.target;
    if (target instanceof HTMLElement) {
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
    }

    const key = event.key.toLowerCase();

    if (key === "n") {
      event.preventDefault();
      openLessonModal({ date: todayISO() });
    } else if (key === "t") {
      event.preventDefault();
      goToday();
    } else if (key === "1" || key === "2" || key === "3") {
      event.preventDefault();
      state.view = "schedule";
      state.mode = key === "1" ? "week" : key === "2" ? "month" : "list";
      render();
    }
  });
}
