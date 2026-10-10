import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type RpcError = { code?: string; message: string } | null;
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type RpcClient = {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: RpcError }>;
};
type RequestActionResult = {
  id: string;
  request_number?: string;
  status?: string;
  batch_id?: string;
  request_id?: string;
  request_status?: string;
  duplicate?: boolean;
};

export type MaterialRequestActor = {
  user_id: string;
  email: string | null;
  roles: string[];
  department_ids: string[];
  employee_department_id: string | null;
  company_manager: boolean;
};

export type MaterialRequestItem = {
  id: string;
  request_id: string;
  original_qty: number;
  requested_qty: number;
  item_name: string;
  unit: string;
  specifications: string | null;
  planning_approved_qty: number | null;
  planning_note: string | null;
  warehouse_item_id: string | null;
  source_warehouse_id: string | null;
  is_new_item: boolean;
  warehouse_available_qty: number;
  issue_qty: number;
  purchase_qty: number;
  purchased_qty: number;
  received_qty: number;
  allocation_reason: string | null;
  not_purchased_reason: string | null;
  status: string;
};

export type MaterialRequestEvent = {
  id: string;
  action: string;
  actor_id: string;
  actor_name: string | null;
  note: string | null;
  old_value: JsonValue | null;
  new_value: JsonValue | null;
  created_at: string;
};

export type MaterialRequestBatch = {
  id: string;
  supplier: string;
  document_number: string | null;
  purchase_date: string;
  notes: string | null;
  status: "draft" | "sent_to_warehouse";
  sent_at: string | null;
  items: Array<{ id: string; request_item_id: string; purchased_qty: number; not_purchased_reason: string | null }>;
};

export type MaterialRequestReceipt = {
  id: string;
  batch_id: string;
  warehouse_id: string;
  received_by: string;
  received_at: string;
  notes: string | null;
  items: Array<{
    id: string;
    request_item_id: string;
    batch_item_id: string;
    received_qty: number;
    serial_notes: string | null;
    did_not_arrive: boolean;
    exclusion_reason: string | null;
  }>;
};

export type MaterialRequest = {
  id: string;
  request_number: string;
  request_type: "material" | "equipment";
  created_by: string;
  created_by_name: string | null;
  department_id: string;
  department_name: string;
  site_id: string;
  site_name: string;
  status: string;
  reason: string;
  need_by_date: string | null;
  submitted_at: string | null;
  created_at: string;
  items: MaterialRequestItem[];
  events: MaterialRequestEvent[];
  batches: MaterialRequestBatch[];
  receipts: MaterialRequestReceipt[];
};

export type MaterialRequestOptions = {
  actor: MaterialRequestActor;
  sites: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  warehouses: Array<{ id: string; name: string; is_main: boolean }>;
  items: Array<{ id: string; name: string; kind: "material" | "tool"; unit: string }>;
  stock: Array<{ warehouse_id: string; item_id: string; quantity: number }>;
  approvers: Array<{ id: string; name: string }>;
};

const requestLineSchema = z.object({
  id: z.string().uuid().optional(),
  item_name: z.string().trim().min(1).max(200),
  unit: z.string().trim().min(1).max(60),
  quantity: z.number().finite().positive(),
  specifications: z.string().trim().max(1000).optional().default(""),
});

const createSchema = z.object({
  request_type: z.enum(["material", "equipment"]),
  site_id: z.string().uuid(),
  department_id: z.string().uuid(),
  reason: z.string().trim().max(2000).default(""),
  need_by_date: z.string().date().nullable().optional(),
  items: z.array(requestLineSchema).max(100),
  submit: z.boolean(),
});

const actorAllowed = (actor: MaterialRequestActor, accepted: string[]) =>
  actor.company_manager || actor.roles.some((role) => accepted.includes(role));

async function getActor(db: RpcClient) {
  const result = await db.rpc("material_request_actor_context");
  if (result.error) throw migrationError(result.error);
  return result.data as MaterialRequestActor;
}

