import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  employeeDocumentMaxSize,
  employeeDocumentMimeTypes,
  employeeDocumentTypes,
  employeeDocumentsBucket,
  employeeDocumentsDb,
} from "@/lib/employee-documents";

const required = (max: number) => z.string().trim().min(1, "أكمل الحقول المطلوبة").max(max);
const docId = z.object({ id: z.string().uuid() });
const date = z.string().date();
const listSchema = z
  .object({
    employee_id: z.string().uuid().optional(),
    document_type: z.enum(employeeDocumentTypes).optional(),
    search: z.string().trim().max(100).default(""),
    from: date.optional(),
    to: date.optional(),
    page: z.number().int().min(0).max(100000).default(0),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, "حدد نطاق تاريخ صحيحًا");
const createSchema = z
  .object({
    employee_id: z.string().uuid(),
    document_type: z.enum(employeeDocumentTypes),
    document_number: required(120),
    document_date: date,
    effective_date: date.optional(),
    title: required(240),
    issuing_authority: z.string().trim().max(160).optional(),
    amount_iqd: z.number().min(0).max(999999999999.99).multipleOf(0.01).optional(),
    notes: z.string().trim().max(4000).optional(),
    attachment: z
      .object({
        file_name: required(255),
        file_size: z.number().int().min(1).max(employeeDocumentMaxSize),
        mime_type: z.enum(employeeDocumentMimeTypes),
      })
      .optional(),
  })
  .refine(
    (value) => value.amount_iqd === undefined || value.document_type === "wage_increase",
    "المبلغ متاح لمستند الزيادة فقط",
  );

async function requireArchiveManager(db: ReturnType<typeof employeeDocumentsDb>) {
  const { data, error } = await db.rpc("can_manage_employee_documents");
  if (error) throw error;
  if (!data) throw new Error("إدارة الأرشيف متاحة للإدارة والموارد البشرية");
}

export const listEmployeeDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => listSchema.parse(value))
  .handler(async ({ context, data }) => {
    const { data: documents, error } = await employeeDocumentsDb(context.supabase).rpc(
      "list_employee_documents",
      {
        p_employee_id: data.employee_id ?? null,
        p_document_type: data.document_type ?? null,
        p_search: data.search,
        p_from: data.from ?? null,
        p_to: data.to ?? null,
        p_page: data.page,
      },
    );
    if (error) throw error;
    return documents;
  });

export const createEmployeeDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => createSchema.parse(value))
  .handler(async ({ context, data }) => {
    const db = employeeDocumentsDb(context.supabase);
    await requireArchiveManager(db);
    const id = crypto.randomUUID();
    const filePath = data.attachment ? `${data.employee_id}/${id}/attachment` : null;
    const { error } = await db.from("employee_documents").insert({
      id,
      employee_id: data.employee_id,
      document_type: data.document_type,
      document_number: data.document_number,
      document_date: data.document_date,
      effective_date: data.effective_date ?? null,
      title: data.title,
      issuing_authority: data.issuing_authority || null,
      amount_iqd: data.amount_iqd ?? null,
      notes: data.notes || null,
      file_path: filePath,
      file_name: data.attachment?.file_name ?? null,
      file_size: data.attachment?.file_size ?? null,
      mime_type: data.attachment?.mime_type ?? null,
      created_by: context.userId,
    });
    if (error) throw error;
    return { id, filePath };
  });

export const deleteEmployeeDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => docId.parse(value))
  .handler(async ({ context, data }) => {
    const db = employeeDocumentsDb(context.supabase);
    await requireArchiveManager(db);
    const { data: document, error: readError } = await db
      .from("employee_documents")
      .select("file_path")
      .eq("id", data.id)
      .maybeSingle();
    if (readError) throw readError;
    if (!document) return;
    if (document.file_path) {
      const { error } = await context.supabase.storage
        .from(employeeDocumentsBucket)
        .remove([document.file_path]);
      if (error) throw error;
    }
    const { error } = await db.from("employee_documents").delete().eq("id", data.id);
    if (error) throw error;
  });

export const getDocumentSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) =>
    docId.extend({ download: z.boolean().default(false) }).parse(value),
  )
  .handler(async ({ context, data }) => {
    const { data: document, error } = await employeeDocumentsDb(context.supabase)
      .from("employee_documents")
      .select("file_path, file_name")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!document?.file_path) throw new Error("لا يوجد مرفق متاح لهذا المستند");
    const { data: link, error: linkError } = await context.supabase.storage
      .from(employeeDocumentsBucket)
      .createSignedUrl(document.file_path, 300, {
        download: data.download ? document.file_name || true : false,
      });
    if (linkError) throw linkError;
    return { url: link.signedUrl, fileName: document.file_name };
  });
