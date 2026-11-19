import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { PunchTimeZone } from "./uploaded-attendance";

type PublicSchema = Database["public"];
type UploadedFiles = PublicSchema["Tables"]["uploaded_files"];
type WithPunchTimeZone = { punch_time_zone?: PunchTimeZone | null };
type UploadSchema = {
  public: Omit<PublicSchema, "Tables"> & {
    Tables: Omit<PublicSchema["Tables"], "uploaded_files"> & {
      uploaded_files: Omit<UploadedFiles, "Row" | "Insert" | "Update"> & {
        Row: UploadedFiles["Row"] & { punch_time_zone: PunchTimeZone | null };
        Insert: UploadedFiles["Insert"] & WithPunchTimeZone;
        Update: UploadedFiles["Update"] & WithPunchTimeZone;
      };
    };
  };
};

export function uploadedFilesTable(client: SupabaseClient<Database>) {
  return (client as unknown as SupabaseClient<UploadSchema>).from("uploaded_files");
}
