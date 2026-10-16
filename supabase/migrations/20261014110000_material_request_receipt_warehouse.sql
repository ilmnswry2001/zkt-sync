-- Store the destination warehouse for each receipt. The workflow RPC and list
-- already write and return this value, so the base table must carry it too.
ALTER TABLE public.material_request_receipts
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE RESTRICT;

-- Recover the warehouse for historical receipts from their stock movements.
UPDATE public.material_request_receipts receipt
SET warehouse_id = movement.warehouse_id
FROM (
  SELECT material_request_receipt_id, min(warehouse_id::text)::uuid AS warehouse_id
  FROM public.stock_movements
  WHERE material_request_receipt_id IS NOT NULL
  GROUP BY material_request_receipt_id
) movement
WHERE receipt.id = movement.material_request_receipt_id
  AND receipt.warehouse_id IS NULL;

NOTIFY pgrst, 'reload schema';
