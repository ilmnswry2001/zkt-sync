ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'engineer';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS allowed_sections text[];