BEGIN;

-- lov_db_storage_objects_owner_unbound_v1_df9bdaea1eaa4927
DROP POLICY IF EXISTS employee_documents_storage_read ON storage.objects;
DROP POLICY IF EXISTS employee_documents_storage_read_guard ON storage.objects;

CREATE POLICY employee_documents_storage_read ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'employee-documents'
    AND (
      owner_id = (SELECT auth.uid()::text)
      OR (SELECT public.can_manage_employee_documents())
      OR EXISTS (
        SELECT 1 FROM public.employee_documents d
        WHERE d.file_path = objects.name
          AND (
            d.created_by = (SELECT auth.uid())
            OR d.employee_id = (SELECT public.erp_own_employee_id())
          )
      )
    )
  );

CREATE POLICY employee_documents_storage_read_guard ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    bucket_id <> 'employee-documents'
    OR owner_id = (SELECT auth.uid()::text)
    OR (SELECT public.can_manage_employee_documents())
    OR EXISTS (
      SELECT 1 FROM public.employee_documents d
      WHERE d.file_path = objects.name
        AND (
          d.created_by = (SELECT auth.uid())
          OR d.employee_id = (SELECT public.erp_own_employee_id())
        )
    )
  );

-- lov_db_rls_authenticated_only_v1_8f721bac187c8482
DROP POLICY IF EXISTS branding_read ON public.site_settings;

CREATE POLICY branding_read ON public.site_settings FOR SELECT TO authenticated
  USING (
    (SELECT public.is_admin(auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = (SELECT auth.uid())
    )
    -- Employee accounts are linked through the existing verified identity helper.
    OR (SELECT public.erp_own_employee_id()) IS NOT NULL
  );

COMMIT;
