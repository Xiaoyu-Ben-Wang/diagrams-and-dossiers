/** The Supabase project's public coordinates. Both ship to the browser; RLS is
 *  what protects the rows, and the database password is not one of these. */
export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is not set — copy .env.example to .env.local`);
  }
  return value;
}

export function supabaseConfig(env: ImportMetaEnv = import.meta.env): SupabaseConfig {
  return {
    url: required(env.VITE_SUPABASE_URL, "VITE_SUPABASE_URL"),
    publishableKey: required(
      env.VITE_SUPABASE_PUBLISHABLE_KEY,
      "VITE_SUPABASE_PUBLISHABLE_KEY",
    ),
  };
}
