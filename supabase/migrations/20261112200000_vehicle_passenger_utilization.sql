ALTER TABLE public.vehicles ADD COLUMN passenger_capacity integer CHECK(passenger_capacity BETWEEN 1 AND 100);
COMMENT ON COLUMN public.vehicles.passenger_capacity IS 'Passenger seats only; excludes the separately assigned driver.';
CREATE TABLE public.vehicle_passenger_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
 employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
 starts_on date NOT NULL,ends_on date,CHECK(ends_on IS NULL OR ends_on>=starts_on),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vehicle_passenger_dates_idx ON public.vehicle_passenger_assignments(vehicle_id,starts_on,ends_on);
CREATE INDEX vehicle_passenger_employee_idx ON public.vehicle_passenger_assignments(employee_id,starts_on);
ALTER TABLE public.vehicle_passenger_assignments ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON public.vehicle_passenger_assignments TO authenticated;
CREATE POLICY "read vehicle passengers" ON public.vehicle_passenger_assignments FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.vehicles v WHERE v.id=vehicle_id));
CREATE POLICY "manage vehicle passengers" ON public.vehicle_passenger_assignments FOR ALL TO authenticated
 USING(public.is_admin(auth.uid()) OR public.has_role(auth.uid(),'hr')) WITH CHECK(public.is_admin(auth.uid()) OR public.has_role(auth.uid(),'hr'));
-- Serialize passenger/driver/capacity edits, including across different vehicles.
CREATE FUNCTION public.validate_vehicle_passengers() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_vehicle public.vehicles%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(74123001);
 IF TG_OP='UPDATE' THEN
  IF NEW.vehicle_id<>OLD.vehicle_id OR NEW.employee_id<>OLD.employee_id OR NEW.starts_on<>OLD.starts_on THEN RAISE EXCEPTION 'هوية التنسيب وبدايته ثابتتان؛ أنهِ التنسيب وأضف تنسيباً جديداً'; END IF;
  IF NEW.ends_on IS NOT NULL AND (OLD.ends_on IS NULL OR NEW.ends_on<=OLD.ends_on) THEN RETURN NEW; END IF;
 END IF;
 SELECT * INTO v_vehicle FROM public.vehicles WHERE id=NEW.vehicle_id;
 IF v_vehicle.vehicle_class<>'light' OR NOT v_vehicle.is_active OR v_vehicle.passenger_capacity IS NULL THEN RAISE EXCEPTION 'حدد مقاعد الركاب لمركبة خفيفة نشطة أولاً'; END IF;
 IF EXISTS(SELECT 1 FROM public.vehicle_passenger_assignments a WHERE a.employee_id=NEW.employee_id AND a.id<>NEW.id AND daterange(a.starts_on,a.ends_on,'[]') && daterange(NEW.starts_on,NEW.ends_on,'[]')) THEN RAISE EXCEPTION 'الموظف منسب إلى مركبة خلال هذه الفترة'; END IF;
 IF v_vehicle.current_driver_id=NEW.employee_id AND (NEW.ends_on IS NULL OR NEW.ends_on>=(now() AT TIME ZONE 'Asia/Baghdad')::date) THEN RAISE EXCEPTION 'السائق معيّن بشكل مستقل ولا يشغل مقعد راكب'; END IF;
 IF EXISTS(
  SELECT 1 FROM (SELECT NEW.starts_on AS day UNION SELECT a.starts_on FROM public.vehicle_passenger_assignments a WHERE a.vehicle_id=NEW.vehicle_id AND a.id<>NEW.id AND daterange(NEW.starts_on,NEW.ends_on,'[]') @> a.starts_on) dates
  WHERE (SELECT count(*) FROM public.vehicle_passenger_assignments a WHERE a.vehicle_id=NEW.vehicle_id AND a.id<>NEW.id AND daterange(a.starts_on,a.ends_on,'[]') @> dates.day)>=v_vehicle.passenger_capacity
 ) THEN RAISE EXCEPTION 'عدد المنسبين يتجاوز مقاعد الركاب خلال الفترة المختارة'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.validate_vehicle_passengers() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER validate_vehicle_passengers BEFORE INSERT OR UPDATE ON public.vehicle_passenger_assignments FOR EACH ROW EXECUTE FUNCTION public.validate_vehicle_passengers();
