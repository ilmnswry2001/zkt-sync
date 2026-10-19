-- Vehicle detail fields for the "تفاصيل المركبة" tab.
-- Adds two nullable date columns used by the vehicle diagram callouts
-- (last fuel refill and security permit expiry). Existing RLS policies
-- are column-agnostic and continue to protect the new columns.

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS last_fuel_date date,
  ADD COLUMN IF NOT EXISTS security_permit_expiry date;
