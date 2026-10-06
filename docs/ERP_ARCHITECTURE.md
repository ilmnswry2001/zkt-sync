# ERP Architecture & Governance

## 1. Current Architecture

The existing app already follows a layered architecture:

- Frontend: TanStack Router + React + TypeScript + Tailwind + shadcn/ui
- Server logic: TanStack Start server functions and Supabase integration
- Database: PostgreSQL via Supabase
- Auth: Supabase Auth
- Authorization: role-based access + allowed sections + database-level RLS policy checks
- Reporting: aggregated queries from attendance, payroll, project, and site data

This means the ERP foundation should be built as a single connected domain model, not as isolated screens.

## 2. Core Domain Model

The business model is composed of six interlocking domains:

1. HR & Employees
2. Attendance & Leave & Overtime
3. Work Center & Tasks
4. Projects, Sites & Workforce
5. Payroll & Expenses
6. Reporting, Notifications & Audit

All domain records share the same transaction identity:

- employee_id
- department_id
- site_id
- project_id
- user_id
- created_by
- updated_by
- created_at
- updated_at

## 3. Database Schema Overview

### Core entities

- profiles
- users
- roles
- permissions
- user_roles
- user_departments
- departments
- sections
- teams
- positions
- employees
- employee_documents
- employee_contracts
- payroll_rules
- attendance_logs
- attendance_day_status
- overtime_requests
- leave_types
- leave_requests
- task_templates
- tasks
- task_assignments
- task_comments
- task_attachments
- projects
- project_employees
- sites
- ctr_codes
- project_expenses
- payroll_runs
- payroll_items
- expense_categories
- expenses
- notifications
- daily_site_reports
- audit_logs
- settings

### Recommended relationship strategy

- employee belongs to department, site, project, manager
- attendance belongs to employee and site
- overtime belongs to employee, approval chain, and payroll run
- leave belongs to employee and leave type
- task belongs to department, project, site, assignee, creator
- payroll item is composed from attendance, overtime, allowance, deduction, and leave adjustments
- expense is linked to project, site, ctr, and department
- audit log is append-only and cannot be edited or deleted by regular users

## 4. Role and Permission Matrix

### Roles

- admin
- hr
- supervisor
- data_entry
- site_admin
- department_manager
- engineer
- ceo

### Permission groups

- dashboard.view
- employees.view
- attendance.view
- departments.view
- tasks.view
- projects.view
- sites.view
- workforce.view
- payroll.view
- expenses.view
- reports.view
- users.manage
- settings.manage

Each module should be allowed through two layers:

1. UI level: route visibility + section access
2. Database level: RLS and access policies

## 5. RLS Strategy

The safe implementation pattern is:

- User is authenticated
- Role and department mapping are fetched from user_roles + user_departments
- RLS policies check `auth.uid()` against user records and department scope
- Secret payroll and salary data are only readable by HR/admin/ceo
- Regular employees only read their own profile, tasks, and attendance

This protects against bypassing frontend restrictions.

## 6. Workflow map

### Attendance workflow

- Import or receive punch data
- normalize by employee and work date
- calculate check-in/check-out and overtime
- validate missing punches, late arrivals, and early leaves
- route to HR or supervisor approval when needed

### Leave workflow

- employee submits leave request
- supervisor reviews
- HR approves or rejects
- payroll engine updates deduction or paid leave balance

### Overtime workflow

- employee logs overtime or site admin approves
- supervisor confirms hours
- HR validates against attendance
- payroll engine calculates hourly pay

### Task workflow

- task created from template or manually
- assigned to employee/team
- progress updated
- review/approval before completion
- audit log capture for changes

### Project workflow

- project created
- assigned resources and sites
- daily reports and expenses update cost
- payroll and project cost roll-up are calculated by date range

## 7. Current Implementation Alignment

The project already contains strong foundations for:

- attendance reporting
- asset and file management
- HR-related employees and departments
- attendance processing and payroll calculations
- project and site cost dashboards
- work-center/task monitoring
- permissions and role gating

The remaining ERP work should focus on centralizing these domains into one global module map, permission matrix, and database governance model.

## 8. Implementation Roadmap

### Phase 1: Foundation

- finalize ERP module registry
- unify route access checks
- add core permission matrix and default roles
- add admin-level audit logging for sensitive records

### Phase 2: Employee and Org Structure

- strengthen employee master records
- enforce department / site / project link consistency
- manage documents and contracts

### Phase 3: Attendance, Leave, Overtime

- standardize attendance calculation and approval flows
- improve leave balance logic
- connect overtime to payroll

### Phase 4: Projects and Sites

- link sites to project cost rollups
- manage CTR codes, workforce, and daily reports

### Phase 5: Payroll and Expense

- finalize payroll engine and salary breakdown
- connect project costs and expenses
- support export and audit trail

### Phase 6: Reporting & Notifications

- role-based dashboards
- global search
- notification center
- executive summary views

## 9. Deployment Standards

- No sensitive salary data in frontend state
- No privilege enforcement in UI only; enforce in Supabase RLS and server functions
- Validate all imports before saving to database
- Add audit logs for any salary, status, approval, or assignment changes
- Keep demo data isolated from live data

## 10. Production Checklist

Before production deployment, verify:

- role matrix is enforced server-side
- RLS policies are active
- employee and payroll access is restricted by department and role
- audit logs cannot be removed by ordinary users
- project cost and payroll calculations are traceable
- all reports can be filtered and exported

This architecture is intentionally modular, extensible, and aligned with the existing TanStack + Supabase codebase.
