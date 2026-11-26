BEGIN;

CREATE TABLE public.hiring_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_name text NOT NULL CHECK (candidate_name = btrim(candidate_name) AND length(candidate_name) BETWEEN 2 AND 160),
  phone text NOT NULL CHECK (phone ~ '^\+?[0-9]{7,15}$'),
  job_title text NOT NULL CHECK (job_title = btrim(job_title) AND length(job_title) BETWEEN 2 AND 120),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hiring_requests ENABLE ROW LEVEL SECURITY;
CREATE INDEX hiring_requests_recent_idx ON public.hiring_requests (created_at DESC, id DESC);
GRANT SELECT ON public.hiring_requests TO authenticated;
GRANT INSERT (candidate_name, phone, job_title) ON public.hiring_requests TO authenticated;
GRANT ALL ON public.hiring_requests TO service_role;

CREATE POLICY "HR reads hiring requests" ON public.hiring_requests
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'));

CREATE POLICY "HR submits hiring requests" ON public.hiring_requests
  FOR INSERT TO authenticated WITH CHECK (
    created_by = auth.uid() AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'))
  );

CREATE FUNCTION public.submit_hiring_request(p_name text, p_phone text, p_job_title text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  INSERT INTO public.hiring_requests (candidate_name, phone, job_title)
  VALUES (
    btrim(p_name),
    regexp_replace(translate(p_phone, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[[:space:]()-]', '', 'g'),
    btrim(p_job_title)
  );
$$;

CREATE FUNCTION public.list_hiring_requests(p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM public.hiring_requests),
    'rows', coalesce((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC, r.id DESC)
      FROM (
        SELECT id, candidate_name, phone, job_title, created_at
        FROM public.hiring_requests
        ORDER BY created_at DESC, id DESC
        LIMIT 15 OFFSET greatest(0, p_offset)
      ) r
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.submit_hiring_request(text,text,text), public.list_hiring_requests(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_hiring_request(text,text,text), public.list_hiring_requests(integer) TO authenticated;

COMMIT;
