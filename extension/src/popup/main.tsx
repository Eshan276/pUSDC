import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { ToastProvider } from "@ui/toast";

if (new URLSearchParams(location.search).has("tab") || location.hash.includes("approve=")) document.documentElement.classList.add("tab");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
