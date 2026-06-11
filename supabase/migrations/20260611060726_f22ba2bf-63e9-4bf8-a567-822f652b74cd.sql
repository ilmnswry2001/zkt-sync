
-- Lock down SECURITY DEFINER helpers
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO service_role;

-- set search_path on set_updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- Storage policies for zk-backups bucket
CREATE POLICY "auth upload zk-backups" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'zk-backups');
CREATE POLICY "auth read zk-backups" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'zk-backups');
CREATE POLICY "admin delete zk-backups" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'zk-backups' AND public.is_admin(auth.uid()));
