-- Keep an employee's biometric-device PIN separate from the ERP employee number.
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS attendance_device_id text;

CREATE INDEX IF NOT EXISTS employees_attendance_device_id_idx
  ON public.employees (attendance_device_id)
  WHERE attendance_device_id IS NOT NULL;
