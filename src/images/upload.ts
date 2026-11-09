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

export async function uploadImage(
  blob: Blob,
  boardId: string,
  fetcher: typeof fetch = fetch,
  accessToken: () => Promise<string | null> = currentAccessToken,
): Promise<string | null> {
  try {
    const token = await accessToken();
    if (!token) return null;

    const response = await fetcher(uploadEndpoint(boardId), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": blob.type || "application/octet-stream",
      },
      body: blob,
    });
    if (!response.ok) return null;

    const body = (await response.json()) as { url?: unknown };
    return typeof body.url === "string" && isHttpImageSrc(body.url)
      ? body.url
      : null;
  } catch (error) {
    console.warn("board: could not upload a picture", error);
    return null;
  }
}

async function currentAccessToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}
