// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { BoardLibrary } from "../boards/library";
import { setSupabaseForTests } from "../supabase/client";
import { EntryScreen } from "./JoinScreen";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const client = {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: ME } } } }),
  },
} as unknown as SupabaseClient;

beforeEach(() => {
  localStorage.clear();
  setSupabaseForTests(client);
});

afterEach(() => setSupabaseForTests(null));

function renderEntry() {
  return render(
    <EntryScreen
      kind="join"
      token="token"
      library={{} as BoardLibrary}
      onDone={() => {}}
    />,
  );
}

/** The name field, which shows what everyone else will see. */
async function nameField(): Promise<HTMLInputElement> {
  const field = await screen.findByLabelText("Your name on this board");
  await waitFor(() =>
    expect((field as HTMLInputElement).value).toMatch(/^Anonymous /),
  );
  return field as HTMLInputElement;
}

describe("EntryScreen", () => {
  it("shows an anonymous joiner a capitalised creature", async () => {
    renderEntry();
    expect((await nameField()).value).toMatch(/^Anonymous [A-Z][a-z]+$/);
  });

  it("gives a different creature when the name is re-rolled", async () => {
    renderEntry();
    const field = await nameField();
    const before = field.value;

    fireEvent.click(screen.getByTestId("reroll-name"));

    expect(field.value).not.toBe(before);
    expect(field.value).toMatch(/^Anonymous [A-Z][a-z]+$/);
  });

  it("has no re-roll once a name has been chosen", async () => {
    renderEntry();
    await nameField();

    fireEvent.click(screen.getByLabelText("Stay anonymous"));

    expect(screen.queryByTestId("reroll-name")).toBeNull();
  });
});
