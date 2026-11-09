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

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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
  if (!(await env.IMAGES.head(key))) {
    await env.IMAGES.put(key, bytes, { httpMetadata: { contentType: type } });
  }

  return json({ url: `${url.origin}/images/${key}` }, 201);
}

export async function handleImage(
  request: Request,
  env: ImageEnv,
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

  const object = await env.IMAGES.get(key);
  if (!object) return new Response(null, { status: 404 });

  return new Response(request.method === "HEAD" ? null : object.body, {
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
  });
}
