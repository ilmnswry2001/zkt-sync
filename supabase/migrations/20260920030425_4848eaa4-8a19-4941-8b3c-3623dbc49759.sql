ALTER TABLE public.uploaded_files
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS is_duplicate boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_uploaded_files_hash ON public.uploaded_files (content_hash);

DELETE FROM public.attendance_logs a
USING public.attendance_logs b
WHERE a.employee_no = b.employee_no
  AND a.verify_time = b.verify_time
  AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS ux_attendance_logs_emp_time
  ON public.attendance_logs (employee_no, verify_time);

DROP POLICY IF EXISTS "staff manage files" ON public.uploaded_files;
CREATE POLICY "staff manage files" ON public.uploaded_files FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'hr') OR has_role(auth.uid(), 'data_entry'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'hr') OR has_role(auth.uid(), 'data_entry'));

DROP POLICY IF EXISTS "staff manage logs" ON public.attendance_logs;
CREATE POLICY "staff manage logs" ON public.attendance_logs FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'hr') OR has_role(auth.uid(), 'data_entry'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'hr') OR has_role(auth.uid(), 'data_entry'));