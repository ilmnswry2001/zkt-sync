import { isDailyPosition, normalizeWageTitle } from "./employee-pay-type.ts";
import { resolvePayrollWage, type PayrollWageRate } from "./payroll-wage-resolution.ts";

export type OnboardingPayType = "daily" | "monthly";
export const attendanceDeviceCodeField = "رمز جهاز البصمة";

export function requiresDailyOnboardingPay(position: string) {
  return (
    isDailyPosition(position) ||
    normalizeWageTitle(position)
      .split(" ")
      .some((word) => /^(سائق|سائقه|سائقة|سائقين|سائقون|سائقات|سواق|سواقين|سواقون)$/.test(word))
  );
}

export function parseEmployeeMessage(message: string) {
  const values: string[] = [];
  let pin = "";
  let deviceCode = "";
  let payType: OnboardingPayType | undefined;
  for (const raw of message.split(/\r?\n/)) {
    const line = raw.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "").trim();
    if (!line || /^اضاف[هة] جديد[هة]\s*[:：]?$/u.test(line.replace(/[أإ]/g, "ا"))) continue;
    const id = line.match(/^(?:ID|معرّ?ف البصمة)\s*(?:[:：–—-]\s*)?([0-9٠-٩۰-۹]{1,48})$/iu);
    if (id) {
      if (pin) throw new Error("تحتوي الرسالة على أكثر من معرف بصمة.");
      pin = id[1].replace(/[٠-٩۰-۹]/g, (digit) =>
        String(digit.charCodeAt(0) - (digit >= "۰" ? 0x06f0 : 0x0660)),
      );
      continue;
    }
    if (/^(?:ID\b|معرّ?ف البصمة)/iu.test(line))
      throw new Error("معرّف البصمة يجب أن يكون رقمًا مثل ID-6.");
    const wage = normalizeWageTitle(line).match(
      /^(?:(?:اجر|راتب|نوع اجر|تصنيف اجر) )?(يومي|يومية|شهري|شهرية|daily|monthly)$/,
    );
    if (wage) {
      if (payType) throw new Error("تحتوي الرسالة على أكثر من نوع أجر.");
      payType = /^(?:يومي|daily)/.test(wage[1]) ? "daily" : "monthly";
      continue;
    }
    const device = line.match(
      /^(?:رمز الجهاز|رقم الجهاز|جهاز البصمة|الجهاز|Device)\s*[:：]\s*(.+)$/iu,
    );
    if (device || (values.length === 2 && /^(?=.*\d)[a-z][a-z\d -]{1,63}$/i.test(line))) {
      if (deviceCode) throw new Error("تحتوي الرسالة على أكثر من رمز جهاز.");
      deviceCode = (device?.[1] ?? line).replace(/\s+/g, " ").trim();
      if (deviceCode.length > 64) throw new Error("رمز الجهاز يتجاوز 64 حرفًا.");
      continue;
    }
    values.push(
      line.replace(/^(?:الاسم(?: الكامل)?|المسمى الوظيفي|التخصص)\s*[:：]\s*/u, "").trim(),
    );
  }
  if (values.length !== 2 || values.some((value) => !value)) {
    throw new Error("ضع الاسم الكامل والمسمى الوظيفي في سطرين منفصلين وراجع السطور الإضافية.");
  }
  return { fullName: values[0], position: values[1], pin, deviceCode, payType };
}

export function resolveOnboardingWage(
  position: string,
  preferred: OnboardingPayType,
  rates: PayrollWageRate[],
) {
  const forcedDaily = requiresDailyOnboardingPay(position);
  const wage = resolvePayrollWage({ position, pay_type: forcedDaily ? "daily" : preferred }, rates);
  return {
    ...wage,
    forcedDaily,
    amount: wage.payType === "daily" ? wage.dailyRate : wage.monthlySalary,
  };
}
