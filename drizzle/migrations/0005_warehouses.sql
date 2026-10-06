CREATE OR REPLACE FUNCTION public.can_manage_stock(_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.has_role(_uid,'admin') OR public.has_role(_uid,'hr') OR public.has_role(_uid,'data_entry') OR public.has_role(_uid,'site_admin')
$$;

CREATE TABLE public.warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  is_main boolean NOT NULL DEFAULT false,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.warehouse_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'material' CHECK (kind IN ('material','tool')),
  unit text NOT NULL DEFAULT 'قطعة',
  min_qty numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.warehouse_items(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (movement_type IN ('in','issue','return','transfer_out','transfer_in','adjust','tool_out','tool_back')),
  qty_delta numeric NOT NULL,
  movement_date date NOT NULL DEFAULT CURRENT_DATE,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  related_warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  count_id uuid,
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.stock_movements (warehouse_id, item_id);
CREATE INDEX ON public.stock_movements (movement_date);
CREATE TABLE public.stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  count_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.stock_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL REFERENCES public.stock_counts(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.warehouse_items(id) ON DELETE CASCADE,
  system_qty numeric NOT NULL DEFAULT 0,
  counted_qty numeric NOT NULL DEFAULT 0
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouses, public.warehouse_items, public.stock_movements, public.stock_counts, public.stock_count_lines TO authenticated;
GRANT ALL ON public.warehouses, public.warehouse_items, public.stock_movements, public.stock_counts, public.stock_count_lines TO service_role;

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_count_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read warehouses" ON public.warehouses FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage warehouses" ON public.warehouses FOR ALL TO authenticated USING (public.can_manage_stock(auth.uid())) WITH CHECK (public.can_manage_stock(auth.uid()));
CREATE POLICY "read items" ON public.warehouse_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage items" ON public.warehouse_items FOR ALL TO authenticated USING (public.can_manage_stock(auth.uid())) WITH CHECK (public.can_manage_stock(auth.uid()));
CREATE POLICY "read movements" ON public.stock_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage movements" ON public.stock_movements FOR ALL TO authenticated USING (public.can_manage_stock(auth.uid())) WITH CHECK (public.can_manage_stock(auth.uid()));
CREATE POLICY "read counts" ON public.stock_counts FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage counts" ON public.stock_counts FOR ALL TO authenticated USING (public.can_manage_stock(auth.uid())) WITH CHECK (public.can_manage_stock(auth.uid()));
CREATE POLICY "read count lines" ON public.stock_count_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage count lines" ON public.stock_count_lines FOR ALL TO authenticated USING (public.can_manage_stock(auth.uid())) WITH CHECK (public.can_manage_stock(auth.uid()));