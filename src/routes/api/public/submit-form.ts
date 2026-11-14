import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formHeaders,
  submitPublicForm,
} from "../../../../supabase/functions/_shared/submit-public-form";

export const Route = createFileRoute("/api/public/submit-form")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: formHeaders }),
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db: SupabaseClient = supabaseAdmin;
        return submitPublicForm(
          request,
          db,
          process.env.SUPABASE_SERVICE_ROLE_KEY,
          process.env.TURNSTILE_SECRET_KEY,
        );
      },
    },
  },
});
