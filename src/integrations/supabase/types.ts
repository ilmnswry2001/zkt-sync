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
          employee_id: string | null
          employee_no: string
          external_log_id: number | null
          id: string
          status: number | null
          upload_id: string | null
          verify_time: string
          verify_type: number | null
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          employee_id?: string | null
          employee_no: string
          external_log_id?: number | null
          id?: string
          status?: number | null
          upload_id?: string | null
          verify_time: string
          verify_type?: number | null
        }
        Update: {
          created_at?: string
          device_id?: string | null
          employee_id?: string | null
          employee_no?: string
          external_log_id?: number | null
          id?: string
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
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          external_id?: number | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          external_id?: number | null
          id?: string
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
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
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
      sites: {
        Row: {
          client: string | null
          created_at: string
          ctr_code: string
          description: string | null
          end_date: string | null
          id: string
          location: string | null
          name: string
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
          id?: string
          location?: string | null
          name: string
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
          id?: string
          location?: string | null
          name?: string
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
    }
    Enums: {
      app_role: "admin" | "hr" | "supervisor" | "data_entry"
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
      app_role: ["admin", "hr", "supervisor", "data_entry"],
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
