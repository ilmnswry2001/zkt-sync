-- ERP core foundation
-- This migration creates foundation tables for module access, permissions, and audit governance.

create table if not exists erp_roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists erp_permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists erp_role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_code text not null references erp_roles(code) on delete cascade,
  permission_code text not null references erp_permissions(code) on delete cascade,
  created_at timestamptz not null default now(),
  unique(role_code, permission_code)
);

create table if not exists erp_module_registry (
  id uuid primary key default gen_random_uuid(),
  module_key text not null unique,
  module_name_ar text not null,
  path text not null unique,
  permission_code text references erp_permissions(code),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  action text not null,
  module_name text not null,
  record_id text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now(),
  metadata jsonb default '{}'::jsonb
);

create index if not exists audit_logs_user_id_idx on audit_logs(user_id);
create index if not exists audit_logs_module_name_idx on audit_logs(module_name);
create index if not exists audit_logs_created_at_idx on audit_logs(created_at desc);

-- Default roles
insert into erp_roles (code, label, description)
values
  ('admin', 'مدير النظام', 'إدارة كاملة للنظام')
on conflict (code) do nothing;

insert into erp_roles (code, label, description)
values
  ('hr', 'موارد بشرية', 'إدارة الموظفين والحضور والإجازات والرواتب')
on conflict (code) do nothing;

insert into erp_roles (code, label, description)
values
  ('supervisor', 'مشرف', 'إدارة الفريق والمشاريع')
on conflict (code) do nothing;

insert into erp_roles (code, label, description)
values
  ('data_entry', 'إدخال بيانات', 'إدخال البيانات ومراجعتها')
on conflict (code) do nothing;

insert into erp_roles (code, label, description)
values
  ('site_admin', 'إداري موقع', 'إدارة الموقع والتقارير والمشتغلين')
on conflict (code) do nothing;

insert into erp_roles (code, label, description)
values
  ('department_manager', 'مدير قسم', 'إدارة القسم والمهام والتوجيهات')
on conflict (code) do nothing;

insert into erp_roles (code, label, description)
values
  ('engineer', 'مهندس', 'إدارة الخطة الفنية والمشروع')
on conflict (code) do nothing;

insert into erp_roles (code, label, description)
values
  ('ceo', 'مدير الشركة', 'عرض الإدارة العليا والتقارير')
on conflict (code) do nothing;

-- Default permissions
insert into erp_permissions (code, label, description)
values
  ('dashboard.view', 'رؤية لوحة التحكم', 'عرض مقاييس لوحة التحكم')
on conflict (code) do nothing;

insert into erp_permissions (code, label, description)
values
  ('employees.view', 'رؤية الموظفين', 'عرض سجلات الموظفين')
on conflict (code) do nothing;

insert into erp_permissions (code, label, description)
values
  ('attendance.view', 'رؤية الحضور', 'عرض بيانات الحضور والانصراف')
on conflict (code) do nothing;

insert into erp_permissions (code, label, description)
values
  ('departments.view', 'رؤية الأقسام', 'عرض أقسام الشركة')
on conflict (code) do nothing;

insert into erp_permissions (code, label, description)
values
  ('tasks.view', 'رؤية المهام', 'عرض المهام والملاحظات')
on conflict (code) do nothing;

insert into erp_permissions (code, label, description)
values
  ('projects.view', 'رؤية المشاريع', 'عرض المشروعات والتكاليف')
on conflict (code) do nothing;

insert into erp_permissions (code, label, description)
values
  ('sites.view', 'رؤية المواقع', 'عرض المواقع والمحطات')
on conflict (code) do nothing;

insert into erp_permissions (code, label, description)
values
  ('workforce.view', 'رؤية العمالة', 'عرض العمالة والعملاء والمجموعات')
on conflict (code) do nothing;

insert into erp_permissions (code, label, description)
values
  ('payroll.view', 'رؤية الرواتب', 'عرض الرواتب وشاشات المكافآت والخصومات')
on conflict (code) do nothing;

insert into erp_permissions (code, label, description)
values
  ('expenses.view', 'رؤية المصاريف', 'عرض المصاريف والموافقات')
on conflict (code) do nothing;

insert into erp_permissions (code, label, description)
values
  ('reports.view', 'رؤية التقارير', 'عرض تقارير الإدارة والمواقع')
on conflict (code) do nothing;

insert into erp_permissions (code, label, description)
values
  ('users.manage', 'إدارة المستخدمين', 'إدارة الحسابات والأدوار')
on conflict (code) do nothing;

insert into erp_permissions (code, label, description)
values
  ('settings.manage', 'إدارة الإعدادات', 'تعديل إعدادات النظام')
on conflict (code) do nothing;

-- Register core modules
insert into erp_module_registry (module_key, module_name_ar, path, permission_code)
values
  ('dashboard', 'لوحة التحكم', '/dashboard', 'dashboard.view')
on conflict (module_key) do nothing;

insert into erp_module_registry (module_key, module_name_ar, path, permission_code)
values
  ('employees', 'الموظفون', '/employees', 'employees.view')
on conflict (module_key) do nothing;

insert into erp_module_registry (module_key, module_name_ar, path, permission_code)
values
  ('attendance', 'الحضور والانصراف', '/attendance', 'attendance.view')
on conflict (module_key) do nothing;

insert into erp_module_registry (module_key, module_name_ar, path, permission_code)
values
  ('departments', 'الأقسام', '/departments', 'departments.view')
on conflict (module_key) do nothing;

insert into erp_module_registry (module_key, module_name_ar, path, permission_code)
values
  ('tasks', 'المهام', '/tasks', 'tasks.view')
on conflict (module_key) do nothing;

insert into erp_module_registry (module_key, module_name_ar, path, permission_code)
values
  ('projects', 'المشاريع', '/projects', 'projects.view')
on conflict (module_key) do nothing;

insert into erp_module_registry (module_key, module_name_ar, path, permission_code)
values
  ('sites', 'المواقع', '/sites', 'sites.view')
on conflict (module_key) do nothing;

insert into erp_module_registry (module_key, module_name_ar, path, permission_code)
values
  ('payroll', 'الرواتب', '/payroll', 'payroll.view')
on conflict (module_key) do nothing;

insert into erp_module_registry (module_key, module_name_ar, path, permission_code)
values
  ('expenses', 'المصاريف', '/expenses', 'expenses.view')
on conflict (module_key) do nothing;

insert into erp_module_registry (module_key, module_name_ar, path, permission_code)
values
  ('reports', 'التقارير', '/reports', 'reports.view')
on conflict (module_key) do nothing;

insert into erp_module_registry (module_key, module_name_ar, path, permission_code)
values
  ('accounts', 'إدارة المستخدمين', '/accounts', 'users.manage')
on conflict (module_key) do nothing;

insert into erp_module_registry (module_key, module_name_ar, path, permission_code)
values
  ('settings', 'الإعدادات', '/settings', 'settings.manage')
on conflict (module_key) do nothing;
