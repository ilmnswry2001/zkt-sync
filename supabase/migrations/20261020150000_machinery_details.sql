-- Extend the machinery register with the fields present in the company asset sheet.
ALTER TABLE public.machinery
  ADD COLUMN IF NOT EXISTS asset_number text,
  ADD COLUMN IF NOT EXISTS owner_name text,
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS driver_name text,
  ADD COLUMN IF NOT EXISTS document_status text,
  ADD COLUMN IF NOT EXISTS document_days_remaining text,
  ADD COLUMN IF NOT EXISTS requires_ato boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ato_status text,
  ADD COLUMN IF NOT EXISTS ato_expiry date,
  ADD COLUMN IF NOT EXISTS security_permit_no text,
  ADD COLUMN IF NOT EXISTS security_permit_status text,
  ADD COLUMN IF NOT EXISTS security_permit_expiry date,
  ADD COLUMN IF NOT EXISTS daily_rent numeric(12,2) NOT NULL DEFAULT 0 CHECK (daily_rent >= 0),
  ADD COLUMN IF NOT EXISTS driver_daily_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (driver_daily_cost >= 0),
  ADD COLUMN IF NOT EXISTS extra_hourly_rate numeric(12,2) NOT NULL DEFAULT 0 CHECK (extra_hourly_rate >= 0);

CREATE INDEX IF NOT EXISTS machinery_asset_number_idx ON public.machinery(asset_number);
