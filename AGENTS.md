# ERP Project Instructions

## Primary Objective
Minimize unnecessary context, token usage, repeated work, and unrelated changes while maintaining correctness and security.

## Before Every Task
- Read this file first.
- Inspect only files directly relevant to the requested task; use targeted searches and focused excerpts.
- Check existing implementations, database schema, permissions, and related tests before changing anything.
- Do not scan or summarize the entire repository unless explicitly requested.
- If essential information is missing, ask one concise question.

## Implementation Rules
- Make the smallest complete change that satisfies the request.
- Reuse existing components, types, utilities, database tables, and conventions.
- Do not rebuild working features, rewrite whole files, or refactor unrelated code.
- Do not add dependencies unless necessary.
- Never invent database schema, environment variables, API contracts, or existing functionality.
- Preserve Arabic RTL layouts, IQD currency handling, and existing UI conventions.
- Preserve Supabase RLS, authentication, authorization, and server-side validation.
- Never expose secrets or weaken security to simplify implementation.

## Database Safety
- Inspect the existing schema before writing migrations.
- Avoid duplicate tables, columns, indexes, and policies.
- Never run destructive database operations or modify production data without explicit approval.
- Keep migrations reversible where practical.

## Token Efficiency
- Do not print entire files, directory listings, or large logs unless needed.
- Prefer `rg` and focused reads; summarize findings rather than pasting source.
- Do not repeat plans, explanations, or code already provided.
- Avoid parallel investigations unless they provide clear value.
- Do not repeatedly inspect unchanged files.
- Use existing project scripts and focused tests before broader checks.
- Summarize results in no more than five concise bullets.

## Verification
- Run the smallest relevant test first, then expand only when needed.
- Run type checking, linting, or build checks when relevant and feasible.
- Report actual test results; never claim an unexecuted test passed.
- Review the final diff for unintended changes.

## Completion Report
Report what changed, files changed, tests executed with actual results, and unresolved risks or blockers. Keep the report to five concise bullets or fewer.

Do not implement additional features beyond the requested scope.
