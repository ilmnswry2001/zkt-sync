const ones = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"];
const teens = [
  "عشرة",
  "أحد عشر",
  "اثنا عشر",
  "ثلاثة عشر",
  "أربعة عشر",
  "خمسة عشر",
  "ستة عشر",
  "سبعة عشر",
  "ثمانية عشر",
  "تسعة عشر",
];
const tens = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const hundreds = [
  "",
  "مائة",
  "مائتان",
  "ثلاثمائة",
  "أربعمائة",
  "خمسمائة",
  "ستمائة",
  "سبعمائة",
  "ثمانمائة",
  "تسعمائة",
];

function underOneThousand(value: number): string {
  const parts: string[] = [];
  const hundred = Math.floor(value / 100);
  const remainder = value % 100;
  if (hundred) parts.push(hundreds[hundred]);
  if (remainder >= 10 && remainder < 20) {
    parts.push(teens[remainder - 10]);
  } else if (remainder >= 20) {
    const unit = remainder % 10;
    parts.push(
      unit
        ? `${ones[unit]} و${tens[Math.floor(remainder / 10)]}`
        : tens[Math.floor(remainder / 10)],
    );
  } else if (remainder > 0) {
    parts.push(ones[remainder]);
  }
  return parts.join(" و");
}

function groupWords(value: number, singular: string, dual: string, plural: string): string {
  if (value === 1) return singular;
  if (value === 2) return dual;
  if (value >= 3 && value <= 10) return `${underOneThousand(value)} ${plural}`;
  return `${underOneThousand(value)} ${singular}`;
}

function integerWords(value: number): string {
  if (value === 0) return "صفر";
  const millions = Math.floor(value / 1_000_000);
  const thousands = Math.floor((value % 1_000_000) / 1_000);
  const remainder = value % 1_000;
  const parts: string[] = [];
  if (millions) parts.push(groupWords(millions, "مليون", "مليونان", "ملايين"));
  if (thousands) parts.push(groupWords(thousands, "ألف", "ألفان", "آلاف"));
  if (remainder) parts.push(underOneThousand(remainder));
  return parts.join(" و");
}

export function amountInArabicIqd(value: number): string {
  const cents = Math.round(Math.abs(Number.isFinite(value) ? value : 0) * 100);
  const whole = Math.floor(cents / 100);
  const fraction = cents % 100;
  const sign = value < 0 ? "سالب " : "";
  const fractionWords = fraction ? ` و${underOneThousand(fraction)} من مائة دينار` : "";
  return `${sign}${integerWords(whole)} دينار عراقي${fractionWords} فقط لا غير`;
}
