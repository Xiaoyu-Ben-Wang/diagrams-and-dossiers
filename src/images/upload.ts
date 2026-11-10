/**
 * Sends a picture to the Worker, which keeps it in R2 and answers with its URL.
 *
 * Answers `null` on any failure, and the caller keeps the picture as a data URL
 * instead: a dev server or the GitHub Pages build has no Worker behind it, and a
 * picture that stays inline is better than one that is lost.
 */
import { isHttpImageSrc } from "../model/image-src";
import { getSupabase } from "../supabase/client";

export const UPLOAD_PATH = "/api/images";

export function uploadEndpoint(
  boardId: string,
  origin: string = window.location.origin,
): string {
  const url = new URL(UPLOAD_PATH, origin);
  url.searchParams.set("board", boardId);
  return url.toString();
}

/**
 * `limit` means the upload quota is spent, and the picture must not go in at
 * all: keeping it inline would only move the same bytes into the database.
 * `failed` means there was no Worker to take it, and inline is the fallback.
 */
export type UploadResult =
  { kind: "stored"; url: string } | { kind: "limit" } | { kind: "failed" };

const FAILED: UploadResult = { kind: "failed" };

export async function uploadImage(
  blob: Blob,
  boardId: string,
  fetcher: typeof fetch = fetch,
  accessToken: () => Promise<string | null> = currentAccessToken,
): Promise<UploadResult> {
  try {
    const token = await accessToken();
    if (!token) return FAILED;

    const response = await fetcher(uploadEndpoint(boardId), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": blob.type || "application/octet-stream",
      },
      body: blob,
    });
    if (response.status === 429) return { kind: "limit" };
    if (!response.ok) return FAILED;

    const body = (await response.json()) as { url?: unknown };
    return typeof body.url === "string" && isHttpImageSrc(body.url)
      ? { kind: "stored", url: body.url }
      : FAILED;
  } catch (error) {
    console.warn("board: could not upload a picture", error);
    return FAILED;
  }
}

async function currentAccessToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}
