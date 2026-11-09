// Whether the Supabase project is up, and waking it when the free tier has
// paused it. Waking needs the Management API and a personal access token, so it
// happens here, where the token is a Worker secret, and never in the browser.

export type ServerState = "up" | "asleep" | "waking" | "unavailable";

export interface WakeEnv {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  /** A Supabase personal access token. Without it the page can report but not wake. */
  SUPABASE_ACCESS_TOKEN?: string;
  /** Defaults to the subdomain of SUPABASE_URL. */
  SUPABASE_PROJECT_REF?: string;
}

export const STATUS_PATH = "/api/supabase/status";
export const START_PATH = "/api/supabase/start";

const MANAGEMENT_API = "https://api.supabase.com/v1/projects";
const PROBE_TIMEOUT_MS = 4000;

const ASLEEP = new Set(["INACTIVE", "PAUSING", "GOING_DOWN"]);
const WAKING = new Set([
  "RESTORING",
  "COMING_UP",
  "RESTARTING",
  "UPGRADING",
  "RESIZING",
  "ACTIVE_HEALTHY",
  "ACTIVE_UNHEALTHY",
]);

export function projectRef(env: WakeEnv): string | null {
  if (env.SUPABASE_PROJECT_REF) return env.SUPABASE_PROJECT_REF;
  try {
    const host = new URL(env.SUPABASE_URL).hostname;
    return host.endsWith(".supabase.co") ? host.split(".")[0] : null;
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

async function apiIsUp(env: WakeEnv, fetcher: typeof fetch): Promise<boolean> {
  try {
    const response = await fetcher(
      `${env.SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/health`,
      {
        headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

/** The project's status as the Management API reports it, or null if it cannot be asked. */
async function projectStatus(
  env: WakeEnv,
  fetcher: typeof fetch,
): Promise<string | null> {
  const ref = projectRef(env);
  if (!env.SUPABASE_ACCESS_TOKEN || !ref) return null;
  try {
    const response = await fetcher(`${MANAGEMENT_API}/${ref}`, {
      headers: { authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { status?: unknown };
    return typeof body.status === "string" ? body.status : null;
  } catch {
    return null;
  }
}

function stateOf(status: string | null): ServerState {
  if (status === null) return "unavailable";
  if (ASLEEP.has(status)) return "asleep";
  if (WAKING.has(status)) return "waking";
  return "unavailable";
}

export async function serverState(
  env: WakeEnv,
  fetcher: typeof fetch = fetch,
): Promise<ServerState> {
  if (await apiIsUp(env, fetcher)) return "up";
  return stateOf(await projectStatus(env, fetcher));
}

export async function handleStatus(
  env: WakeEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  return json({
    state: await serverState(env, fetcher),
    canStart: Boolean(env.SUPABASE_ACCESS_TOKEN && projectRef(env)),
  });
}

/**
 * Restores the project if it is paused, and only then: the call is open to
 * anyone who can load the page, so it does nothing a visitor could misuse.
 */
export async function handleStart(
  request: Request,
  env: WakeEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== "POST")
    return json({ error: "method not allowed" }, 405);

  const ref = projectRef(env);
  if (!env.SUPABASE_ACCESS_TOKEN || !ref)
    return json({ error: "waking is not configured" }, 501);

  if (await apiIsUp(env, fetcher)) return json({ state: "up" });

  const status = await projectStatus(env, fetcher);
  if (status !== "INACTIVE") return json({ state: stateOf(status) });

  try {
    const response = await fetcher(`${MANAGEMENT_API}/${ref}/restore`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` },
    });
    if (!response.ok) return json({ error: "Supabase refused" }, 502);
  } catch {
    return json({ error: "Supabase could not be reached" }, 502);
  }
  return json({ state: "waking" }, 202);
}
