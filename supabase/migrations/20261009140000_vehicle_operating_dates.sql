ALTER TABLE public.vehicle_monthly_operations
  ADD COLUMN IF NOT EXISTS operating_dates date[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.vehicle_monthly_operations.operating_dates IS
  'Calendar dates on which the vehicle operated during the recorded month.';
