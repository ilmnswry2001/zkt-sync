BEGIN;

CREATE TABLE public.employee_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN (
    'work_commencement', 'administrative_order', 'wage_increase', 'official_letter', 'contract', 'penalty_warning', 'other'
  )),
  document_number text NOT NULL CHECK (length(btrim(document_number)) BETWEEN 1 AND 120),
  document_date date NOT NULL,
  effective_date date,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 240),
  issuing_authority text CHECK (length(issuing_authority) <= 160),
  amount_iqd numeric(14, 2) CHECK (amount_iqd IS NULL OR (
    document_type = 'wage_increase' AND amount_iqd BETWEEN 0 AND 999999999999.99
  )),
  file_path text UNIQUE,
  file_name text,
  file_size integer,
  mime_type text,
  notes text CHECK (length(notes) <= 4000),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_document_attachment CHECK (
    (file_path IS NULL AND file_name IS NULL AND file_size IS NULL AND mime_type IS NULL)
    OR (
      file_path IS NOT NULL AND file_path = employee_id::text || '/' || id::text || '/attachment'
      AND file_name IS NOT NULL AND length(btrim(file_name)) BETWEEN 1 AND 255
      AND file_size IS NOT NULL AND file_size BETWEEN 1 AND 15728640
      AND mime_type IS NOT NULL AND mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    )
  )
);
CREATE INDEX idx_employee_documents_employee_id ON public.employee_documents (employee_id);
CREATE INDEX idx_employee_documents_type_date ON public.employee_documents (document_type, document_date DESC);
CREATE INDEX idx_employee_documents_doc_num ON public.employee_documents (document_number);

CREATE TRIGGER employee_documents_updated_at BEFORE UPDATE ON public.employee_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE FUNCTION public.can_manage_employee_documents() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr')
  );
$$;
REVOKE ALL ON FUNCTION public.can_manage_employee_documents() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_employee_documents() TO authenticated;

ALTER TABLE public.employee_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employee_documents FROM public, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.employee_documents TO authenticated;
GRANT UPDATE (document_type, document_number, document_date, effective_date, title, issuing_authority, amount_iqd, notes)
  ON public.employee_documents TO authenticated;
GRANT ALL ON public.employee_documents TO service_role;

CREATE POLICY employee_documents_read ON public.employee_documents FOR SELECT TO authenticated
  USING ((SELECT public.can_manage_employee_documents()) OR employee_id = (SELECT public.erp_own_employee_id()));
CREATE POLICY employee_documents_insert ON public.employee_documents FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.can_manage_employee_documents()) AND created_by = (SELECT auth.uid()));
CREATE POLICY employee_documents_edit ON public.employee_documents FOR UPDATE TO authenticated
  USING ((SELECT public.can_manage_employee_documents()))
  WITH CHECK ((SELECT public.can_manage_employee_documents()));
CREATE POLICY employee_documents_delete ON public.employee_documents FOR DELETE TO authenticated
  USING ((SELECT public.can_manage_employee_documents()));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('employee-documents', 'employee-documents', false, 15728640,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY employee_documents_storage_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'employee-documents' AND EXISTS (
    SELECT 1 FROM public.employee_documents d WHERE d.file_path = objects.name
  ));
CREATE POLICY employee_documents_storage_read_guard ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
  USING (bucket_id <> 'employee-documents' OR EXISTS (
    SELECT 1 FROM public.employee_documents d WHERE d.file_path = objects.name
  ));
CREATE POLICY employee_documents_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'employee-documents' AND (SELECT public.can_manage_employee_documents())
    AND EXISTS (SELECT 1 FROM public.employee_documents d
      WHERE d.file_path = objects.name AND d.created_by = (SELECT auth.uid())));
CREATE POLICY employee_documents_storage_insert_guard ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id <> 'employee-documents' OR ((SELECT public.can_manage_employee_documents())
    AND EXISTS (SELECT 1 FROM public.employee_documents d
      WHERE d.file_path = objects.name AND d.created_by = (SELECT auth.uid()))));
CREATE POLICY employee_documents_storage_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'employee-documents' AND (SELECT public.can_manage_employee_documents())
    AND EXISTS (SELECT 1 FROM public.employee_documents d WHERE d.file_path = objects.name));
CREATE POLICY employee_documents_storage_delete_guard ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (bucket_id <> 'employee-documents' OR ((SELECT public.can_manage_employee_documents())
    AND EXISTS (SELECT 1 FROM public.employee_documents d WHERE d.file_path = objects.name)));
CREATE POLICY employee_documents_storage_no_overwrite ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (bucket_id <> 'employee-documents') WITH CHECK (bucket_id <> 'employee-documents');
CREATE POLICY employee_documents_storage_no_anon ON storage.objects AS RESTRICTIVE FOR ALL TO anon
  USING (bucket_id <> 'employee-documents') WITH CHECK (bucket_id <> 'employee-documents');

CREATE FUNCTION public.list_employee_documents(
  p_employee_id uuid, p_document_type text, p_search text,
  p_from date, p_to date, p_page integer
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH scoped AS NOT MATERIALIZED (
    SELECT d.* FROM public.employee_documents d
    WHERE p_employee_id IS NULL OR d.employee_id = p_employee_id
  ), matching AS NOT MATERIALIZED (
    SELECT d.id, d.employee_id, d.document_type, d.document_number, d.document_date, d.effective_date,
      d.title, d.issuing_authority, d.amount_iqd, d.file_name, d.notes
    FROM scoped d
    WHERE (p_document_type IS NULL OR d.document_type = p_document_type)
      AND (p_from IS NULL OR d.document_date >= p_from)
      AND (p_to IS NULL OR d.document_date <= p_to)
      AND (NULLIF(btrim(p_search), '') IS NULL
        OR strpos(lower(d.document_number), lower(btrim(p_search))) > 0
        OR strpos(lower(d.title), lower(btrim(p_search))) > 0
        OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = d.employee_id
          AND strpos(lower(e.full_name), lower(btrim(p_search))) > 0))
  ), page AS (
    SELECT * FROM matching
    ORDER BY document_date DESC, id DESC
    LIMIT 20 OFFSET (greatest(0, least(p_page, 100000)) * 20)
  ), counts AS (
    SELECT count(*) AS total,
      count(*) FILTER (WHERE document_type = 'work_commencement') AS work_commencement,
      count(*) FILTER (WHERE document_type = 'administrative_order') AS administrative_order,
      count(*) FILTER (WHERE document_type = 'wage_increase') AS wage_increase
    FROM scoped
  )
  SELECT jsonb_build_object(
    'totalCount', (SELECT count(*) FROM matching),
    'stats', (SELECT to_jsonb(counts) FROM counts),
    'rows', coalesce((
      SELECT jsonb_agg(to_jsonb(p) || jsonb_build_object('employee', CASE WHEN e.id IS NOT NULL THEN
        jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_no', e.employee_no,
          'position', e.position, 'department_id', e.department_id,
          'departments', CASE WHEN department.id IS NOT NULL THEN jsonb_build_object('name', department.name) END)
        END) ORDER BY p.document_date DESC, p.id DESC)
      FROM page p LEFT JOIN public.employees e ON e.id = p.employee_id
      LEFT JOIN public.departments department ON department.id = e.department_id
    ), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.list_employee_documents(uuid, text, text, date, date, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.list_employee_documents(uuid, text, text, date, date, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
