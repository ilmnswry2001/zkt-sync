type EmployeeMatch = { id: string; employee_no: string; attendance_device_id: string };

export function unmatchedZktecoPinMessage(pin: string) {
  return pin.trim() === "0"
    ? "أرسل الجهاز رقم مستخدم 0؛ معرف الحركة ليس رقم الموظف ولا يمكن استخدامه للمطابقة"
    : "رقم المستخدم في الجهاز غير مرتبط بحقل Attendance Device ID لأي موظف";
}

export async function matchZktecoPins(admin: any, pins: string[]) {
  const byDeviceId = new Map<string, EmployeeMatch>();
  const ambiguousDeviceIds = new Set<string>();
  const normalizedPins = [...new Set(pins.map((pin) => String(pin).trim()).filter(Boolean))];

  for (let i = 0; i < normalizedPins.length; i += 500) {
    const chunk = normalizedPins.slice(i, i + 500);
    const { data: deviceMatches, error: deviceError } = await admin.from("employees")
      .select("id, employee_no, attendance_device_id").in("attendance_device_id", chunk);
    if (deviceError) {
      const missingColumn = deviceError.code === "PGRST204" || deviceError.code === "42703" ||
        /attendance_device_id.*(schema cache|does not exist|not found)|column .*attendance_device_id/i.test(deviceError.message ?? "");
      if (missingColumn) throw new Error("تعذر المطابقة: عمود Attendance Device ID غير موجود في قاعدة البيانات؛ طبّق ترحيل employees.attendance_device_id أولاً");
      throw deviceError;
    }
    for (const row of deviceMatches ?? []) {
      const pin = String(row.attendance_device_id ?? "").trim();
      const employeeNo = String(row.employee_no ?? "").trim();
      if (!pin || !employeeNo) continue;
      const previous = byDeviceId.get(pin);
      if (previous && previous.id !== row.id) ambiguousDeviceIds.add(pin);
      else byDeviceId.set(pin, { ...row, employee_no: employeeNo, attendance_device_id: pin });
    }
  }

  const employeeByPin = new Map<string, EmployeeMatch>();
  for (const rawPin of pins) {
    const pin = String(rawPin).trim();
    if (!pin || ambiguousDeviceIds.has(pin)) continue;
    const employee = byDeviceId.get(pin);
    if (employee) employeeByPin.set(pin, employee);
  }
  return employeeByPin;
}
