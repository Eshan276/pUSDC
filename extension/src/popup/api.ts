import type { Req, Res } from "../shared/messages";

/** Talks to the service worker; throws the human-readable error on failure. */
export async function call<T = unknown>(req: Req): Promise<T> {
  const res = (await chrome.runtime.sendMessage(req)) as Res<T> | undefined;
  if (!res) throw new Error(chrome.runtime.lastError?.message ?? "The wallet isn't responding. Try again.");
  if (!res.ok) throw new Error(res.error);
  return res.data;
}
