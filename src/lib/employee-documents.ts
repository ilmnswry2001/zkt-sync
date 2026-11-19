import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const employeeDocumentsBucket = "employee-documents";
export const employeeDocumentMaxSize = 15 * 1024 * 1024;
export const employeeDocumentMimeTypes = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const employeeDocumentTypes = [
  "work_commencement",
  "administrative_order",
  "wage_increase",
  "official_letter",
  "contract",
  "penalty_warning",
  "other",
] as const;
export type EmployeeDocumentType = (typeof employeeDocumentTypes)[number];
export const documentTypeLabels: Record<EmployeeDocumentType, string> = {
  work_commencement: "مباشرة عمل",
  administrative_order: "أمر إداري",
  wage_increase: "زيادة أجور / علاوة",
  official_letter: "كتاب رسمي",
  contract: "عقد",
  penalty_warning: "عقوبة / إنذار",
  other: "أخرى",
};
export type DocumentEmployee = { id: string; full_name: string; employee_no: string };

type DocumentFields = {
  id: string;
  employee_id: string;
  document_type: EmployeeDocumentType;
  document_number: string;
  document_date: string;
  effective_date: string | null;
  title: string;
  issuing_authority: string | null;
  amount_iqd: number | null;
  file_name: string | null;
  notes: string | null;
};
type DocumentRow = DocumentFields & {
  file_path: string | null;
  file_size: number | null;
  mime_type: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
type DocumentList = {
  totalCount: number;
  stats: {
    total: number;
    work_commencement: number;
    administrative_order: number;
    wage_increase: number;
  };
  rows: Array<
    DocumentFields & {
      employee:
        | (DocumentEmployee & {
            position: string | null;
            department_id: string | null;
            departments: { name: string } | null;
          })
        | null;
    }
  >;
};
type ArchiveDb = {
  public: {
    Tables: {
      employee_documents: {
        Row: DocumentRow;
        Insert: Omit<DocumentRow, "created_at" | "updated_at">;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      can_manage_employee_documents: { Args: Record<string, never>; Returns: boolean };
      list_employee_documents: {
        Args: {
          p_employee_id: string | null;
          p_document_type: EmployeeDocumentType | null;
          p_search: string;
          p_from: string | null;
          p_to: string | null;
          p_page: number;
        };
        Returns: DocumentList;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
export const employeeDocumentsDb = (client: SupabaseClient<Database>) =>
  client as unknown as SupabaseClient<ArchiveDb>;
