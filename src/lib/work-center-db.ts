import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type ClosingRequirement = "none" | "note" | "file" | "attachment" | "link" | "result";
export type TaskExtension = {
  goal_id: string | null;
  assignment_source: "assigned" | "personal";
  closing_requirement: ClosingRequirement;
  require_review: boolean;
  proof_note: string | null;
  proof_storage_path: string | null;
  proof_link: string | null;
  proof_result: string | null;
  delay_reason: string | null;
  delay_reason_note: string | null;
  guidance_id: string | null;
  submitted_for_review_at: string | null;
};

type BaseTask = Database["public"]["Tables"]["employee_tasks"];
type TaskRow = BaseTask["Row"] & TaskExtension;
type TaskInsert = BaseTask["Insert"] & Partial<TaskExtension>;
type TaskUpdate = BaseTask["Update"] & Partial<TaskExtension>;
type TaskTable = Omit<BaseTask, "Row" | "Insert" | "Update"> & {
  Row: TaskRow;
  Insert: TaskInsert;
  Update: TaskUpdate;
};

type BaseTemplate = Database["public"]["Tables"]["team_task_templates"];
type TemplateExtension = {
  checklist_items: string[];
  closing_requirement: ClosingRequirement;
  require_review: boolean;
};
type TemplateTable = Omit<BaseTemplate, "Row" | "Insert" | "Update"> & {
  Row: BaseTemplate["Row"] & TemplateExtension;
  Insert: BaseTemplate["Insert"] & Partial<TemplateExtension>;
  Update: BaseTemplate["Update"] & Partial<TemplateExtension>;
};

export type TaskChecklistItem = {
  id: string;
  task_id: string;
  label: string;
  is_completed: boolean;
  completed_by: string | null;
  completed_at: string | null;
  sort_order: number;
  created_by: string;
  created_at: string;
};
export type TaskAuditEvent = {
  id: string;
  task_id: string;
  actor_id: string | null;
  actor_name: string | null;
  event_type: string;
  details: Record<string, unknown>;
  created_at: string;
};
type PlainTable<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};
export type EmployeeGoal = {
  id: string; employee_id: string; department_id: string; created_by: string; title: string;
  description: string | null; desired_result: string | null; category: string; status: string;
  start_date: string; due_date: string; priority: string; success_metric: string | null;
  target_value: number | null; current_value: number | null; unit: string | null;
  tracking_methods: string[]; tracking_frequency: string; action_plan: string | null;
  reminder_days_before: number; reminders_enabled: boolean;
  support_needed: string | null; manager_note: string | null; proposal_reason: string | null;
  proposal_original: Record<string, unknown> | null; manager_feedback: string | null;
  approved_by: string | null; approved_at: string | null; completion_requested_at: string | null;
  manager_rating: number | null; manager_evaluation: string | null; created_at: string; updated_at: string;
};
export type EmployeeGoalStep = {
  id: string; goal_id: string; title: string; due_date: string | null; status: string;
  sort_order: number; created_by: string; completed_at: string | null; created_at: string;
};
export type EmployeeGoalUpdate = {
  id: string; goal_id: string; actor_id: string; update_type: string;
  progress_percent: number | null; current_value: number | null; completed_work: string | null;
  remaining_work: string | null; obstacles: string | null; help_requested: string | null;
  note: string | null; proof_storage_path: string | null; created_at: string;
};
export type EmployeeGoalEvent = {
  id: string; goal_id: string; actor_id: string | null; event_type: string;
  old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null;
  reason: string | null; created_at: string;
};
export type EmployeeGoalNotification = { id: string; user_id: string; goal_id: string; title: string; body: string; read_at: string | null; created_at: string };
type TaskTables = Omit<Database["public"]["Tables"], "employee_tasks" | "team_task_templates" | "employee_goals" | "employee_goal_steps" | "employee_goal_updates" | "employee_goal_events" | "employee_goal_notifications"> & {
  employee_tasks: TaskTable;
  team_task_templates: TemplateTable;
  employee_goals: PlainTable<EmployeeGoal, Partial<EmployeeGoal> & Pick<EmployeeGoal, "employee_id" | "department_id" | "title" | "due_date">>;
  employee_goal_steps: PlainTable<EmployeeGoalStep, Partial<EmployeeGoalStep> & Pick<EmployeeGoalStep, "goal_id" | "title">>;
  employee_goal_updates: PlainTable<EmployeeGoalUpdate, Partial<EmployeeGoalUpdate> & Pick<EmployeeGoalUpdate, "goal_id" | "actor_id">>;
  employee_goal_events: PlainTable<EmployeeGoalEvent, Partial<EmployeeGoalEvent> & Pick<EmployeeGoalEvent, "goal_id" | "event_type">>;
  employee_goal_notifications: PlainTable<EmployeeGoalNotification, Partial<EmployeeGoalNotification> & Pick<EmployeeGoalNotification, "user_id" | "goal_id" | "title" | "body">>;
  task_checklist_items: PlainTable<
    TaskChecklistItem,
    Omit<TaskChecklistItem, "id" | "created_at" | "is_completed" | "completed_by" | "completed_at"> &
      Partial<Pick<TaskChecklistItem, "is_completed" | "completed_by" | "completed_at">>
  >;
  employee_task_events: PlainTable<TaskAuditEvent, Omit<TaskAuditEvent, "id" | "created_at">>;
};
type WorkCenterFunctions = Database["public"]["Functions"] & {
  generate_employee_goal_reminders: { Args: never; Returns: number };
  create_employee_goal_task: {
    Args: { _goal_id: string; _title: string; _description?: string | null; _due_date?: string | null; _priority?: string };
    Returns: string;
  };
  create_work_task_assignments: {
    Args: {
      _department_id: string;
      _employee_ids: string[];
      _task_date: string;
      _due_date: string | null;
      _title: string;
      _description: string | null;
      _manager_note: string | null;
      _priority: string;
      _closing_requirement: ClosingRequirement;
      _require_review: boolean;
      _checklist_items: string[];
    };
    Returns: number;
  };
  send_work_guidance: {
    Args: {
      _department_id: string;
      _employee_ids: string[];
      _title: string;
      _content: string;
      _guidance_date: string;
      _create_task: boolean;
      _task_due_date: string | null;
      _task_priority: string;
    };
    Returns: { guidances_sent: number; tasks_created: number; unlinked_employees: number }[];
  };
};
type WorkCenterDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: TaskTables;
    Functions: WorkCenterFunctions;
  };
};

export type WorkCenterTask = TaskRow;
export type WorkCenterTemplate = BaseTemplate["Row"] & TemplateExtension;
export type WorkCenterTaskUpdate = TaskUpdate;

export const workCenterDb = supabase as unknown as SupabaseClient<WorkCenterDatabase>;
