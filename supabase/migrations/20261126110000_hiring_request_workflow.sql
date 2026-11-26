BEGIN;

ALTER TABLE public.hiring_requests
  ADD COLUMN details text NOT NULL DEFAULT '' CHECK (length(details) <= 4000),
  ADD COLUMN has_passport boolean NOT NULL DEFAULT false,
  ADD COLUMN certificates text[] NOT NULL DEFAULT '{}',
  ADD COLUMN status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','hired','rejected')),
  ADD COLUMN decided_at timestamptz,
  ADD COLUMN decided_by uuid REFERENCES auth.users(id),
  ADD CONSTRAINT hiring_requests_certificates_size CHECK (cardinality(certificates) <= 20),
  ADD CONSTRAINT hiring_requests_decision_fields CHECK (
    (status = 'pending' AND decided_at IS NULL AND decided_by IS NULL)
    OR (status <> 'pending' AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
  );

GRANT INSERT (details,has_passport,certificates) ON public.hiring_requests TO authenticated;
GRANT UPDATE (candidate_name,phone,job_title,details,has_passport,certificates) ON public.hiring_requests TO authenticated;

CREATE POLICY "HR edits hiring requests" ON public.hiring_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr'));

CREATE FUNCTION public.save_hiring_request(
  p_id uuid, p_name text, p_phone text, p_job_title text, p_details text, p_has_passport boolean, p_certificates text[]
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_id uuid;
  v_phone text := regexp_replace(translate(p_phone,'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[[:space:]()-]','','g');
BEGIN
  IF p_certificates IS NULL OR EXISTS (
    SELECT 1 FROM unnest(p_certificates) AS cert(name)
    WHERE name IS NULL OR length(btrim(name)) NOT BETWEEN 1 AND 120
  ) THEN RAISE EXCEPTION 'Invalid certificate name'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.hiring_requests (candidate_name,phone,job_title,details,has_passport,certificates)
    VALUES (btrim(p_name),v_phone,btrim(p_job_title),btrim(p_details),p_has_passport,p_certificates)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.hiring_requests SET candidate_name = btrim(p_name), phone = v_phone, job_title = btrim(p_job_title),
      details = btrim(p_details), has_passport = p_has_passport, certificates = p_certificates
    WHERE id = p_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE insufficient_privilege; END IF;
  END IF;
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.decide_hiring_request(p_id uuid, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr')) THEN
    RAISE insufficient_privilege;
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('hired','rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  UPDATE public.hiring_requests SET status = p_status, decided_at = now(), decided_by = auth.uid()
    WHERE id = p_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Request has already been decided or does not exist' USING ERRCODE = '40001'; END IF;
END;
$$;

CREATE FUNCTION public.get_hiring_request(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT to_jsonb(r) FROM (
    SELECT id,candidate_name,phone,job_title,details,has_passport,certificates,status,created_at
    FROM public.hiring_requests WHERE id = p_id
  ) r;
$$;

CREATE OR REPLACE FUNCTION public.list_hiring_requests(p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM public.hiring_requests),
    'rows', coalesce((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC, r.id DESC)
      FROM (
        SELECT id,candidate_name,phone,job_title,created_at,status
        FROM public.hiring_requests ORDER BY created_at DESC,id DESC LIMIT 15 OFFSET greatest(0,p_offset)
      ) r
    ), '[]'::jsonb)
  );
$$;

INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('hiring-request-files','hiring-request-files',false,10485760,
  ARRAY['image/jpeg','image/png','image/webp','application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

CREATE POLICY "HR reads hiring attachments" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'hiring-request-files' AND EXISTS (
    SELECT 1 FROM public.hiring_requests r WHERE r.id::text = (storage.foldername(name))[1]
  ));

CREATE POLICY "HR adds hiring attachments" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'hiring-request-files' AND array_length(storage.foldername(name),1) = 1 AND EXISTS (
    SELECT 1 FROM public.hiring_requests r WHERE r.id::text = (storage.foldername(name))[1]
  ));

CREATE POLICY "Hiring attachment read guard" ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
  USING (bucket_id <> 'hiring-request-files' OR EXISTS (
    SELECT 1 FROM public.hiring_requests r WHERE r.id::text = (storage.foldername(name))[1]
  ));
CREATE POLICY "Hiring attachment insert guard" ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id <> 'hiring-request-files' OR (array_length(storage.foldername(name),1) = 1 AND EXISTS (
    SELECT 1 FROM public.hiring_requests r WHERE r.id::text = (storage.foldername(name))[1]
  )));
CREATE POLICY "Hiring attachments cannot be overwritten" ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (bucket_id <> 'hiring-request-files') WITH CHECK (bucket_id <> 'hiring-request-files');
CREATE POLICY "Hiring attachments cannot be deleted" ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (bucket_id <> 'hiring-request-files');
CREATE POLICY "Hiring attachments require authentication" ON storage.objects AS RESTRICTIVE FOR ALL TO anon
  USING (bucket_id <> 'hiring-request-files') WITH CHECK (bucket_id <> 'hiring-request-files');

REVOKE ALL ON FUNCTION public.save_hiring_request(uuid,text,text,text,text,boolean,text[]),
  public.decide_hiring_request(uuid,text), public.get_hiring_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_hiring_request(uuid,text,text,text,text,boolean,text[]),
  public.decide_hiring_request(uuid,text), public.get_hiring_request(uuid) TO authenticated;

COMMIT;