CREATE FUNCTION public.validate_vehicle_seats_driver() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(74123001);
 IF NEW.current_driver_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.current_driver_id IS DISTINCT FROM OLD.current_driver_id) THEN
  IF EXISTS(SELECT 1 FROM public.vehicle_passenger_assignments a WHERE a.vehicle_id=NEW.id AND a.employee_id=NEW.current_driver_id AND (a.ends_on IS NULL OR a.ends_on>=(now() AT TIME ZONE 'Asia/Baghdad')::date)) THEN RAISE EXCEPTION 'السائق منسب كراكب على المركبة نفسها؛ أنهِ تنسيبه كراكب أولاً'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.vehicle_passenger_assignments a WHERE a.vehicle_id=NEW.id AND (a.ends_on IS NULL OR a.ends_on>=(now() AT TIME ZONE 'Asia/Baghdad')::date)) THEN
  IF NEW.vehicle_class<>'light' OR NEW.passenger_capacity IS NULL OR EXISTS(
   SELECT 1 FROM public.vehicle_passenger_assignments point WHERE point.vehicle_id=NEW.id
    AND (SELECT count(*) FROM public.vehicle_passenger_assignments a WHERE a.vehicle_id=NEW.id AND daterange(a.starts_on,a.ends_on,'[]') @> greatest(point.starts_on,(now() AT TIME ZONE 'Asia/Baghdad')::date))>NEW.passenger_capacity
  ) THEN RAISE EXCEPTION 'السعة الجديدة لا تكفي للتنسيبات الحالية أو المستقبلية'; END IF;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.validate_vehicle_seats_driver() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER validate_vehicle_seats_driver BEFORE INSERT OR UPDATE OF passenger_capacity,current_driver_id,vehicle_class ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.validate_vehicle_seats_driver();
CREATE FUNCTION public.vehicle_passenger_attendance(p_day date)
RETURNS TABLE(vehicle_id uuid,employee_id uuid,full_name text,employee_no text,active_assignment_id uuid,assigned boolean,week_days integer,month_days integer,present_today boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 WITH roster AS (
 SELECT a.*,e.full_name,e.employee_no,daterange(a.starts_on,a.ends_on,'[]') @> p_day AS active
 FROM public.vehicle_passenger_assignments a JOIN public.employees e ON e.id=a.employee_id
 WHERE auth.uid() IS NOT NULL AND a.starts_on<=p_day AND (a.ends_on IS NULL OR a.ends_on>=p_day-29)
 ), punched AS (
 SELECT DISTINCT l.employee_id,(l.verify_time AT TIME ZONE 'Asia/Baghdad')::date AS day FROM public.attendance_logs l
 WHERE l.employee_id IS NOT NULL AND l.is_suspicious IS NOT TRUE AND l.verify_time>=((p_day-29)::timestamp AT TIME ZONE 'Asia/Baghdad') AND l.verify_time<((p_day+1)::timestamp AT TIME ZONE 'Asia/Baghdad')
 )
 SELECT r.vehicle_id,r.employee_id,r.full_name::text,r.employee_no::text,
 (array_agg(DISTINCT r.id) FILTER(WHERE r.active))[1],bool_or(r.active),
 count(DISTINCT p.day) FILTER(WHERE p.day>=p_day-6)::integer,count(DISTINCT p.day)::integer,
 COALESCE(bool_or(p.day=p_day),false)
 FROM roster r LEFT JOIN punched p ON p.employee_id=r.employee_id AND daterange(r.starts_on,r.ends_on,'[]') @> p.day
 GROUP BY r.vehicle_id,r.employee_id,r.full_name,r.employee_no ORDER BY r.vehicle_id,r.employee_id;
$$;
REVOKE ALL ON FUNCTION public.vehicle_passenger_attendance(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vehicle_passenger_attendance(date) TO authenticated;
