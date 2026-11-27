DROP POLICY IF EXISTS "HR reads hiring attachments" ON storage.objects;
CREATE POLICY "HR reads hiring attachments" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'hiring-request-files' AND (
    (owner_id = (SELECT auth.uid()::text) OR owner = (SELECT auth.uid()))
    AND (public.is_admin((SELECT auth.uid())) OR public.has_role((SELECT auth.uid()), 'hr'))
    AND EXISTS (
      SELECT 1 FROM public.hiring_requests r WHERE r.id::text = (storage.foldername(name))[1]
    )
  ));

DROP POLICY IF EXISTS "HR adds hiring attachments" ON storage.objects;
CREATE POLICY "HR adds hiring attachments" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'hiring-request-files' AND array_length(storage.foldername(name),1) = 1 AND (
    (owner_id = (SELECT auth.uid()::text) OR owner = (SELECT auth.uid()))
    AND (public.is_admin((SELECT auth.uid())) OR public.has_role((SELECT auth.uid()), 'hr'))
    AND EXISTS (
      SELECT 1 FROM public.hiring_requests r WHERE r.id::text = (storage.foldername(name))[1]
    )
  ));

DROP POLICY IF EXISTS "Hiring attachment read guard" ON storage.objects;
CREATE POLICY "Hiring attachment read guard" ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
  USING (bucket_id <> 'hiring-request-files' OR (
    (owner_id = (SELECT auth.uid()::text) OR owner = (SELECT auth.uid()))
    AND (public.is_admin((SELECT auth.uid())) OR public.has_role((SELECT auth.uid()), 'hr'))
    AND EXISTS (
      SELECT 1 FROM public.hiring_requests r WHERE r.id::text = (storage.foldername(name))[1]
    )
  ));

DROP POLICY IF EXISTS "Hiring attachment insert guard" ON storage.objects;
CREATE POLICY "Hiring attachment insert guard" ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id <> 'hiring-request-files' OR (array_length(storage.foldername(name),1) = 1 AND (
    (owner_id = (SELECT auth.uid()::text) OR owner = (SELECT auth.uid()))
    AND (public.is_admin((SELECT auth.uid())) OR public.has_role((SELECT auth.uid()), 'hr'))
    AND EXISTS (
      SELECT 1 FROM public.hiring_requests r WHERE r.id::text = (storage.foldername(name))[1]
    )
  )));
