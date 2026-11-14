-- Keep existing receipts intact. New receipts use eight digits until the sequence outgrows them.
alter table public.form_submissions alter column reference_code set default
  ('TL-' || to_char(now(), 'YYYY') || '-' ||
   to_char(nextval('public.form_reference_seq'), 'FM9999999999900000000'));
