import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { ToastProvider } from "@ui/toast";
import { cfgReady } from "../shared/chain";

if (new URLSearchParams(location.search).has("tab") || location.hash.includes("approve=")) document.documentElement.classList.add("tab");

void cfgReady.then(() => createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
));
