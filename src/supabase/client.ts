import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { supabaseConfig, type SupabaseConfig } from "../app/env";

export function createSupabase(config: SupabaseConfig): SupabaseClient {
  return createClient(config.url, config.publishableKey);
}

let client: SupabaseClient | null = null;

/** Created on first use: `supabaseConfig()` throws when the environment is
 *  absent, and a board has to keep working with no project behind it. */
export function getSupabase(): SupabaseClient {
  if (!client) client = createSupabase(supabaseConfig());
  return client;
}

export function setSupabaseForTests(next: SupabaseClient | null): void {
  client = next;
}
