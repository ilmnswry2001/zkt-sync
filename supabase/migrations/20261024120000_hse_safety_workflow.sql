-- HSE reporting, corrective actions, team scoring, and cross-department tickets.
-- Operational sites, vehicles, employees, and departments reuse the ERP tables.

CREATE TABLE public.hse_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL UNIQUE REFERENCES public.employees(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('manager', 'team_leader', 'officer', 'permit_authorizer')),
  team_leader_id uuid REFERENCES public.hse_memberships(id) ON DELETE SET NULL,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  area text NOT NULL DEFAULT 'all' CHECK (area IN ('north', 'south', 'all')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hse_memberships_role_idx ON public.hse_memberships(role, active);
CREATE INDEX hse_memberships_leader_idx ON public.hse_memberships(team_leader_id, active);
ALTER TABLE public.hse_memberships ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hse_memberships TO authenticated;
GRANT ALL ON public.hse_memberships TO service_role;

CREATE OR REPLACE FUNCTION public.hse_is_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'admin') OR public.has_role(_user_id, 'hr')
    OR EXISTS (
      SELECT 1 FROM public.hse_memberships m
      WHERE m.active AND m.role = 'manager'
        AND (m.user_id = _user_id OR public.employee_user_id(m.employee_id) = _user_id)
    )
$$;

CREATE OR REPLACE FUNCTION public.hse_is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.hse_is_manager(_user_id) OR EXISTS (
    SELECT 1 FROM public.hse_memberships m
    WHERE m.active AND (m.user_id = _user_id OR public.employee_user_id(m.employee_id) = _user_id)
  )
$$;

CREATE OR REPLACE FUNCTION public.hse_can_review_report(_user_id uuid, _employee_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.hse_is_manager(_user_id) OR EXISTS (
    SELECT 1 FROM public.hse_memberships reviewer
    JOIN public.hse_memberships subject ON subject.team_leader_id = reviewer.id
    WHERE reviewer.active AND subject.active AND reviewer.role = 'team_leader'
      AND (reviewer.user_id = _user_id OR public.employee_user_id(reviewer.employee_id) = _user_id)
      AND subject.employee_id = _employee_id
  )
$$;

REVOKE ALL ON FUNCTION public.hse_is_manager(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hse_is_staff(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hse_can_review_report(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hse_is_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hse_is_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hse_can_review_report(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.hse_can_submit_kind(_user_id uuid, _kind text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.hse_is_manager(_user_id) OR EXISTS (
    SELECT 1 FROM public.hse_memberships m
    WHERE m.active AND (m.user_id = _user_id OR public.employee_user_id(m.employee_id) = _user_id)
      AND ((_kind = 'hse' AND m.role IN ('officer', 'team_leader'))
        OR (_kind = 'permit_authorizer' AND m.role = 'permit_authorizer'))
  )
$$;
CREATE OR REPLACE FUNCTION public.hse_can_manage_department(_user_id uuid, _department_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'admin') OR public.has_role(_user_id, 'hr') OR (
    (public.has_role(_user_id, 'department_manager') OR public.has_role(_user_id, 'supervisor'))
    AND public.can_access_department(_user_id, _department_id)
  )
$$;
REVOKE ALL ON FUNCTION public.hse_can_submit_kind(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hse_can_manage_department(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hse_can_submit_kind(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hse_can_manage_department(uuid, uuid) TO authenticated;

CREATE POLICY hse_memberships_read ON public.hse_memberships FOR SELECT TO authenticated
  USING (public.hse_is_manager(auth.uid()) OR user_id = auth.uid()
    OR employee_id = public.current_employee_id());
CREATE POLICY hse_memberships_manage ON public.hse_memberships FOR ALL TO authenticated
  USING (public.hse_is_manager(auth.uid())) WITH CHECK (public.hse_is_manager(auth.uid()));

CREATE TABLE public.hse_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
  work_date date NOT NULL DEFAULT CURRENT_DATE,
  shift text NOT NULL CHECK (shift IN ('day', 'night')),
  workforce_count integer NOT NULL DEFAULT 0 CHECK (workforce_count >= 0),
  permit_count integer NOT NULL DEFAULT 0 CHECK (permit_count >= 0),
  report_kind text NOT NULL CHECK (report_kind IN ('hse', 'permit_authorizer')),
  notes text,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'needs_changes')),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, site_id, work_date, shift, report_kind)
);
CREATE INDEX hse_reports_day_site_idx ON public.hse_reports(work_date DESC, site_id, shift);
CREATE INDEX hse_reports_employee_idx ON public.hse_reports(employee_id, work_date DESC);
ALTER TABLE public.hse_reports ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.hse_reports TO authenticated;
GRANT ALL ON public.hse_reports TO service_role;
CREATE POLICY hse_reports_read ON public.hse_reports FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.hse_can_review_report(auth.uid(), employee_id));
CREATE POLICY hse_reports_create ON public.hse_reports FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND employee_id = public.current_employee_id()
    AND public.hse_can_submit_kind(auth.uid(), report_kind));
CREATE POLICY hse_reports_review ON public.hse_reports FOR UPDATE TO authenticated
  USING (public.hse_can_review_report(auth.uid(), employee_id))
  WITH CHECK (public.hse_can_review_report(auth.uid(), employee_id));

CREATE TABLE public.hse_report_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.hse_reports(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  item_label text NOT NULL CHECK (char_length(trim(item_label)) BETWEEN 2 AND 240),
  result text NOT NULL CHECK (result IN ('compliant', 'issue', 'not_applicable')),
  issue_description text,
  corrective_action text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, item_key),
  CHECK (result <> 'issue' OR char_length(trim(coalesce(issue_description, ''))) >= 3)
);
CREATE INDEX hse_report_items_report_idx ON public.hse_report_items(report_id);
ALTER TABLE public.hse_report_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.hse_report_items TO authenticated;
GRANT ALL ON public.hse_report_items TO service_role;
CREATE POLICY hse_report_items_read ON public.hse_report_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.hse_reports r WHERE r.id = report_id
    AND (r.created_by = auth.uid() OR public.hse_can_review_report(auth.uid(), r.employee_id))));
