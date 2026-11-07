import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config, RPC_URL } from "./config";
import { warmUp } from "./lib/anonRpc";
import { ToastProvider } from "./components/toast";
import App from "./App";
import "./index.css";

// Start the private (mixnet) connection right away so its bootstrap overlaps with the welcome screen.
warmUp(RPC_URL);

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