function migrationError(error: NonNullable<RpcError>) {
  if (["PGRST202", "PGRST205", "42883", "42P01", "42703"].includes(error.code ?? "")) {
    return new Error("ميزة طلبات المواد غير مهيأة في قاعدة البيانات. طبّق ملفات migration الخاصة بها أولاً.");
  }
  return new Error(error.message);
}

async function callRpc<T>(db: RpcClient, name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw migrationError(error);
  return data as T;
}

function rpcClient(supabase: unknown) {
  return supabase as RpcClient;
}

export const getMaterialRequestOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    callRpc<MaterialRequestOptions>(rpcClient(context.supabase), "material_request_options"),
  );

export const getMaterialRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({
      requestType: z.enum(["material", "equipment"]).optional(),
      search: z.string().max(200).optional(),
      status: z.string().max(40).optional(),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const response = await callRpc<{ requests: MaterialRequest[]; actor: MaterialRequestActor }>(
      rpcClient(context.supabase),
      "material_request_list",
      {
        _request_type: data.requestType ?? null,
        _search: data.search?.trim() || null,
        _status: data.status || null,
      },
    );
    return response;
  });

export const createMaterialRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data, context }) => {
    const db = rpcClient(context.supabase);
    const actor = await getActor(db);
    if (!actorAllowed(actor, ["engineer", "department_manager", "supervisor", "site_admin"])) {
      throw new Error("لا تملك صلاحية تقديم طلب مواد أو معدات");
    }
    if (
      !actor.company_manager &&
      !actor.department_ids.includes(data.department_id) &&
      actor.employee_department_id !== data.department_id
    ) {
      throw new Error("القسم المختار خارج نطاق صلاحيتك");
    }
    return callRpc<RequestActionResult>(db, "material_request_create", {
      _request_type: data.request_type,
      _site_id: data.site_id,
      _department_id: data.department_id,
      _reason: data.reason,
      _need_by_date: data.need_by_date ?? null,
      _items: data.items.map((item) => ({
        item_name: item.item_name,
        unit: item.unit,
        quantity: item.quantity,
        specifications: item.specifications,
      })),
      _submit: data.submit,
    });
  });

export const editMaterialRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    createSchema.extend({ request_id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const db = rpcClient(context.supabase);
    const actor = await getActor(db);
    if (!actorAllowed(actor, ["engineer", "department_manager", "supervisor", "site_admin"])) {
      throw new Error("لا تملك صلاحية تعديل الطلب");
    }
    return callRpc<RequestActionResult>(db, "material_request_edit", {
      _request_id: data.request_id,
      _site_id: data.site_id,
      _reason: data.reason,
      _need_by_date: data.need_by_date ?? null,
      _items: data.items,
      _submit: data.submit,
    });
  });

export const reviewMaterialRequestPlanning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({
      request_id: z.string().uuid(),
      action: z.enum(["approve", "return", "reject"]),
      note: z.string().trim().max(1000).default(""),
      items: z.array(z.object({ id: z.string().uuid(), approved_qty: z.number().finite().min(0), note: z.string().max(1000).default("") })),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const db = rpcClient(context.supabase);
    const actor = await getActor(db);
    if (!actorAllowed(actor, ["planning_officer"])) throw new Error("هذا الإجراء لمسؤول التخطيط");
    return callRpc<RequestActionResult>(db, "material_request_planning_review", {
      _request_id: data.request_id,
      _action: data.action,
      _note: data.note,
      _items: data.items,
    });
  });

export const reviewMaterialRequestWarehouse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({
      request_id: z.string().uuid(),
      items: z.array(z.object({
        id: z.string().uuid(),
        warehouse_item_id: z.string().uuid().nullable(),
        warehouse_id: z.string().uuid().nullable(),
        is_new_item: z.boolean(),
        issue_qty: z.number().finite().min(0),
        purchase_qty: z.number().finite().min(0),
        reason: z.string().trim().max(1000).default(""),
      })),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const db = rpcClient(context.supabase);
    const actor = await getActor(db);
    if (!actorAllowed(actor, ["warehouse_keeper"])) throw new Error("هذا الإجراء لمسؤول المخازن");
    return callRpc<RequestActionResult>(db, "material_request_warehouse_review", {
      _request_id: data.request_id,
      _items: data.items,
    });
  });