CREATE POLICY hse_report_items_create ON public.hse_report_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.hse_reports r WHERE r.id = report_id
    AND r.created_by = auth.uid()));

CREATE TABLE public.hse_report_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.hse_reports(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL CHECK (char_length(file_name) <= 255),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hse_report_attachments_report_idx ON public.hse_report_attachments(report_id);
ALTER TABLE public.hse_report_attachments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.hse_report_attachments TO authenticated;
GRANT ALL ON public.hse_report_attachments TO service_role;
CREATE POLICY hse_attachments_read ON public.hse_report_attachments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.hse_reports r WHERE r.id = report_id
    AND (r.created_by = auth.uid() OR public.hse_can_review_report(auth.uid(), r.employee_id))));
CREATE POLICY hse_attachments_create ON public.hse_report_attachments FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND EXISTS (
    SELECT 1 FROM public.hse_reports r WHERE r.id = report_id AND r.created_by = auth.uid()));
CREATE POLICY hse_attachments_delete ON public.hse_report_attachments FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.hse_is_manager(auth.uid()));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('hse-report-photos', 'hse-report-photos', false, 8388608, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;
CREATE POLICY hse_report_photo_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'hse-report-photos' AND public.hse_is_staff(auth.uid())
    AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY hse_report_photo_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'hse-report-photos' AND (
    (storage.foldername(name))[1] = auth.uid()::text OR public.hse_is_manager(auth.uid())
    OR EXISTS (SELECT 1 FROM public.hse_reports r
      WHERE r.id::text = (storage.foldername(name))[2]
        AND public.hse_can_review_report(auth.uid(), r.employee_id))
  ));
CREATE POLICY hse_report_photo_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'hse-report-photos' AND (
    (storage.foldername(name))[1] = auth.uid()::text OR public.hse_is_manager(auth.uid())
  ));

CREATE TABLE public.hse_risks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_item_id uuid NOT NULL UNIQUE REFERENCES public.hse_report_items(id) ON DELETE CASCADE,
  assigned_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  due_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'closed')),
  closure_note text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hse_risks_status_due_idx ON public.hse_risks(status, due_date);
ALTER TABLE public.hse_risks ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.hse_risks TO authenticated;
GRANT ALL ON public.hse_risks TO service_role;
CREATE POLICY hse_risks_read ON public.hse_risks FOR SELECT TO authenticated
  USING (public.hse_is_manager(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.hse_report_items i JOIN public.hse_reports r ON r.id = i.report_id
    WHERE i.id = report_item_id AND r.created_by = auth.uid()));
CREATE POLICY hse_risks_create ON public.hse_risks FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.hse_report_items i JOIN public.hse_reports r ON r.id = i.report_id
    WHERE i.id = report_item_id AND r.created_by = auth.uid()));
CREATE POLICY hse_risks_update ON public.hse_risks FOR UPDATE TO authenticated
  USING (public.hse_is_manager(auth.uid())) WITH CHECK (public.hse_is_manager(auth.uid()));

