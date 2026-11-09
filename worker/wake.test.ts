import { describe, expect, it } from "vitest";

import {
  handleStart,
  handleStatus,
  projectRef,
  serverState,
  type WakeEnv,
} from "./wake";

const ENV: WakeEnv = {
  SUPABASE_URL: "https://abcdefghij.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_ACCESS_TOKEN: "sbp_secret",
};

/** A fake Supabase: the API's health, the project's status, and a record of every call. */
function supabase(health: number, status: string | null) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/auth/v1/health"))
      return new Response("{}", { status: health });
    if (url.endsWith("/restore")) return new Response("{}", { status: 200 });
    if (url.includes("api.supabase.com")) {
      if (status === null) return new Response("{}", { status: 401 });
      return new Response(JSON.stringify({ status }), { status: 200 });
    }
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const post = () =>
  new Request("https://boards.example/api/supabase/start", { method: "POST" });

describe("projectRef", () => {
  it("comes from the project URL unless set", () => {
    expect(projectRef(ENV)).toBe("abcdefghij");
    expect(projectRef({ ...ENV, SUPABASE_PROJECT_REF: "other" })).toBe("other");
    expect(
      projectRef({ ...ENV, SUPABASE_URL: "https://db.example.com" }),
    ).toBeNull();
  });
});

describe("serverState", () => {
  it("is up when the API answers, without asking the Management API", async () => {
    const { fetcher, calls } = supabase(200, null);
    expect(await serverState(ENV, fetcher)).toBe("up");
    expect(calls).toHaveLength(1);
  });

  it("reads a paused project as asleep", async () => {
    expect(await serverState(ENV, supabase(540, "INACTIVE").fetcher)).toBe(
      "asleep",
    );
  });

  it("reads a restoring project as waking", async () => {
    expect(await serverState(ENV, supabase(503, "COMING_UP").fetcher)).toBe(
      "waking",
    );
  });

  it("is unavailable when nothing can be asked", async () => {
    const env = { ...ENV, SUPABASE_ACCESS_TOKEN: undefined };
    expect(await serverState(env, supabase(503, "INACTIVE").fetcher)).toBe(
      "unavailable",
    );
    expect(await serverState(ENV, supabase(503, null).fetcher)).toBe(
      "unavailable",
    );
  });

  it("sends the access token only to the Management API", async () => {
    const { fetcher, calls } = supabase(540, "INACTIVE");
    await serverState(ENV, fetcher);
    const health = calls[0].init?.headers as Record<string, string>;
    const management = calls[1].init?.headers as Record<string, string>;
    expect(health.authorization).toBeUndefined();
    expect(calls[1].url).toBe(
      "https://api.supabase.com/v1/projects/abcdefghij",
    );
    expect(management.authorization).toBe("Bearer sbp_secret");
  });
});

describe("handleStatus", () => {
  it("says whether the page may offer to start the server", async () => {
    const body = await (
      await handleStatus(ENV, supabase(540, "INACTIVE").fetcher)
    ).json();
    expect(body).toEqual({ state: "asleep", canStart: true });

    const unset = await (
      await handleStatus(
        { ...ENV, SUPABASE_ACCESS_TOKEN: undefined },
        supabase(540, "INACTIVE").fetcher,
      )
    ).json();
    expect(unset).toEqual({ state: "unavailable", canStart: false });
  });
});

describe("handleStart", () => {
  it("restores a paused project", async () => {
    const { fetcher, calls } = supabase(540, "INACTIVE");
    const response = await handleStart(post(), ENV, fetcher);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ state: "waking" });
    const restore = calls.find((call) => call.url.endsWith("/restore"));
    expect(restore?.url).toBe(
      "https://api.supabase.com/v1/projects/abcdefghij/restore",
    );
    expect(restore?.init?.method).toBe("POST");
  });

  it("does nothing to a project that is not paused", async () => {
    for (const [health, status, state] of [
      [200, "ACTIVE_HEALTHY", "up"],
      [503, "COMING_UP", "waking"],
    ] as const) {
      const { fetcher, calls } = supabase(health, status);
      const body = await (await handleStart(post(), ENV, fetcher)).json();
      expect(body).toEqual({ state });
      expect(calls.some((call) => call.url.endsWith("/restore"))).toBe(false);
    }
  });

  it("refuses when waking is not configured, and to anything but POST", async () => {
    const { fetcher } = supabase(540, "INACTIVE");
    expect(
      (
        await handleStart(
          post(),
          { ...ENV, SUPABASE_ACCESS_TOKEN: undefined },
          fetcher,
        )
      ).status,
    ).toBe(501);
    expect(
      (
        await handleStart(
          new Request("https://boards.example/api/supabase/start"),
          ENV,
          fetcher,
        )
      ).status,
    ).toBe(405);
  });
});
