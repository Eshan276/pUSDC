// Isolated-world relay between the page's provider (inpage.ts) and the service worker.
window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.target !== "pw-content") return;
  const { id, method, params } = e.data;
  chrome.runtime.sendMessage({ dapp: true, method, params, origin: location.origin }, (res) => {
    window.postMessage({ target: "pw-inpage", id, res: res ?? { ok: false, error: chrome.runtime.lastError?.message ?? "No response", code: -32603 } }, location.origin);
  });
});
