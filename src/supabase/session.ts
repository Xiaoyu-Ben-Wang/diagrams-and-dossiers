/**
 * The stable `user_id` every browser has, which is what makes attribution
 * ("who pinned this") and presence ("who is here") possible at all with no
 * accounts. Anonymous sign-in is the whole mechanism; §1 calls it identity
 * without accounts and it is exactly that.
 *
 * Nothing else in the app may call this. `/demo`, the seeded board and the whole
 * jsdom suite have no project behind them, and `getSupabase()` throws when the
 * environment is absent — so this is reached only from joining or creating a
 * board, and it answers `null` rather than throwing so a misconfigured project
 * degrades to the local library instead of taking the shell down.
 */
import { getSupabase } from "./client";

export interface Session {
  userId: string;
}

export async function ensureSession(): Promise<Session | null> {
  try {
    const supabase = getSupabase();

    const { data } = await supabase.auth.getSession();
    if (data.session?.user) return { userId: data.session.user.id };

    // Persisted by the client, so this happens once per browser rather than per load.
    const { data: created, error } = await supabase.auth.signInAnonymously();
    if (error || !created.user) return null;
    return { userId: created.user.id };
  } catch {
    return null;
  }
}
