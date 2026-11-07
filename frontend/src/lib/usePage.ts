import { useEffect, useState } from "react";

export const PAGES = ["swap", "send", "wallet", "protect", "backup"] as const;
export type Page = (typeof PAGES)[number];
export const PAGE_LABELS: Record<Page, string> = { swap: "Swap", send: "Send", wallet: "Wallet", protect: "Protect", backup: "Backup" };

const read = (): Page => {
  const id = window.location.hash.replace("#", "") as Page;
  return PAGES.includes(id) ? id : "swap";
};

/** Which page is open, kept in the URL hash so links and the browser's back button work. */
export function usePage(): [Page, (p: Page) => void] {
  const [page, setPage] = useState<Page>(read);
  useEffect(() => {
    const on = () => setPage(read());
    window.addEventListener("hashchange", on);
    window.addEventListener("popstate", on);
    return () => {
      window.removeEventListener("hashchange", on);
      window.removeEventListener("popstate", on);
    };
  }, []);
  const go = (p: Page) => {
    history.pushState(null, "", `${window.location.pathname}${window.location.search}#${p}`);
    setPage(p);
    window.scrollTo({ top: 0 });
  };
  return [page, go];
}
