-- Apply schema/functions first. This migration never reopens a payroll automatically.
ALTER TABLE public.employee_advance_installments ADD COLUMN deducted_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK(deducted_amount >= 0 AND deducted_amount <= amount);
UPDATE public.employee_advance_installments SET deducted_amount=amount WHERE status='deducted';
CREATE TABLE public.payroll_recalculation_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL REFERENCES public.payroll_runs(id),
 actor_id uuid REFERENCES auth.users(id),transaction_id bigint NOT NULL,completed boolean NOT NULL DEFAULT false,
 previous_run jsonb NOT NULL,previous_lines jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payroll_recalculation_audit ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.payroll_recalculation_audit TO authenticated;
CREATE POLICY "payroll operators read recalculation audit" ON public.payroll_recalculation_audit FOR SELECT TO authenticated
USING(public.is_admin(auth.uid()) OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'accountant') OR public.has_form_role(auth.uid(),'ceo'));
CREATE FUNCTION public.in_payroll_recalculation(p_run uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.payroll_recalculation_audit a WHERE a.run_id=p_run AND a.actor_id=auth.uid() AND a.transaction_id=txid_current() AND NOT a.completed);
$$;
REVOKE ALL ON FUNCTION public.in_payroll_recalculation(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.enforce_payroll_run_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' OR NOT (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'accountant')) THEN
      RAISE EXCEPTION 'Only HR or accounting can remove a draft payroll run';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NOT (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'accountant')) THEN
      RAISE EXCEPTION 'Only HR can create a draft payroll run';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'approved' AND NEW.status = 'draft' AND public.in_payroll_recalculation(OLD.id) THEN RETURN NEW; END IF;
  IF NEW.status = 'review' AND public.in_payroll_recalculation(OLD.id) THEN RETURN NEW; END IF;
  IF OLD.status = 'paid' OR (OLD.status = 'approved' AND NEW.status <> 'paid') THEN
    RAISE EXCEPTION 'Approved or paid payroll runs are immutable';
  END IF;
  IF NEW.status = 'review' AND NOT (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'accountant')) THEN
    RAISE EXCEPTION 'Only HR can submit payroll for review';
  END IF;
  IF NEW.status = 'approved' AND NOT (public.is_admin(auth.uid()) OR public.has_form_role(auth.uid(), 'ceo')) THEN
    RAISE EXCEPTION 'Only the company manager can approve payroll';
  END IF;
  IF NEW.status = 'paid' AND NOT (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'accountant')) THEN
    RAISE EXCEPTION 'Only HR can record payroll payment';
  END IF;
  IF NEW.status = 'approved' AND OLD.status <> 'review' THEN
    RAISE EXCEPTION 'Payroll must be reviewed before approval';
  END IF;
  IF NEW.status = 'paid' AND (OLD.status <> 'approved' OR NEW.payment_method IS NULL) THEN
    RAISE EXCEPTION 'Payroll must be approved and have a payment method before payment';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_payroll_run_line_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.payroll_run_id ELSE NEW.payroll_run_id END;
  v_status text;
BEGIN
  IF public.in_payroll_recalculation(v_run_id) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
  IF NOT (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'accountant')) THEN
    RAISE EXCEPTION 'Only HR or accounting can edit payroll run lines';
  END IF;
  SELECT status INTO v_status FROM public.payroll_runs WHERE id = v_run_id;
  IF v_status IS NULL OR v_status IN ('approved', 'paid') THEN
    RAISE EXCEPTION 'Payroll lines cannot be edited after approval';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_payroll_from_specialties(p_run uuid,p_lines jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_run public.payroll_runs%ROWTYPE; v_audit uuid; v_line jsonb; v_employee uuid; v_net numeric; v_deduction numeric; v_remaining numeric; v_allocations jsonb; v_installment record; v_total numeric:=0;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.is_admin(auth.uid()) OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'accountant') OR public.has_form_role(auth.uid(),'ceo')) THEN RAISE EXCEPTION 'Not authorized'; END IF;
 SELECT * INTO v_run FROM public.payroll_runs WHERE id=p_run FOR UPDATE;
 IF NOT FOUND OR v_run.status='paid' THEN RAISE EXCEPTION 'Paid or missing payroll cannot be recalculated'; END IF;
 IF p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)=0 THEN RAISE EXCEPTION 'Payroll lines required'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_lines))<>(SELECT count(DISTINCT x->>'employee_id') FROM jsonb_array_elements(p_lines) x) THEN RAISE EXCEPTION 'Duplicate employee'; END IF;
 IF EXISTS(SELECT 1 FROM public.payroll_run_lines old WHERE old.payroll_run_id=p_run AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_lines) x WHERE x->>'employee_id'=old.employee_id::text)) THEN RAISE EXCEPTION 'All saved employees must be recalculated'; END IF;
 INSERT INTO public.payroll_recalculation_audit(run_id,actor_id,transaction_id,previous_run,previous_lines)
 VALUES(p_run,auth.uid(),txid_current(),to_jsonb(v_run),COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM public.payroll_run_lines l WHERE l.payroll_run_id=p_run),'[]')) RETURNING id INTO v_audit;
 UPDATE public.payroll_runs SET status='draft',approved_by=NULL,reviewed_by=NULL WHERE id=p_run;
 DELETE FROM public.payroll_run_lines WHERE payroll_run_id=p_run;
 FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  v_employee:=(v_line->>'employee_id')::uuid;
  IF EXISTS(SELECT 1 FROM jsonb_each_text(v_line) kv WHERE kv.key IN ('base_amount','overtime_hours','overtime_amount','additions_amount','deductions_amount') AND (kv.value IS NULL OR kv.value::numeric<0 OR kv.value IN ('NaN','Infinity','-Infinity'))) THEN RAISE EXCEPTION 'Invalid payroll amount'; END IF;
  v_net:=greatest(0,COALESCE((v_line->>'base_amount')::numeric,0)+COALESCE((v_line->>'overtime_amount')::numeric,0)+COALESCE((v_line->>'additions_amount')::numeric,0)-COALESCE((v_line->>'deductions_amount')::numeric,0));
  v_remaining:=v_net; v_deduction:=0; v_allocations:='[]';
  FOR v_installment IN SELECT i.* FROM public.employee_advance_installments i JOIN public.employee_advances a ON a.id=i.advance_id
   WHERE a.employee_id=v_employee AND a.status='active' AND i.month=v_run.month AND i.status='scheduled' ORDER BY i.id FOR UPDATE OF i
  LOOP
   IF v_remaining<=0 THEN EXIT; END IF;
   v_deduction:=least(v_remaining,v_installment.amount-v_installment.deducted_amount);
   IF v_deduction>0 THEN v_allocations:=v_allocations||jsonb_build_array(jsonb_build_object('id',v_installment.id,'amount',v_deduction)); v_remaining:=v_remaining-v_deduction; END IF;
  END LOOP;
  INSERT INTO public.payroll_run_lines(payroll_run_id,employee_id,base_amount,overtime_hours,overtime_amount,additions_amount,deductions_amount,advance_deduction,net_amount,calculation_snapshot)
  VALUES(p_run,v_employee,COALESCE((v_line->>'base_amount')::numeric,0),COALESCE((v_line->>'overtime_hours')::numeric,0),COALESCE((v_line->>'overtime_amount')::numeric,0),COALESCE((v_line->>'additions_amount')::numeric,0),COALESCE((v_line->>'deductions_amount')::numeric,0),v_net-v_remaining,v_remaining,
   COALESCE(v_line->'calculation_snapshot','{}')||jsonb_build_object('advanceAllocations',v_allocations,'recalculationAuditId',v_audit));
  v_total:=v_total+v_remaining;
 END LOOP;
 UPDATE public.payroll_runs SET status='review',total_amount=v_total,reviewed_by=auth.uid() WHERE id=p_run;
 UPDATE public.payroll_recalculation_audit SET completed=true WHERE id=v_audit;
