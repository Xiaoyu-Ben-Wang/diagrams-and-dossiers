import { describe, expect, it } from "vitest";

import {
  handleImage,
  handleUpload,
  MAX_IMAGE_BYTES,
  type ImageBucket,
  type ImageEnv,
} from "./images";

const BOARD = "0b7e2a52-3c1d-4d55-9a8e-6f0c1b2a3d4e";
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

function memoryBucket() {
  const objects = new Map<string, { bytes: ArrayBuffer; type: string }>();
  let puts = 0;
  const bucket: ImageBucket = {
    async head(key) {
      return objects.has(key) ? {} : null;
    },
    async put(key, value, options) {
      puts += 1;
      objects.set(key, {
        bytes: value,
        type: options.httpMetadata.contentType,
      });
    },
    async get(key) {
      const object = objects.get(key);
      if (!object) return null;
      return {
        body: new Response(object.bytes).body!,
        httpEtag: "x",
        httpMetadata: { contentType: object.type },
      };
    },
  };
  return { bucket, objects, puts: () => puts };
}

function envWith(bucket: ImageBucket): ImageEnv {
  return {
    IMAGES: bucket,
    SUPABASE_URL: "https://project.supabase.co/",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  };
}

/** Answers `is_editor` with `allowed`, and records what it was asked. */
function supabase(allowed: boolean | "error") {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (allowed === "error") return new Response("{}", { status: 401 });
    return new Response(JSON.stringify(allowed), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

function upload(
  options: {
    board?: string;
    token?: string | null;
    type?: string;
    body?: Uint8Array<ArrayBuffer>;
    method?: string;
    length?: boolean;
  } = {},
): Request {
  const headers = new Headers({ "content-type": options.type ?? "image/png" });
  if (options.length !== false && options.method !== "GET")
    headers.set("content-length", String((options.body ?? PNG).byteLength));
  const token = options.token === undefined ? "user-jwt" : options.token;
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request(
    `https://boards.example/api/images?board=${options.board ?? BOARD}`,
    {
      method: options.method ?? "POST",
      headers,
      body: options.method === "GET" ? undefined : (options.body ?? PNG),
    },
  );
}

describe("handleUpload", () => {
  it("stores the picture under its hash and answers with a full URL", async () => {
    const { bucket, objects } = memoryBucket();
    const { fetcher, calls } = supabase(true);

    const response = await handleUpload(upload(), envWith(bucket), fetcher);

    expect(response.status).toBe(201);
    const { url } = (await response.json()) as { url: string };
    expect(url).toMatch(
      new RegExp(`^https://boards\\.example/images/[0-9a-f]{64}\\.png$`),
    );
    expect([...objects.keys()]).toEqual([url.split("/images/")[1]]);
    expect(objects.values().next().value?.type).toBe("image/png");

    expect(calls[0].url).toBe(
      "https://project.supabase.co/rest/v1/rpc/is_editor",
    );
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer user-jwt");
    expect(headers.apikey).toBe("sb_publishable_test");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ b: BOARD });
  });

  it("writes the same picture once", async () => {
    const { bucket, puts } = memoryBucket();
    const { fetcher } = supabase(true);
    const env = envWith(bucket);

    const first = await (await handleUpload(upload(), env, fetcher)).json();
    const second = await (await handleUpload(upload(), env, fetcher)).json();

    expect(second).toEqual(first);
    expect(puts()).toBe(1);
  });

  it("refuses someone who cannot edit the board", async () => {
    const { bucket, objects } = memoryBucket();
    const response = await handleUpload(
      upload(),
      envWith(bucket),
      supabase(false).fetcher,
    );
    expect(response.status).toBe(403);
    expect(objects.size).toBe(0);
  });

  it("refuses a token Supabase rejects", async () => {
    const { bucket } = memoryBucket();
    const response = await handleUpload(
      upload(),
      envWith(bucket),
      supabase("error").fetcher,
    );
    expect(response.status).toBe(403);
  });

  it("refuses a request with no session", async () => {
    const { bucket } = memoryBucket();
    const { fetcher, calls } = supabase(true);
    const response = await handleUpload(
      upload({ token: null }),
      envWith(bucket),
      fetcher,
    );
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("refuses a board id that is not a uuid", async () => {
    const { bucket } = memoryBucket();
    const response = await handleUpload(
      upload({ board: "../etc" }),
      envWith(bucket),
      supabase(true).fetcher,
    );
    expect(response.status).toBe(400);
  });

  it("refuses something that is not a picture", async () => {
    const { bucket } = memoryBucket();
    const response = await handleUpload(
      upload({ type: "text/html" }),
      envWith(bucket),
      supabase(true).fetcher,
    );
    expect(response.status).toBe(415);
  });

  it("refuses an empty body and an oversized one", async () => {
    const { bucket } = memoryBucket();
    const { fetcher } = supabase(true);
    const env = envWith(bucket);

    const empty = await handleUpload(
      upload({ body: new Uint8Array(0) }),
      env,
      fetcher,
    );
    expect(empty.status).toBe(400);

    const huge = await handleUpload(
      upload({ body: new Uint8Array(MAX_IMAGE_BYTES + 1) }),
      env,
      fetcher,
    );
    expect(huge.status).toBe(413);
  });

  it("refuses an upload that does not say how large it is", async () => {
    const { bucket } = memoryBucket();
    const response = await handleUpload(
      upload({ length: false }),
      envWith(bucket),
      supabase(true).fetcher,
    );
    expect(response.status).toBe(411);
  });

  it("only takes POST", async () => {
    const { bucket } = memoryBucket();
    const response = await handleUpload(
      upload({ method: "GET" }),
      envWith(bucket),
      supabase(true).fetcher,
    );
    expect(response.status).toBe(405);
  });
});

describe("handleImage", () => {
  it("serves a stored picture with long-lived, locked-down headers", async () => {
    const { bucket } = memoryBucket();
    const env = envWith(bucket);
    const { url } = (await (
      await handleUpload(upload(), env, supabase(true).fetcher)
    ).json()) as { url: string };

    const response = await handleImage(new Request(url), env);

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("content-security-policy")).toContain(
      "sandbox",
    );
  });

  it("answers 304 to a matching etag", async () => {
    const { bucket } = memoryBucket();
    const env = envWith(bucket);
    const { url } = (await (
      await handleUpload(upload(), env, supabase(true).fetcher)
    ).json()) as { url: string };
    const etag = (await handleImage(new Request(url), env)).headers.get(
      "etag",
    )!;

    const response = await handleImage(
      new Request(url, { headers: { "if-none-match": etag } }),
      env,
    );
    expect(response.status).toBe(304);
  });

  it("404s an unknown or malformed path", async () => {
    const { bucket } = memoryBucket();
    const env = envWith(bucket);
    const missing = `https://boards.example/images/${"a".repeat(64)}.png`;
    expect((await handleImage(new Request(missing), env)).status).toBe(404);
    expect(
      (await handleImage(new Request("https://boards.example/images/x"), env))
        .status,
    ).toBe(404);
    expect(
      (
        await handleImage(
          new Request(`https://boards.example/images/${"a".repeat(64)}.exe`),
          env,
        )
      ).status,
    ).toBe(404);
  });
});