CREATE TABLE public.hse_score_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  score_month date NOT NULL CHECK (extract(day FROM score_month) = 1),
  points integer NOT NULL CHECK (points BETWEEN -100 AND 100 AND points <> 0),
  reason text NOT NULL CHECK (char_length(trim(reason)) BETWEEN 3 AND 500),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hse_score_events_month_idx ON public.hse_score_events(score_month, employee_id);
ALTER TABLE public.hse_score_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.hse_score_events TO authenticated;
GRANT ALL ON public.hse_score_events TO service_role;
CREATE POLICY hse_scores_read ON public.hse_score_events FOR SELECT TO authenticated
  USING (public.hse_is_manager(auth.uid()) OR employee_id = public.current_employee_id());
CREATE POLICY hse_scores_create ON public.hse_score_events FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.hse_is_manager(auth.uid()));

CREATE TABLE public.department_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no bigint GENERATED BY DEFAULT AS IDENTITY UNIQUE,
  subject text NOT NULL CHECK (char_length(trim(subject)) BETWEEN 3 AND 200),
  details text NOT NULL CHECK (char_length(trim(details)) BETWEEN 3 AND 5000),
  source_department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  target_department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'closed')),
  due_at timestamptz,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX department_tickets_target_idx ON public.department_tickets(target_department_id, status, created_at DESC);
CREATE INDEX department_tickets_creator_idx ON public.department_tickets(created_by, created_at DESC);
ALTER TABLE public.department_tickets ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.department_tickets TO authenticated;
GRANT ALL ON public.department_tickets TO service_role;
CREATE POLICY department_tickets_read ON public.department_tickets FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR assigned_to = auth.uid()
    OR public.can_access_department(auth.uid(), target_department_id));
CREATE POLICY department_tickets_create ON public.department_tickets FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND (source_department_id IS NULL
    OR public.can_access_department(auth.uid(), source_department_id)));
CREATE POLICY department_tickets_update ON public.department_tickets FOR UPDATE TO authenticated
  USING (assigned_to = auth.uid() OR public.hse_can_manage_department(auth.uid(), target_department_id))
  WITH CHECK (assigned_to = auth.uid() OR public.hse_can_manage_department(auth.uid(), target_department_id));

CREATE TABLE public.department_ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.department_tickets(id) ON DELETE CASCADE,
  author_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  message text NOT NULL CHECK (char_length(trim(message)) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX department_ticket_messages_ticket_idx ON public.department_ticket_messages(ticket_id, created_at);
ALTER TABLE public.department_ticket_messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.department_ticket_messages TO authenticated;
GRANT ALL ON public.department_ticket_messages TO service_role;
CREATE POLICY department_ticket_messages_read ON public.department_ticket_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.department_tickets t WHERE t.id = ticket_id));
CREATE POLICY department_ticket_messages_create ON public.department_ticket_messages FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.department_tickets t WHERE t.id = ticket_id
      AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid()
        OR public.can_access_department(auth.uid(), t.target_department_id))));

CREATE TABLE public.violation_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 3 AND 200),
  details text NOT NULL CHECK (char_length(trim(details)) BETWEEN 3 AND 5000),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  anonymous boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'closed')),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX violation_reports_dept_idx ON public.violation_reports(department_id, status, created_at DESC);
ALTER TABLE public.violation_reports ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.violation_reports TO authenticated;
GRANT ALL ON public.violation_reports TO service_role;
CREATE POLICY violation_reports_read ON public.violation_reports FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr')
    OR public.can_access_department(auth.uid(), department_id));
CREATE POLICY violation_reports_create ON public.violation_reports FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY violation_reports_update ON public.violation_reports FOR UPDATE TO authenticated
  USING (public.hse_can_manage_department(auth.uid(), department_id))
  WITH CHECK (public.hse_can_manage_department(auth.uid(), department_id));

CREATE OR REPLACE FUNCTION public.set_hse_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER hse_memberships_updated_at BEFORE UPDATE ON public.hse_memberships
  FOR EACH ROW EXECUTE FUNCTION public.set_hse_updated_at();
CREATE TRIGGER hse_reports_updated_at BEFORE UPDATE ON public.hse_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_hse_updated_at();
CREATE TRIGGER department_tickets_updated_at BEFORE UPDATE ON public.department_tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_hse_updated_at();
CREATE TRIGGER violation_reports_updated_at BEFORE UPDATE ON public.violation_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_hse_updated_at();
