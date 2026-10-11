import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createSupabase, getSupabase, setSupabaseForTests } from "./client";

// Stubbed so the suite passes on a checkout with no `.env.local`: the real
// `supabaseConfig()` throws when the environment is absent.
vi.mock("../app/env", () => ({
  supabaseConfig: () => ({
    url: "https://project-ref.supabase.co",
    publishableKey: "sb_publishable_key",
  }),
}));

const CONFIG = {
  url: "https://project-ref.supabase.co",
  publishableKey: "sb_publishable_key",
};

// `supabaseUrl` is protected on the client's type in v2, so the assertion reads
// it through a cast rather than widening the exported type for a test.
function urlOf(client: SupabaseClient): string {
  return (client as unknown as { supabaseUrl: string }).supabaseUrl;
}

describe("createSupabase", () => {
  it("points the client at the configured project", () => {
    expect(urlOf(createSupabase(CONFIG))).toBe(CONFIG.url);
  });
});

describe("getSupabase", () => {
  it("hands back one client, not a new one per call", () => {
    setSupabaseForTests(null);
    const first = getSupabase();
    expect(getSupabase()).toBe(first);
    setSupabaseForTests(null);
  });
});
