// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { uploadEndpoint, uploadImage } from "./upload";

const BOARD = "0b7e2a52-3c1d-4d55-9a8e-6f0c1b2a3d4e";
const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" });
const token = async () => "user-jwt";

function answering(status: number, body: unknown) {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("uploadImage", () => {
  it("posts the bytes with the session and answers the stored URL", async () => {
    const url = `https://boards.example/images/${BOARD}/${"a".repeat(64)}.webp`;
    const fetcher = answering(201, { url });

    expect(await uploadImage(blob, BOARD, fetcher, token)).toBe(url);

    const [endpoint, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe(uploadEndpoint(BOARD));
    expect(init.method).toBe("POST");
    expect(init.body).toBe(blob);
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer user-jwt",
    );
    expect((init.headers as Record<string, string>)["content-type"]).toBe(
      "image/webp",
    );
  });

  it("answers null so the caller keeps the picture inline", async () => {
    expect(
      await uploadImage(blob, BOARD, answering(403, { error: "no" }), token),
    ).toBeNull();
    expect(
      await uploadImage(
        blob,
        BOARD,
        answering(201, { url: "javascript:1" }),
        token,
      ),
    ).toBeNull();
    expect(
      await uploadImage(blob, BOARD, answering(201, {}), async () => null),
    ).toBeNull();
    const offline = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await uploadImage(blob, BOARD, offline, token)).toBeNull();
  });

  it("puts the board in the address", () => {
    expect(uploadEndpoint(BOARD, "https://boards.example")).toBe(
      `https://boards.example/api/images?board=${BOARD}`,
    );
  });
});
