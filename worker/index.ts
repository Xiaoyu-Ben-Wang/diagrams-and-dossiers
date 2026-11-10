// The Worker in front of the static app. It only runs for the paths listed under
// `run_worker_first` in wrangler.jsonc; every other request goes straight to the
// assets, with the SPA fallback.

import {
  handleImage,
  handleUpload,
  UPLOAD_PATH,
  type ImageEnv,
} from "./images";
import {
  handleStart,
  handleStatus,
  START_PATH,
  STATUS_PATH,
  type WakeEnv,
} from "./wake";

interface Env extends ImageEnv, WakeEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === UPLOAD_PATH) return handleUpload(request, env);
    if (pathname === STATUS_PATH) return handleStatus(env);
    if (pathname === START_PATH) return handleStart(request, env);
    if (pathname.startsWith("/images/")) return handleImage(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
};
