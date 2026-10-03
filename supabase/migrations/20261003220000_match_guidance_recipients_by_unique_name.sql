-- Allow delivery when a uniquely named employee account lacks a matching email.
DROP POLICY IF EXISTS "Department managers send scoped guidance"
  ON public.employee_guidance_notes;

CREATE POLICY "Department managers send scoped guidance"
  ON public.employee_guidance_notes FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND public.has_role(auth.uid(), 'department_manager')
    AND public.can_access_department(auth.uid(), department_id)
    AND EXISTS (
      SELECT 1
      FROM public.employees AS employee
      JOIN public.profiles AS profile ON profile.id = target_user_id
      WHERE employee.id = target_employee_id
        AND employee.department_id = employee_guidance_notes.department_id
        AND employee.status = 'active'
        AND (
          nullif(trim(profile.email), '') IS NOT NULL
          AND lower(trim(profile.email)) = lower(trim(employee.email))
          OR (
            lower(regexp_replace(translate(trim(coalesce(profile.full_name, '')), 'أإآىة', 'ااايه'), '\s+', ' ', 'g')) <> ''
            AND lower(regexp_replace(translate(trim(profile.full_name), 'أإآىة', 'ااايه'), '\s+', ' ', 'g'))
              = lower(regexp_replace(translate(trim(employee.full_name), 'أإآىة', 'ااايه'), '\s+', ' ', 'g'))
            AND (
              SELECT count(*)
              FROM public.employees AS same_name_employee
              WHERE same_name_employee.status = 'active'
                AND same_name_employee.department_id = employee.department_id
                AND lower(regexp_replace(translate(trim(same_name_employee.full_name), 'أإآىة', 'ااايه'), '\s+', ' ', 'g'))
                  = lower(regexp_replace(translate(trim(employee.full_name), 'أإآىة', 'ااايه'), '\s+', ' ', 'g'))
            ) = 1
            AND (
              SELECT count(*)
              FROM public.profiles AS same_name_profile
              WHERE lower(regexp_replace(translate(trim(coalesce(same_name_profile.full_name, '')), 'أإآىة', 'ااايه'), '\s+', ' ', 'g'))
                = lower(regexp_replace(translate(trim(profile.full_name), 'أإآىة', 'ااايه'), '\s+', ' ', 'g'))
            ) = 1
          )
        )
    )
  );
