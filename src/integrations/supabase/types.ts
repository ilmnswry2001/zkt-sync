export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      attendance_day_status: {
        Row: {
          created_at: string
          employee_id: string
          id: string
          notes: string | null
          overtime_hours: number
          status: Database["public"]["Enums"]["day_status"]
          updated_at: string
          updated_by: string | null
          work_date: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          id?: string
          notes?: string | null
          overtime_hours?: number
          status: Database["public"]["Enums"]["day_status"]
          updated_at?: string
          updated_by?: string | null
          work_date: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          id?: string
          notes?: string | null
          overtime_hours?: number
          status?: Database["public"]["Enums"]["day_status"]
          updated_at?: string
          updated_by?: string | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_day_status_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_logs: {
        Row: {
          created_at: string
          device_id: string | null
          device_info: Json | null
          distance_meters: number | null
          employee_id: string | null
          employee_no: string
          external_log_id: number | null
          id: string
          latitude: number | null
          longitude: number | null
          self_event_type: string | null
          source: string
          status: number | null
          upload_id: string | null
          verify_time: string
          verify_type: number | null
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          device_info?: Json | null
          distance_meters?: number | null
          employee_id?: string | null
          employee_no: string
          external_log_id?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          self_event_type?: string | null
          source?: string
          status?: number | null
          upload_id?: string | null
          verify_time: string
          verify_type?: number | null
        }
        Update: {
          created_at?: string
          device_id?: string | null
          device_info?: Json | null
          distance_meters?: number | null
          employee_id?: string | null
          employee_no?: string
          external_log_id?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          self_event_type?: string | null
          source?: string
          status?: number | null
          upload_id?: string | null
          verify_time?: string
          verify_type?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_logs_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_logs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_logs_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "uploaded_files"
            referencedColumns: ["id"]
          },
        ]
      }
      department_managers: {
        Row: {
          created_at: string
          department_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          department_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          department_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_managers_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string
          description: string | null
          external_id: number | null
          id: string
          manager_user_id: string | null
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          external_id?: number | null
          id?: string
          manager_user_id?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          external_id?: number | null
          id?: string
          manager_user_id?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      devices: {
        Row: {
          created_at: string
          description: string | null
          id: string
          ip_address: string | null
          last_sync_at: string | null
          location: string | null
          name: string
          serial_number: string | null
          status: Database["public"]["Enums"]["device_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          ip_address?: string | null
          last_sync_at?: string | null
          location?: string | null
          name: string
          serial_number?: string | null
          status?: Database["public"]["Enums"]["device_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          ip_address?: string | null
          last_sync_at?: string | null
          location?: string | null
          name?: string
          serial_number?: string | null
          status?: Database["public"]["Enums"]["device_status"]
          updated_at?: string
        }
        Relationships: []
      }
      employee_clearances: {
        Row: {
          clearance_status: string
          cleared_by: string | null
          created_at: string
          employee_id: string
          has_open_custody: boolean
          id: string
          notes: string | null
        }
        Insert: {
          clearance_status?: string
          cleared_by?: string | null
          created_at?: string
          employee_id: string
          has_open_custody?: boolean
          id?: string
          notes?: string | null
        }
        Update: {
          clearance_status?: string
          cleared_by?: string | null
          created_at?: string
          employee_id?: string
          has_open_custody?: boolean
          id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_clearances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_guidance_notes: {
        Row: {
          author_id: string
          content: string
          created_at: string
          department_id: string
          guidance_date: string
          id: string
          read_at: string | null
          target_employee_id: string
          target_user_id: string
          title: string
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string
          department_id: string
          guidance_date?: string
          id?: string
          read_at?: string | null
          target_employee_id: string
          target_user_id: string
          title: string
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string
          department_id?: string
          guidance_date?: string
          id?: string
          read_at?: string | null
          target_employee_id?: string
          target_user_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_guidance_notes_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_guidance_notes_target_employee_id_fkey"
            columns: ["target_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_monthly_evaluations: {
        Row: {
          created_at: string
          created_by: string
          employee_id: string
          evaluation_month: string
          id: string
          score: number
        }
        Insert: {
          created_at?: string
          created_by: string
          employee_id: string
          evaluation_month: string
          id?: string
          score: number
        }
        Update: {
          created_at?: string
          created_by?: string
          employee_id?: string
          evaluation_month?: string
          id?: string
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "employee_monthly_evaluations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_penalties: {
        Row: {
          created_at: string
          created_by: string | null
          deduction_amount: number
          employee_id: string | null
          employee_name: string
          executed_at: string | null
          executed_by: string | null
          id: string
          notes: string | null
          penalty_date: string
          penalty_type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deduction_amount?: number
          employee_id?: string | null
          employee_name: string
          executed_at?: string | null
          executed_by?: string | null
          id?: string
          notes?: string | null
          penalty_date?: string
          penalty_type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deduction_amount?: number
          employee_id?: string | null
          employee_name?: string
          executed_at?: string | null
          executed_by?: string | null
          id?: string
          notes?: string | null
          penalty_date?: string
          penalty_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_penalties_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_task_events: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          created_at: string
          details: Json
          event_type: string
          id: string
          task_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          details?: Json
          event_type: string
          id?: string
          task_id: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          details?: Json
          event_type?: string
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_task_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "employee_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_tasks: {
        Row: {
          archived_at: string | null
          assignment_source: string
          closing_requirement: string
          completed_at: string | null
          completion_note: string | null
          created_at: string
          created_by: string
          delay_reason: string | null
          delay_reason_note: string | null
          department_id: string | null
          description: string | null
          due_date: string | null
          duration_minutes: number
          employee_id: string | null
          guidance_id: string | null
          id: string
          manager_note: string | null
          priority: string
          proof_link: string | null
          proof_note: string | null
          proof_result: string | null
          proof_storage_path: string | null
          require_review: boolean
          reviewed_at: string | null
          reviewed_by: string | null
          start_date: string | null
          started_at: string | null
          status: string
          submitted_for_review_at: string | null
          task_date: string
          task_type: string
          template_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assignment_source?: string
          closing_requirement?: string
          completed_at?: string | null
          completion_note?: string | null
          created_at?: string
          created_by?: string
          delay_reason?: string | null
          delay_reason_note?: string | null
          department_id?: string | null
          description?: string | null
          due_date?: string | null
          duration_minutes?: number
          employee_id?: string | null
          guidance_id?: string | null
          id?: string
          manager_note?: string | null
          priority?: string
          proof_link?: string | null
          proof_note?: string | null
          proof_result?: string | null
          proof_storage_path?: string | null
          require_review?: boolean
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date?: string | null
          started_at?: string | null
          status?: string
          submitted_for_review_at?: string | null
          task_date?: string
          task_type?: string
          template_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assignment_source?: string
          closing_requirement?: string
          completed_at?: string | null
          completion_note?: string | null
          created_at?: string
          created_by?: string
          delay_reason?: string | null
          delay_reason_note?: string | null
          department_id?: string | null
          description?: string | null
          due_date?: string | null
          duration_minutes?: number
          employee_id?: string | null
          guidance_id?: string | null
          id?: string
          manager_note?: string | null
          priority?: string
          proof_link?: string | null
          proof_note?: string | null
          proof_result?: string | null
          proof_storage_path?: string | null
          require_review?: boolean
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date?: string | null
          started_at?: string | null
          status?: string
          submitted_for_review_at?: string | null
          task_date?: string
          task_type?: string
          template_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_tasks_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_tasks_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_tasks_guidance_id_fkey"
            columns: ["guidance_id"]
            isOneToOne: false
            referencedRelation: "employee_guidance_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_tasks_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "team_task_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          address: string | null
          bank_account: string | null
          bank_name: string | null
          base_salary: number | null
          birth_date: string | null
          blood_type: string | null
          contract_end_date: string | null
          contract_type: string | null
          created_at: string
          ctr_code: string | null
          department_id: string | null
          education: string | null
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          employee_no: string
          erp_no: string | null
          full_name: string
          gender: string | null
          hire_date: string | null
          iban: string | null
          id: string
          id_no: string | null
          last_working_day: string | null
          marital_status: string | null
          nationality: string | null
          notes: string | null
          passport_expiry: string | null
          passport_no: string | null
          pay_type: string
          phone1: string | null
          phone2: string | null
          position: string | null
          privilege: number | null
          project: string | null
          residency_expiry: string | null
          residency_no: string | null
          safety_passport_expiry: string | null
          safety_passport_no: string | null
          salary_structure: string | null
          salary_type: string | null
          shift_id: string | null
          site_id: string | null
          status: Database["public"]["Enums"]["employee_status"]
          updated_at: string
          wage_rate_id: string | null
        }
        Insert: {
          address?: string | null
          bank_account?: string | null
          bank_name?: string | null
          base_salary?: number | null
          birth_date?: string | null
          blood_type?: string | null
          contract_end_date?: string | null
          contract_type?: string | null
          created_at?: string
          ctr_code?: string | null
          department_id?: string | null
          education?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employee_no: string
          erp_no?: string | null
          full_name: string
          gender?: string | null
          hire_date?: string | null
          iban?: string | null
          id?: string
          id_no?: string | null
          last_working_day?: string | null
          marital_status?: string | null
          nationality?: string | null
          notes?: string | null
          passport_expiry?: string | null
          passport_no?: string | null
          pay_type?: string
          phone1?: string | null
          phone2?: string | null
          position?: string | null
          privilege?: number | null
          project?: string | null
          residency_expiry?: string | null
          residency_no?: string | null
          safety_passport_expiry?: string | null
          safety_passport_no?: string | null
          salary_structure?: string | null
          salary_type?: string | null
          shift_id?: string | null
          site_id?: string | null
          status?: Database["public"]["Enums"]["employee_status"]
          updated_at?: string
          wage_rate_id?: string | null
        }
        Update: {
          address?: string | null
          bank_account?: string | null
          bank_name?: string | null
          base_salary?: number | null
          birth_date?: string | null
          blood_type?: string | null
          contract_end_date?: string | null
          contract_type?: string | null
          created_at?: string
          ctr_code?: string | null
          department_id?: string | null
          education?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employee_no?: string
          erp_no?: string | null
          full_name?: string
          gender?: string | null
          hire_date?: string | null
          iban?: string | null
          id?: string
          id_no?: string | null
          last_working_day?: string | null
          marital_status?: string | null
          nationality?: string | null
          notes?: string | null
          passport_expiry?: string | null
          passport_no?: string | null
          pay_type?: string
          phone1?: string | null
          phone2?: string | null
          position?: string | null
          privilege?: number | null
          project?: string | null
          residency_expiry?: string | null
          residency_no?: string | null
          safety_passport_expiry?: string | null
          safety_passport_no?: string | null
          salary_structure?: string | null
          salary_type?: string | null
          shift_id?: string | null
          site_id?: string | null
          status?: Database["public"]["Enums"]["employee_status"]
          updated_at?: string
          wage_rate_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_wage_rate_id_fkey"
            columns: ["wage_rate_id"]
            isOneToOne: false
            referencedRelation: "wage_rates"
            referencedColumns: ["id"]
          },
        ]
      }
      form_events: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          form_id: string
          id: string
          note: string | null
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          form_id: string
          id?: string
          note?: string | null
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          form_id?: string
          id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_events_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
        ]
      }
      form_role_assignments: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["form_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["form_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["form_role"]
          user_id?: string
        }
        Relationships: []
      }
      forms: {
        Row: {
          ceo_approved_at: string | null
          ceo_approved_by: string | null
          check_in: string | null
          check_out: string | null
          created_at: string
          created_by: string | null
          day_status: Database["public"]["Enums"]["day_status"] | null
          department_id: string | null
          employee_id: string
          executed_at: string | null
          executed_by: string | null
          form_no: number
          id: string
          kind: Database["public"]["Enums"]["form_kind"]
          leave_days: number
          leave_end_date: string | null
          manager_approved_at: string | null
          manager_approved_by: string | null
          overtime_hours: number
          reason: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          status: Database["public"]["Enums"]["form_status"]
          target_department_id: string | null
          updated_at: string
          work_date: string
        }
        Insert: {
          ceo_approved_at?: string | null
          ceo_approved_by?: string | null
          check_in?: string | null
          check_out?: string | null
          created_at?: string
          created_by?: string | null
          day_status?: Database["public"]["Enums"]["day_status"] | null
          department_id?: string | null
          employee_id: string
          executed_at?: string | null
          executed_by?: string | null
          form_no?: number
          id?: string
          kind?: Database["public"]["Enums"]["form_kind"]
          leave_days?: number
          leave_end_date?: string | null
          manager_approved_at?: string | null
          manager_approved_by?: string | null
          overtime_hours?: number
          reason: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["form_status"]
          target_department_id?: string | null
          updated_at?: string
          work_date: string
        }
        Update: {
          ceo_approved_at?: string | null
          ceo_approved_by?: string | null
          check_in?: string | null
          check_out?: string | null
          created_at?: string
          created_by?: string | null
          day_status?: Database["public"]["Enums"]["day_status"] | null
          department_id?: string | null
          employee_id?: string
          executed_at?: string | null
          executed_by?: string | null
          form_no?: number
          id?: string
          kind?: Database["public"]["Enums"]["form_kind"]
          leave_days?: number
          leave_end_date?: string | null
          manager_approved_at?: string | null
          manager_approved_by?: string | null
          overtime_hours?: number
          reason?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["form_status"]
          target_department_id?: string | null
          updated_at?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "forms_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forms_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forms_target_department_id_fkey"
            columns: ["target_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_settings: {
        Row: {
          annual_allowance_days: number
          id: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          annual_allowance_days?: number
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          annual_allowance_days?: number
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          allowed_sections: string[] | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          allowed_sections?: string[] | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          allowed_sections?: string[] | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      report_catalog_items: {
        Row: {
          created_at: string
          id: string
          is_archived: boolean
          kind: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_archived?: boolean
          kind: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_archived?: boolean
          kind?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      salary_additions: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          description: string | null
          employee_id: string
          id: string
          kind: string
          month: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          employee_id: string
          id?: string
          kind?: string
          month: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          employee_id?: string
          id?: string
          kind?: string
          month?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salary_additions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          created_at: string
          end_time: string
          grace_minutes: number
          id: string
          name: string
          start_time: string
        }
        Insert: {
          created_at?: string
          end_time: string
          grace_minutes?: number
          id?: string
          name: string
          start_time: string
        }
        Update: {
          created_at?: string
          end_time?: string
          grace_minutes?: number
          id?: string
          name?: string
          start_time?: string
        }
        Relationships: []
      }
      site_daily_report_lines: {
        Row: {
          catalog_item_id: string | null
          created_at: string
          id: string
          idle_count: number
          item_name: string
          kind: string
          report_id: string
          total_count: number
          working_count: number
        }
        Insert: {
          catalog_item_id?: string | null
          created_at?: string
          id?: string
          idle_count?: number
          item_name: string
          kind: string
          report_id: string
          total_count?: number
          working_count?: number
        }
        Update: {
          catalog_item_id?: string | null
          created_at?: string
          id?: string
          idle_count?: number
          item_name?: string
          kind?: string
          report_id?: string
          total_count?: number
          working_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "site_daily_report_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "report_catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_daily_report_lines_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "site_daily_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      site_daily_reports: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          report_date: string
          site_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          report_date: string
          site_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          report_date?: string
          site_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_daily_reports_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_work_plans: {
        Row: {
          assigned_staff: Json
          created_at: string
          final_plan: Json | null
          id: string
          management_notes: string | null
          planning_notes: string | null
          request_date: string
          request_notes: string | null
          requested_by: string | null
          requested_by_name: string | null
          site_id: string
          site_name: string
          specialties: Json
          status: string
          updated_at: string
        }
        Insert: {
          assigned_staff?: Json
          created_at?: string
          final_plan?: Json | null
          id?: string
          management_notes?: string | null
          planning_notes?: string | null
          request_date: string
          request_notes?: string | null
          requested_by?: string | null
          requested_by_name?: string | null
          site_id: string
          site_name: string
          specialties?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_staff?: Json
          created_at?: string
          final_plan?: Json | null
          id?: string
          management_notes?: string | null
          planning_notes?: string | null
          request_date?: string
          request_notes?: string | null
          requested_by?: string | null
          requested_by_name?: string | null
          site_id?: string
          site_name?: string
          specialties?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_work_plans_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          client: string | null
          created_at: string
          ctr_code: string
          description: string | null
          end_date: string | null
          geofence_radius_meters: number
          id: string
          latitude: number | null
          location: string | null
          longitude: number | null
          name: string
          site_admin_employee_id: string | null
          start_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          client?: string | null
          created_at?: string
          ctr_code: string
          description?: string | null
          end_date?: string | null
          geofence_radius_meters?: number
          id?: string
          latitude?: number | null
          location?: string | null
          longitude?: number | null
          name: string
          site_admin_employee_id?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          client?: string | null
          created_at?: string
          ctr_code?: string
          description?: string | null
          end_date?: string | null
          geofence_radius_meters?: number
          id?: string
          latitude?: number | null
          location?: string | null
          longitude?: number | null
          name?: string
          site_admin_employee_id?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sites_site_admin_employee_id_fkey"
            columns: ["site_admin_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_count_lines: {
        Row: {
          count_id: string
          counted_qty: number
          id: string
          item_id: string
          system_qty: number
        }
        Insert: {
          count_id: string
          counted_qty?: number
          id?: string
          item_id: string
          system_qty?: number
        }
        Update: {
          count_id?: string
          counted_qty?: number
          id?: string
          item_id?: string
          system_qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_count_lines_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "stock_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "warehouse_items"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_counts: {
        Row: {
          count_date: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          warehouse_id: string
        }
        Insert: {
          count_date?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          warehouse_id: string
        }
        Update: {
          count_date?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_counts_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          count_id: string | null
          created_at: string
          created_by: string | null
          employee_id: string | null
          id: string
          item_id: string
          movement_date: string
          movement_type: string
          notes: string | null
          qty_delta: number
          related_warehouse_id: string | null
          site_id: string | null
          warehouse_id: string
        }
        Insert: {
          count_id?: string | null
          created_at?: string
          created_by?: string | null
          employee_id?: string | null
          id?: string
          item_id: string
          movement_date?: string
          movement_type: string
          notes?: string | null
          qty_delta: number
          related_warehouse_id?: string | null
          site_id?: string | null
          warehouse_id: string
        }
        Update: {
          count_id?: string | null
          created_at?: string
          created_by?: string | null
          employee_id?: string | null
          id?: string
          item_id?: string
          movement_date?: string
          movement_type?: string
          notes?: string | null
          qty_delta?: number
          related_warehouse_id?: string | null
          site_id?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "warehouse_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_related_warehouse_id_fkey"
            columns: ["related_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      task_checklist_items: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string
          id: string
          is_completed: boolean
          label: string
          sort_order: number
          task_id: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string
          id?: string
          is_completed?: boolean
          label: string
          sort_order?: number
          task_id: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string
          id?: string
          is_completed?: boolean
          label?: string
          sort_order?: number
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_checklist_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "employee_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      team_guidance_notes: {
        Row: {
          author_id: string
          content: string
          created_at: string
          department_id: string
          id: string
          note_date: string
          updated_at: string
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string
          department_id: string
          id?: string
          note_date?: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string
          department_id?: string
          id?: string
          note_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_guidance_notes_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      team_guidance_recipients: {
        Row: {
          created_at: string
          employee_id: string | null
          guidance_id: string
          id: string
          read_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          employee_id?: string | null
          guidance_id: string
          id?: string
          read_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          employee_id?: string | null
          guidance_id?: string
          id?: string
          read_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_guidance_recipients_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_guidance_recipients_guidance_id_fkey"
            columns: ["guidance_id"]
            isOneToOne: false
            referencedRelation: "team_guidance_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      team_task_templates: {
        Row: {
          active: boolean
          assignee_employee_ids: string[]
          checklist_items: string[]
          closing_requirement: string
          created_at: string
          created_by: string
          department_id: string
          description: string | null
          due_offset_days: number
          end_date: string | null
          id: string
          interval_days: number | null
          month_day: number | null
          priority: string
          recurrence_rule: string
          require_review: boolean
          scheduled_time: string | null
          start_date: string
          task_type: string
          title: string
          updated_at: string
          weekdays: number[] | null
        }
        Insert: {
          active?: boolean
          assignee_employee_ids?: string[]
          checklist_items?: string[]
          closing_requirement?: string
          created_at?: string
          created_by?: string
          department_id: string
          description?: string | null
          due_offset_days?: number
          end_date?: string | null
          id?: string
          interval_days?: number | null
          month_day?: number | null
          priority?: string
          recurrence_rule: string
          require_review?: boolean
          scheduled_time?: string | null
          start_date?: string
          task_type?: string
          title: string
          updated_at?: string
          weekdays?: number[] | null
        }
        Update: {
          active?: boolean
          assignee_employee_ids?: string[]
          checklist_items?: string[]
          closing_requirement?: string
          created_at?: string
          created_by?: string
          department_id?: string
          description?: string | null
          due_offset_days?: number
          end_date?: string | null
          id?: string
          interval_days?: number | null
          month_day?: number | null
          priority?: string
          recurrence_rule?: string
          require_review?: boolean
          scheduled_time?: string | null
          start_date?: string
          task_type?: string
          title?: string
          updated_at?: string
          weekdays?: number[] | null
        }
        Relationships: [
          {
            foreignKeyName: "team_task_templates_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      uploaded_files: {
        Row: {
          content_hash: string | null
          created_at: string
          device_id: string | null
          device_serial: string | null
          error_message: string | null
          file_name: string
          file_size: number | null
          id: string
          inserted_logs: number | null
          is_duplicate: boolean
          logs_count: number | null
          processed_at: string | null
          status: Database["public"]["Enums"]["upload_status"]
          storage_path: string
          uploaded_by: string | null
          users_count: number | null
        }
        Insert: {
          content_hash?: string | null
          created_at?: string
          device_id?: string | null
          device_serial?: string | null
          error_message?: string | null
          file_name: string
          file_size?: number | null
          id?: string
          inserted_logs?: number | null
          is_duplicate?: boolean
          logs_count?: number | null
          processed_at?: string | null
          status?: Database["public"]["Enums"]["upload_status"]
          storage_path: string
          uploaded_by?: string | null
          users_count?: number | null
        }
        Update: {
          content_hash?: string | null
          created_at?: string
          device_id?: string | null
          device_serial?: string | null
          error_message?: string | null
          file_name?: string
          file_size?: number | null
          id?: string
          inserted_logs?: number | null
          is_duplicate?: boolean
          logs_count?: number | null
          processed_at?: string | null
          status?: Database["public"]["Enums"]["upload_status"]
          storage_path?: string
          uploaded_by?: string | null
          users_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "uploaded_files_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      user_departments: {
        Row: {
          created_at: string
          department_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          department_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          department_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_departments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vehicle_monthly_operations: {
        Row: {
          created_at: string
          id: string
          month: string
          notes: string | null
          operating_dates: string[]
          operating_days: number
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          month: string
          notes?: string | null
          operating_dates?: string[]
          operating_days?: number
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          id?: string
          month?: string
          notes?: string | null
          operating_dates?: string[]
          operating_days?: number
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_monthly_operations_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          created_at: string
          currency: string
          daily_rate: number
          id: string
          is_active: boolean
          name: string
          notes: string | null
          updated_at: string
          vehicle_class: string
          vehicle_no: string
        }
        Insert: {
          created_at?: string
          currency?: string
          daily_rate?: number
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          updated_at?: string
          vehicle_class: string
          vehicle_no: string
        }
        Update: {
          created_at?: string
          currency?: string
          daily_rate?: number
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          updated_at?: string
          vehicle_class?: string
          vehicle_no?: string
        }
        Relationships: []
      }
      wage_rates: {
        Row: {
          created_at: string
          currency: string
          daily_rate: number
          id: string
          monthly_rate: number
          notes: string | null
          overtime_hour_rate: number
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          daily_rate?: number
          id?: string
          monthly_rate?: number
          notes?: string | null
          overtime_hour_rate?: number
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          daily_rate?: number
          id?: string
          monthly_rate?: number
          notes?: string | null
          overtime_hour_rate?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      warehouse_items: {
        Row: {
          code: string | null
          created_at: string
          id: string
          is_active: boolean
          kind: string
          min_qty: number
          name: string
          unit: string
          unit_cost: number
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          min_qty?: number
          name: string
          unit?: string
          unit_cost?: number
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          min_qty?: number
          name?: string
          unit?: string
          unit_cost?: number
        }
        Relationships: []
      }
      warehouses: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_main: boolean
          name: string
          notes: string | null
          site_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_main?: boolean
          name: string
          notes?: string | null
          site_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_main?: boolean
          name?: string
          notes?: string | null
          site_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "warehouses_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_access_department: {
        Args: { _department_id: string; _user_id: string }
        Returns: boolean
      }
      can_access_work_task: { Args: { _task_id: string }; Returns: boolean }
      can_manage_stock: { Args: { _uid: string }; Returns: boolean }
      can_manage_work_task: { Args: { _task_id: string }; Returns: boolean }
      create_work_task_assignments: {
        Args: {
          _checklist_items: string[]
          _closing_requirement: string
          _department_id: string
          _description: string
          _due_date: string
          _employee_ids: string[]
          _manager_note: string
          _priority: string
          _require_review: boolean
          _task_date: string
          _title: string
        }
        Returns: number
      }
      current_employee_id: { Args: never; Returns: string }
      employee_user_id: { Args: { _employee_id: string }; Returns: string }
      generate_recurring_tasks: {
        Args: { _from: string; _to: string }
        Returns: number
      }
      get_employee_custody: {
        Args: { emp_id: string }
        Returns: {
          item_code: string
          item_id: string
          item_name: string
          movement_id: string
          received_date: string
          remaining_qty: number
          unit: string
          warehouse_id: string
          warehouse_name: string
        }[]
      }
      has_form_role: {
        Args: {
          _role: Database["public"]["Enums"]["form_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      issue_employee_clearance: {
        Args: { _employee_id: string; _notes?: string }
        Returns: string
      }
      normalize_ar_name: { Args: { _s: string }; Returns: string }
      record_mobile_self_attendance: {
        Args: {
          p_device_info?: Json
          p_event_type: string
          p_latitude: number
          p_longitude: number
        }
        Returns: {
          distance_meters: number
          employee_id: string
          event_type: string
          id: string
          recorded_at: string
          site_name: string
        }[]
      }
      return_employee_custody: {
        Args: {
          _employee_id: string
          _item_id: string
          _notes?: string
          _quantity: number
          _warehouse_id: string
        }
        Returns: string
      }
      send_work_guidance: {
        Args: {
          _content: string
          _create_task: boolean
          _department_id: string
          _employee_ids: string[]
          _guidance_date: string
          _task_due_date: string
          _task_priority: string
          _title: string
        }
        Returns: {
          guidances_sent: number
          tasks_created: number
          unlinked_employees: number
        }[]
      }
      set_department_manager: {
        Args: { _department_id: string; _employee_id?: string }
        Returns: string
      }
      submit_employee_monthly_evaluation: {
        Args: {
          _employee_id: string
          _evaluation_month: string
          _score: number
        }
        Returns: {
          bonus_added: number
          evaluation_id: string
        }[]
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "hr"
        | "supervisor"
        | "data_entry"
        | "site_admin"
        | "department_manager"
        | "engineer"
      day_status: "present" | "absent" | "leave" | "holiday" | "rest"
      device_status: "active" | "inactive" | "maintenance"
      employee_status: "active" | "inactive" | "terminated"
      form_kind: "attendance" | "overtime" | "leave"
      form_role: "dept_manager" | "ceo" | "executor"
      form_status:
        | "pending_manager"
        | "pending_ceo"
        | "pending_execution"
        | "executed"
        | "rejected"
      upload_status: "pending" | "processing" | "completed" | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "hr",
        "supervisor",
        "data_entry",
        "site_admin",
        "department_manager",
        "engineer",
      ],
      day_status: ["present", "absent", "leave", "holiday", "rest"],
      device_status: ["active", "inactive", "maintenance"],
      employee_status: ["active", "inactive", "terminated"],
      form_kind: ["attendance", "overtime", "leave"],
      form_role: ["dept_manager", "ceo", "executor"],
      form_status: [
        "pending_manager",
        "pending_ceo",
        "pending_execution",
        "executed",
        "rejected",
      ],
      upload_status: ["pending", "processing", "completed", "failed"],
    },
  },
} as const
