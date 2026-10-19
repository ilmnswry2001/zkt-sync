-- ============================================================================
-- Navigation customization (rename groups + move sections between groups).
-- Shared for all users; only system admins can change it.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.navigation_settings (
  id text PRIMARY KEY,
  labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  assignments jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.navigation_settings (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.navigation_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.navigation_settings TO authenticated;
GRANT ALL ON public.navigation_settings TO service_role;

DROP POLICY IF EXISTS "authenticated read navigation settings" ON public.navigation_settings;
CREATE POLICY "authenticated read navigation settings" ON public.navigation_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admins manage navigation settings" ON public.navigation_settings;
CREATE POLICY "admins manage navigation settings" ON public.navigation_settings
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
