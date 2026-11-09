// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { fetchServerStatus, ServerAsleep } from "./ServerAsleep";

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe("fetchServerStatus", () => {
  it("reads the Worker's answer", async () => {
    const fetcher = vi.fn(async () =>
      reply({ state: "asleep", canStart: true }),
    ) as unknown as typeof fetch;
    expect(await fetchServerStatus(fetcher)).toEqual({
      state: "asleep",
      canStart: true,
    });
  });

  it("answers null where there is no Worker, so the app carries on", async () => {
    const html = vi.fn(
      async () => new Response("<!doctype html>", { status: 200 }),
    ) as unknown as typeof fetch;
    const missing = vi.fn(async () =>
      reply({}, 404),
    ) as unknown as typeof fetch;
    expect(await fetchServerStatus(html)).toBeNull();
    expect(await fetchServerStatus(missing)).toBeNull();
  });
});

describe("ServerAsleep", () => {
  it("starts the server, then hands back once it is up", async () => {
    let state = "asleep";
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        state = "up";
        return reply({ state: "waking" }, 202);
      }
      return reply({ state, canStart: true });
    }) as unknown as typeof fetch;
    const onUp = vi.fn();

    render(
      <ServerAsleep
        initial={{ state: "asleep", canStart: true }}
        fetcher={fetcher}
        onUp={onUp}
        pollMs={10}
      />,
    );
    fireEvent.click(screen.getByTestId("start-server"));

    expect(await screen.findByText("Starting the server…")).toBeTruthy();
    expect(fetcher).toHaveBeenCalledWith("/api/supabase/start", {
      method: "POST",
    });

    await waitFor(() => expect(onUp).toHaveBeenCalled());
  });

  it("says so when starting fails, and offers it again", async () => {
    const fetcher = vi.fn(async () =>
      reply({}, 502),
    ) as unknown as typeof fetch;
    render(
      <ServerAsleep
        initial={{ state: "asleep", canStart: true }}
        fetcher={fetcher}
        onUp={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("start-server"));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByTestId("start-server")).toBeTruthy();
  });

  it("has no Start button when the Worker cannot wake it", () => {
    render(
      <ServerAsleep
        initial={{ state: "asleep", canStart: false }}
        onUp={() => {}}
      />,
    );
    expect(screen.queryByTestId("start-server")).toBeNull();
  });
});
