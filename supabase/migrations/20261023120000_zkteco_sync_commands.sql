CREATE TABLE IF NOT EXISTS public.device_sync_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text
);

CREATE INDEX IF NOT EXISTS device_sync_commands_device_time_idx
  ON public.device_sync_commands(device_id, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS device_sync_commands_one_active_per_device_idx
  ON public.device_sync_commands(device_id)
  WHERE status IN ('pending', 'running');

ALTER TABLE public.device_sync_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_sync_commands FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.device_sync_commands TO service_role;