export const createMaterialPurchaseBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({
      request_id: z.string().uuid(),
      supplier: z.string().trim().min(2).max(200),
      document_number: z.string().trim().max(150).default(""),
      purchase_date: z.string().date(),
      notes: z.string().trim().max(1000).default(""),
      items: z.array(z.object({
        id: z.string().uuid(),
        quantity: z.number().finite().min(0),
        not_purchased_reason: z.string().trim().max(1000).default(""),
      })).min(1),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const db = rpcClient(context.supabase);
    const actor = await getActor(db);
    if (!actorAllowed(actor, ["procurement_officer"])) throw new Error("هذا الإجراء لمسؤول المشتريات");
    return callRpc<RequestActionResult>(db, "material_request_add_purchase_batch", {
      _request_id: data.request_id,
      _supplier: data.supplier,
      _document_number: data.document_number,
      _purchase_date: data.purchase_date,
      _notes: data.notes,
      _items: data.items,
    });
  });

export const sendMaterialPurchaseBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ batch_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const db = rpcClient(context.supabase);
    const actor = await getActor(db);
    if (!actorAllowed(actor, ["procurement_officer"])) throw new Error("هذا الإجراء لمسؤول المشتريات");
    return callRpc<RequestActionResult>(db, "material_request_send_purchase_batch", { _batch_id: data.batch_id });
  });

export const receiveMaterialPurchaseBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({
      batch_id: z.string().uuid(),
      warehouse_id: z.string().uuid(),
      idempotency_key: z.string().uuid(),
      notes: z.string().trim().max(1000).default(""),
      items: z.array(z.object({
        batch_item_id: z.string().uuid(),
        received_qty: z.number().finite().min(0),
        did_not_arrive: z.boolean(),
        shortage_reason: z.string().trim().max(1000).default(""),
        exclusion_reason: z.string().trim().max(1000).default(""),
        approved_by: z.string().uuid().nullable(),
        warehouse_item_id: z.string().uuid().nullable(),
        new_item_name: z.string().trim().max(200).default(""),
        new_item_unit: z.string().trim().max(60).default(""),
        serial_notes: z.string().trim().max(1000).default(""),
      })).min(1),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const db = rpcClient(context.supabase);
    const actor = await getActor(db);
    if (!actorAllowed(actor, ["warehouse_keeper"])) throw new Error("هذا الإجراء لمسؤول المخازن");
    return callRpc<RequestActionResult>(db, "material_request_receive_batch", {
      _batch_id: data.batch_id,
      _warehouse_id: data.warehouse_id,
      _idempotency_key: data.idempotency_key,
      _notes: data.notes,
      _items: data.items,
    });
  });

export const closeMaterialRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ request_id: z.string().uuid(), reason: z.string().trim().min(3).max(1000) }).parse(data))
  .handler(async ({ data, context }) => {
    const db = rpcClient(context.supabase);
    const actor = await getActor(db);
    if (!actor.company_manager) throw new Error("إغلاق الطلب يتطلب الأدمن أو مدير الشركة");
    return callRpc<RequestActionResult>(db, "material_request_close", { _request_id: data.request_id, _reason: data.reason });
  });

export const reopenMaterialRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ request_id: z.string().uuid(), reason: z.string().trim().min(3).max(1000) }).parse(data))
  .handler(async ({ data, context }) => {
    const db = rpcClient(context.supabase);
    const actor = await getActor(db);
    if (!actor.roles.includes("admin")) throw new Error("إعادة فتح الطلب للأدمن فقط");
    return callRpc<RequestActionResult>(db, "material_request_reopen", { _request_id: data.request_id, _reason: data.reason });
  });

export const cancelMaterialRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ request_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) =>
    callRpc<RequestActionResult>(rpcClient(context.supabase), "material_request_cancel", { _request_id: data.request_id }),
  );