END; $$;
REVOKE ALL ON FUNCTION public.recalculate_payroll_from_specialties(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.recalculate_payroll_from_specialties(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.pay_payroll_with_advances(p_run uuid,p_method text,p_reference text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_run public.payroll_runs%ROWTYPE; v_line record; v_alloc jsonb; v_installment public.employee_advance_installments%ROWTYPE; v_sum numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.is_admin(auth.uid()) OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'accountant')) THEN RAISE EXCEPTION 'Not authorized'; END IF;
 SELECT * INTO v_run FROM public.payroll_runs WHERE id=p_run FOR UPDATE;
 IF NOT FOUND OR v_run.status<>'approved' OR p_method NOT IN ('cash','bank') OR p_method IS NULL THEN RAISE EXCEPTION 'Approved payroll and payment method required'; END IF;
 FOR v_line IN SELECT * FROM public.payroll_run_lines WHERE payroll_run_id=p_run ORDER BY employee_id LOOP
  v_sum:=0;
  FOR v_alloc IN SELECT value FROM jsonb_array_elements(COALESCE(v_line.calculation_snapshot->'advanceAllocations','[]')) LOOP
   SELECT i.* INTO v_installment FROM public.employee_advance_installments i JOIN public.employee_advances a ON a.id=i.advance_id
    WHERE i.id=(v_alloc->>'id')::uuid AND a.employee_id=v_line.employee_id AND a.status='active' AND i.month=v_run.month AND i.status='scheduled' FOR UPDATE OF i;
   IF NOT FOUND OR (v_alloc->>'amount')::numeric<=0 OR (v_alloc->>'amount')::numeric>v_installment.amount-v_installment.deducted_amount THEN RAISE EXCEPTION 'Installments changed; recalculate payroll before payment'; END IF;
   UPDATE public.employee_advance_installments SET deducted_amount=deducted_amount+(v_alloc->>'amount')::numeric,
    status=CASE WHEN deducted_amount+(v_alloc->>'amount')::numeric=amount THEN 'deducted' ELSE 'scheduled' END,payroll_run_id=p_run WHERE id=v_installment.id;
   v_sum:=v_sum+(v_alloc->>'amount')::numeric;
  END LOOP;
  IF v_sum<>v_line.advance_deduction THEN RAISE EXCEPTION 'Advance allocation does not match frozen payroll'; END IF;
 END LOOP;
 UPDATE public.employee_advances a SET status='settled'
 WHERE a.status='active' AND EXISTS(SELECT 1 FROM public.employee_advance_installments i WHERE i.advance_id=a.id AND i.payroll_run_id=p_run)
 AND NOT EXISTS(SELECT 1 FROM public.employee_advance_installments i WHERE i.advance_id=a.id AND i.status='scheduled' AND i.deducted_amount<i.amount);
 UPDATE public.payroll_runs SET status='paid',paid_by=auth.uid(),paid_at=now(),payment_method=p_method,payment_reference=p_reference WHERE id=p_run;
END; $$;
REVOKE ALL ON FUNCTION public.pay_payroll_with_advances(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pay_payroll_with_advances(uuid,text,text) TO authenticated;
