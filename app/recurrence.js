// recurrence.js — даты, время и правила повтора.
// Чистые функции без DOM и без IndexedDB: их удобно проверять тестами.
// Все даты — строки "YYYY-MM-DD", всё время — строки "HH:MM".
// Арифметика идёт через UTC, чтобы не ловить сдвиги при переходе на летнее время.

export const WEEKDAYS = [
  { index: 1, short: "Пн", full: "Понедельник" },
  { index: 2, short: "Вт", full: "Вторник" },
  { index: 3, short: "Ср", full: "Среда" },
  { index: 4, short: "Чт", full: "Четверг" },
  { index: 5, short: "Пт", full: "Пятница" },
  { index: 6, short: "Сб", full: "Суббота" },
  { index: 7, short: "Вс", full: "Воскресенье" },
];

export const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

export const MONTHS_NOM = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

/** Максимум занятий, которые создаёт одна серия. */
export const MAX_OCCURRENCES = 400;

const MS_PER_DAY = 86400000;

export function pad2(value) {
  return String(value).padStart(2, "0");
}

/* ---------- Даты ---------- */

export function fromISO(iso) {
  const [year, month, day] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function toISO(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export function nowTime(now = new Date()) {
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

export function addDays(iso, days) {
  const date = fromISO(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toISO(date);
}

export function addMonths(iso, months) {
  const [year, month, day] = iso.split("-").map(Number);
  const base = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  return toISO(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), Math.min(day, lastDay))));
}

export function diffDays(fromDate, toDate) {
  return Math.round((fromISO(toDate) - fromISO(fromDate)) / MS_PER_DAY);
}

/** День недели: 1 — понедельник, 7 — воскресенье. */
export function weekdayIndex(iso) {
  const day = fromISO(iso).getUTCDay();
  return day === 0 ? 7 : day;
}

export function startOfWeek(iso, firstDay = 1) {
  const current = weekdayIndex(iso);
  let shift = current - firstDay;
  if (shift < 0) shift += 7;
  return addDays(iso, -shift);
}

export function weekDays(iso, firstDay = 1) {
  const start = startOfWeek(iso, firstDay);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function startOfMonth(iso) {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso) {
  const date = fromISO(iso);
  return toISO(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
}

/** Дни для сетки месяца: от начала недели первого числа до конца недели последнего. */
export function monthGrid(iso, firstDay = 1) {
  const gridStart = startOfWeek(startOfMonth(iso), firstDay);
  const gridEnd = addDays(startOfWeek(endOfMonth(iso), firstDay), 6);
  const total = diffDays(gridStart, gridEnd) + 1;
  return Array.from({ length: total }, (_, index) => addDays(gridStart, index));
}

/* ---------- Время ---------- */

export function timeToMinutes(time) {
  const [hours, minutes] = String(time || "0:0").split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

export function minutesToTime(value) {
  const total = ((Math.round(value) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

export function addMinutes(time, delta) {
  return minutesToTime(timeToMinutes(time) + delta);
}

export function timeRangeLabel(startTime, duration) {
  return `${startTime}–${minutesToTime(timeToMinutes(startTime) + duration)}`;
}

export function durationLabel(minutes) {
  const value = Number(minutes) || 0;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (!hours) return `${rest} мин`;
  if (!rest) return `${hours} ч`;
  return `${hours} ч ${rest} мин`;
}

/* ---------- Форматирование ---------- */

export function formatDate(iso) {
  const [year, month, day] = String(iso).split("-");
  return `${day}.${month}.${year}`;
}

export function formatDateLong(iso) {
  const [year, month, day] = String(iso).split("-").map(Number);
  return `${day} ${MONTHS_GEN[month - 1]} ${year}`;
}

export function formatWeekday(iso, form = "short") {
  const entry = WEEKDAYS[weekdayIndex(iso) - 1];
  return form === "full" ? entry.full : entry.short;
}

export function formatWeekRange(from, to) {
  const [yearA, monthA, dayA] = from.split("-").map(Number);
  const [yearB, monthB, dayB] = to.split("-").map(Number);
  if (yearA === yearB && monthA === monthB) {
    return `${dayA}–${dayB} ${MONTHS_GEN[monthA - 1]} ${yearA}`;
  }
  if (yearA === yearB) {
    return `${dayA} ${MONTHS_GEN[monthA - 1]} – ${dayB} ${MONTHS_GEN[monthB - 1]} ${yearA}`;
  }
  return `${dayA} ${MONTHS_GEN[monthA - 1]} ${yearA} – ${dayB} ${MONTHS_GEN[monthB - 1]} ${yearB}`;
}

export function formatMonthTitle(iso) {
  const [year, month] = iso.split("-").map(Number);
  return `${MONTHS_NOM[month - 1]} ${year}`;
}

const moneyFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

export function formatMoney(value) {
  const number = Math.round(Number(value) || 0);
  return `${moneyFormatter.format(number)}\u00A0₽`;
}

export function formatHours(minutes) {
  return (Math.round((Number(minutes) || 0) / 6) / 10).toFixed(1).replace(".", ",");
}

/** Русское склонение: plural(3, ["занятие", "занятия", "занятий"]) → "занятия". */
export function plural(count, forms) {
  const value = Math.abs(Number(count) || 0) % 100;
  const last = value % 10;
  if (value > 10 && value < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

/* ---------- Правила повтора ---------- */

/**
 * Строит даты занятий по правилу.
 *
 * @param {object} rule
 * @param {string} rule.startDate   первая возможная дата, "YYYY-MM-DD"
 * @param {string} [rule.endDate]   последняя возможная дата включительно
 * @param {number[]} rule.weekdays  дни недели 1..7
 * @param {number} [rule.intervalWeeks=1]  каждые N недель
 * @param {number} [rule.maxCount=MAX_OCCURRENCES]  предохранитель
 * @returns {{dates: string[], total: number, truncated: boolean}}
 */
export function buildOccurrences(rule = {}) {
  const {
    startDate,
    endDate = null,
    weekdays = [],
    intervalWeeks = 1,
    maxCount = MAX_OCCURRENCES,
  } = rule;

  const days = [...new Set((weekdays || []).map(Number))]
    .filter((day) => day >= 1 && day <= 7)
    .sort((a, b) => a - b);

  if (!startDate || !days.length) {
    return { dates: [], total: 0, truncated: false };
  }

  const step = Math.max(1, Math.floor(Number(intervalWeeks)) || 1);
  const startWeek = startOfWeek(startDate, 1);
  const hardStop = endDate && endDate >= startDate ? endDate : addDays(startDate, 366 * 5);

  const all = [];
  let cursor = startDate;
  let guard = 0;

  while (cursor <= hardStop && guard < 4000) {
    guard += 1;
    if (days.includes(weekdayIndex(cursor))) {
      const weeksPassed = Math.round(diffDays(startWeek, startOfWeek(cursor, 1)) / 7);
      if (weeksPassed >= 0 && weeksPassed % step === 0) {
        all.push(cursor);
      }
    }
    cursor = addDays(cursor, 1);
  }

  const truncated = all.length > maxCount;
  return {
    dates: truncated ? all.slice(0, maxCount) : all,
    total: all.length,
    truncated,
  };
}

/** Человеческое описание правила серии. */
export function describeRule(series) {
  const days = (series.weekdays || [])
    .map((day) => WEEKDAYS[day - 1]?.short)
    .filter(Boolean)
    .join(", ");
  const interval = Number(series.intervalWeeks) || 1;
  const every = interval === 1 ? "каждую неделю" : `каждые ${interval} нед.`;
  const time = `${series.startTime}, ${durationLabel(series.duration)}`;
  return `${days} · ${every} · ${time}`;
}
