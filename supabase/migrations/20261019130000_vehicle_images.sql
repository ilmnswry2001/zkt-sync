-- Vehicle image support for the "تفاصيل المركبة" tab.
-- Stores an optional per-vehicle photo URL plus a public storage bucket
-- that admin/HR can upload vehicle photos into.

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS vehicle_image_url text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('vehicle-images', 'vehicle-images', true, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "vehicle images read" ON storage.objects;
CREATE POLICY "vehicle images read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'vehicle-images');

DROP POLICY IF EXISTS "vehicle images insert" ON storage.objects;
CREATE POLICY "vehicle images insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'vehicle-images'
    AND (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr'))
  );

DROP POLICY IF EXISTS "vehicle images update" ON storage.objects;
CREATE POLICY "vehicle images update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'vehicle-images'
    AND (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr'))
  )
  WITH CHECK (
    bucket_id = 'vehicle-images'
    AND (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr'))
  );

DROP POLICY IF EXISTS "vehicle images delete" ON storage.objects;
CREATE POLICY "vehicle images delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'vehicle-images'
    AND (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr'))
  );
