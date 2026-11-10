// Picture uploads into R2, and serving them back.
//
// Keys are `<sha-256 of the bytes>.<ext>`: the same picture uploaded twice is one
// object, and an object never changes, so it can be cached forever. The board id
// is deliberately left out: a picture's URL travels further than the board does,
// and a shared board opens for anyone holding its id.
// Nothing is ever deleted when a picture leaves a board, because version history
// may still point at it.

/** The slice of the R2 API this file uses, so it type-checks without workers-types. */
export interface ImageBucket {
  head(key: string): Promise<object | null>;
  put(
    key: string,
    value: ArrayBuffer,
    options: { httpMetadata: { contentType: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{
    body: ReadableStream;
    httpEtag: string;
    httpMetadata?: { contentType?: string };
  } | null>;
}

export interface ImageEnv {
  IMAGES: ImageBucket;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
}

/** Above the client's 2 MB re-encode budget, for the GIFs and SVGs it passes through untouched. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

const CONTENT_TYPES = Object.fromEntries(
  Object.entries(EXTENSIONS).map(([type, ext]) => [ext, type]),
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_PATH = /^\/images\/([0-9a-f]{64})\.([a-z]{3,4})$/;

export const UPLOAD_PATH = "/api/images";

function json(
  body: unknown,
  status: number,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extra },
  });
}

/** The Workers edge cache, where it exists; tests and other runtimes have none. */
export interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

function edgeCache(): EdgeCache | null {
  const caches = (globalThis as { caches?: { default?: EdgeCache } }).caches;
  return caches?.default ?? null;
}

/**
 * Asks Supabase whether the bearer of this token may edit the board. The token is
 * the user's own session, so `is_editor` answers for them, and a forged or expired
 * token fails at PostgREST before the function runs.
 */
export async function canEdit(
  env: ImageEnv,
  token: string,
  boardId: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const response = await fetcher(
    `${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/is_editor`,
    {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ b: boardId }),
    },
  );
  if (!response.ok) return false;
  return (await response.json()) === true;
}

export type Reservation = "ok" | "limit" | "refused";

/**
 * Asks Supabase to count a new upload against the caller's quota, as the caller.
 * `reserve_upload` checks edit rights and the per-user and per-IP limits, and
 * records the upload only when it fits.
 */
export async function reserveUpload(
  env: ImageEnv,
  token: string,
  boardId: string,
  bytes: number,
  ip: string | null,
  fetcher: typeof fetch = fetch,
): Promise<Reservation> {
  const response = await fetcher(
    `${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/reserve_upload`,
    {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_board: boardId, p_bytes: bytes, p_ip: ip }),
    },
  );
  if (!response.ok) return "refused";
  const answer = await response.json();
  if (answer === "ok") return "ok";
  if (answer === "limit") return "limit";
  return "refused";
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function handleUpload(
  request: Request,
  env: ImageEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== "POST")
    return json({ error: "method not allowed" }, 405);

  const url = new URL(request.url);
  const boardId = url.searchParams.get("board") ?? "";
  if (!UUID.test(boardId)) return json({ error: "bad board id" }, 400);

  const token = /^Bearer (.+)$/i.exec(
    request.headers.get("authorization") ?? "",
  )?.[1];
  if (!token) return json({ error: "not signed in" }, 401);

  const type = (request.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const ext = EXTENSIONS[type];
  if (!ext) return json({ error: "not a supported image type" }, 415);

  // Required, so an oversized body is refused before it is read into memory.
  const length = request.headers.get("content-length");
  if (length === null) return json({ error: "length required" }, 411);
  if (Number(length) > MAX_IMAGE_BYTES)
    return json({ error: "too large" }, 413);

  if (!(await canEdit(env, token, boardId.toLowerCase(), fetcher)))
    return json({ error: "not allowed" }, 403);

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) return json({ error: "empty" }, 400);
  if (bytes.byteLength > MAX_IMAGE_BYTES)
    return json({ error: "too large" }, 413);

  const key = `${await sha256Hex(bytes)}.${ext}`;
  // A picture R2 already holds costs nothing more, so only a new one is counted.
  if (!(await env.IMAGES.head(key))) {
    const reserved = await reserveUpload(
      env,
      token,
      boardId.toLowerCase(),
      bytes.byteLength,
      request.headers.get("cf-connecting-ip"),
      fetcher,
    );
    if (reserved === "limit")
      return json({ error: "limit" }, 429, { "retry-after": "3600" });
    if (reserved !== "ok") return json({ error: "not allowed" }, 403);
    await env.IMAGES.put(key, bytes, { httpMetadata: { contentType: type } });
  }

  return json({ url: `${url.origin}/images/${key}` }, 201);
}

/**
 * Served through the edge cache, so a picture loaded over and over is read from
 * R2 once per data centre rather than once per view.
 */
export async function handleImage(
  request: Request,
  env: ImageEnv,
  ctx?: WaitUntil,
  cache: EdgeCache | null = edgeCache(),
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response(null, { status: 405 });

  const match = IMAGE_PATH.exec(new URL(request.url).pathname);
  const contentType = match ? CONTENT_TYPES[match[2]] : undefined;
  if (!match || !contentType) return new Response(null, { status: 404 });

  const key = `${match[1]}.${match[2]}`;
  const etag = `"${match[1]}"`;
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers: { etag } });

  if (request.method === "GET" && cache) {
    const hit = await cache.match(request);
    if (hit) return hit;
  }

  const object = await env.IMAGES.get(key);
  if (!object) return new Response(null, { status: 404 });

  const response = new Response(
    request.method === "HEAD" ? null : object.body,
    {
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=31536000, immutable",
        etag,
        // Readable from any origin so a board exported to PNG does not taint its canvas.
        "access-control-allow-origin": "*",
        "x-content-type-options": "nosniff",
        // An uploaded SVG opened on its own must not run script on this origin.
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    },
  );
  if (request.method === "GET" && cache) {
    const stored = cache.put(request, response.clone());
    if (ctx) ctx.waitUntil(stored);
    else await stored;
  }
  return response;
}
