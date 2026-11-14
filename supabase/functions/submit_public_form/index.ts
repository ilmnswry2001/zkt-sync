import { createClient } from "npm:@supabase/supabase-js@2";
import { submitPublicForm } from "../_shared/submit-public-form.ts";

const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(Deno.env.get("SUPABASE_URL")!, secret, { auth: { persistSession: false } });
Deno.serve((req) => submitPublicForm(req, db, secret, Deno.env.get("TURNSTILE_SECRET_KEY")));
