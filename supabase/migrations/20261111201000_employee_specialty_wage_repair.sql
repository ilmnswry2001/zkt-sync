-- Apply once. Previous employee values are retained in the protected repair audit; payroll runs are not reopened.
BEGIN;
CREATE OR REPLACE FUNCTION public.normalize_payroll_specialty(p_title text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT trim(regexp_replace(regexp_replace(regexp_replace(translate(lower(COALESCE(p_title,'')),'أإآٱى','ااااي'),'[ًٌٍَُِّْٰـ]','','g'),'[^[:alnum:]]+',' ','g'),'(^| )ال','\1','g'));
$$;
CREATE TABLE public.payroll_employee_wage_repair_audit (
 employee_id uuid PRIMARY KEY REFERENCES public.employees(id),previous_pay_type text,previous_wage_rate_id uuid,
 new_pay_type text,new_wage_rate_id uuid,repaired_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payroll_employee_wage_repair_audit ENABLE ROW LEVEL SECURITY;
WITH wage_candidates AS (
 SELECT e.id AS employee_id,w.id AS wage_id,
 CASE WHEN public.normalize_payroll_specialty(e.position)=public.normalize_payroll_specialty(w.title) THEN 10000
 ELSE cardinality(string_to_array(public.normalize_payroll_specialty(w.title),' '))*100 END AS score
 FROM public.employees e JOIN public.wage_rates w ON w.currency='IQD' AND (w.daily_rate>0 OR w.monthly_rate>0)
 WHERE e.status='active' AND e.wage_rate_id IS NULL AND public.normalize_payroll_specialty(w.title)<>''
 AND string_to_array(public.normalize_payroll_specialty(e.position),' ') @> string_to_array(public.normalize_payroll_specialty(w.title),' ')
), best AS (SELECT employee_id,max(score) AS score FROM wage_candidates GROUP BY employee_id), matches AS (
 SELECT c.employee_id,(array_agg(c.wage_id))[1] AS wage_id FROM wage_candidates c JOIN best b ON b.employee_id=c.employee_id AND b.score=c.score GROUP BY c.employee_id HAVING count(*)=1
), repairs AS (
 SELECT e.id,e.pay_type,e.wage_rate_id,m.wage_id,
 CASE WHEN e.salary_type::text ILIKE '%daily%' OR e.salary_type::text LIKE '%يومي%'
 OR public.normalize_payroll_specialty(e.position) ~ '(^| )(ريكر|ريكور|مسعف|اسعاف|انقاذ|منقذ|عامل|نجار|كوسرجي|حداد|سقالات|صباغ|فابريكيشن)[[:alpha:]]*( |$)'
 OR EXISTS(SELECT 1 FROM public.wage_rates w WHERE w.id=COALESCE(e.wage_rate_id,m.wage_id) AND w.daily_rate>0 AND COALESCE(w.monthly_rate,0)<=0)
 THEN 'daily' ELSE e.pay_type END AS resolved_type
 FROM public.employees e LEFT JOIN matches m ON m.employee_id=e.id
)
INSERT INTO public.payroll_employee_wage_repair_audit(employee_id,previous_pay_type,previous_wage_rate_id,new_pay_type,new_wage_rate_id)
SELECT r.id,r.pay_type,r.wage_rate_id,r.resolved_type,COALESCE(r.wage_rate_id,r.wage_id) FROM repairs r
WHERE r.pay_type IS DISTINCT FROM r.resolved_type OR (r.wage_rate_id IS NULL AND r.wage_id IS NOT NULL);
UPDATE public.employees e SET pay_type=a.new_pay_type,wage_rate_id=a.new_wage_rate_id
FROM public.payroll_employee_wage_repair_audit a WHERE a.employee_id=e.id;
SELECT count(*) AS repaired_employees FROM public.payroll_employee_wage_repair_audit;
COMMIT;
