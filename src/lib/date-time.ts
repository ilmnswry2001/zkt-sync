export const COMPANY_TIME_ZONE = "Asia/Baghdad";

function dateParts(date: Date, timeZone = COMPANY_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function dateKeyInTimeZone(date: Date | string, timeZone = COMPANY_TIME_ZONE) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) throw new Error("تاريخ أو وقت غير صالح");
  const parts = dateParts(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export const todayInBaghdad = () => dateKeyInTimeZone(new Date());
export const currentMonthInBaghdad = () => todayInBaghdad().slice(0, 7);

function parseCalendarDate(date: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)) {
    throw new Error("تاريخ غير صالح");
  }
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error("تاريخ غير صالح");
  }
  return { year, month, day };
}

export function addCalendarDays(date: string, amount: number) {
  const { year, month, day } = parseCalendarDate(date);
  if (!Number.isInteger(amount)) throw new Error("عدد الأيام غير صالح");
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

export function instantAtTimeInTimeZone(date: string, time: string, timeZone = COMPANY_TIME_ZONE) {
  const { year, month, day } = parseCalendarDate(date);
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3] ?? 0) > 59) {
    throw new Error("وقت غير صالح");
  }
  const localAsUtc = Date.UTC(year, month - 1, day, Number(match[1]), Number(match[2]), Number(match[3] ?? 0));
  let guess = localAsUtc;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
    );
    const renderedAsUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    guess = localAsUtc - (renderedAsUtc - guess);
  }
  return new Date(guess).toISOString();
}

export function instantAtMidnightInTimeZone(date: string, timeZone = COMPANY_TIME_ZONE) {
  return instantAtTimeInTimeZone(date, "00:00", timeZone);
}

export function monthInstantRangeInBaghdad(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("شهر غير صالح");
  const [year, monthNumber] = month.split("-").map(Number);
  const nextMonthDate = new Date(Date.UTC(year, monthNumber, 1));
  const nextMonth = nextMonthDate.toISOString().slice(0, 7);
  return {
    start: instantAtMidnightInTimeZone(`${month}-01`),
    end: instantAtMidnightInTimeZone(`${nextMonth}-01`),
  };
}
