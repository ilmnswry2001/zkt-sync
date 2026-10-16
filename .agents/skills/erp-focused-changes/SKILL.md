---
name: erp-focused-changes
description: Use when making scoped feature fixes or maintenance changes in this ERP repository, especially React/TypeScript workflows, Supabase/PostgreSQL data access, authorization, or RLS. Avoid invoking for unrelated writing or general questions.
---

# ERP focused changes

1. Read the repository-root `AGENTS.md` first. Identify the requested behavior and inspect only the directly related route, component, helper, schema or migration, permission checks, and focused tests. Use `rg` and small excerpts; do not dump large files, logs, or repository-wide inventories.
2. Trace an existing flow before editing. Reuse current components, types, utilities, database objects, validation, and conventions. Make the smallest complete patch; do not rewrite whole files, rebuild working sections, duplicate functionality, or broaden scope.
3. For database work, inspect the existing Supabase/Drizzle schema and nearby migrations first. Preserve authentication, server-side authorization, and RLS. Never invent schema or weaken access controls. Do not alter production data or perform destructive database actions without explicit user approval.
4. Preserve the app's Arabic RTL, IQD, and UI conventions where relevant. Handle errors using established project patterns and avoid exposing credentials or sensitive data.
5. Run the narrowest relevant existing test or project script first; widen checks only when the change warrants it. Report commands and actual results accurately, including checks not run.
6. Review only the final diff for scope and accidental changes. Keep the final report to five concise points or fewer.
