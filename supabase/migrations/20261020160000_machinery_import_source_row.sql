ALTER TABLE public.machinery
  ADD COLUMN IF NOT EXISTS source_row integer;
