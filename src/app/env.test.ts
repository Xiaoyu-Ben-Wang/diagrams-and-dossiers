import { describe, expect, it } from "vitest";

import { supabaseConfig } from "./env";

const FILLED = {
  VITE_SUPABASE_URL: "https://project-ref.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_key",
} as ImportMetaEnv;

describe("supabaseConfig", () => {
  it("reads the url and the publishable key", () => {
    expect(supabaseConfig(FILLED)).toEqual({
      url: "https://project-ref.supabase.co",
      publishableKey: "sb_publishable_key",
    });
  });

  it("names the variable that is missing", () => {
    const env = {
      ...FILLED,
      VITE_SUPABASE_PUBLISHABLE_KEY: undefined,
    } as ImportMetaEnv;
    expect(() => supabaseConfig(env)).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("treats an empty string as missing, not as a value", () => {
    const env = { ...FILLED, VITE_SUPABASE_URL: "" } as ImportMetaEnv;
    expect(() => supabaseConfig(env)).toThrow(/VITE_SUPABASE_URL/);
  });
});
