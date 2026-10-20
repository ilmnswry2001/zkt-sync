-- Maintenance department roles (manager + coordinator/admin).
-- Kept in its own migration so the new enum values are committed before the
-- module migration references them in functions and RLS policies.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'maintenance_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'maintenance_admin';
