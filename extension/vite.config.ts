import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
// The shared UI lives in ../frontend, which has its own node_modules: force a single copy of React and friends.
const dedupe = ["react", "react-dom", "lucide-react", "viem"];
const alias = { "@abi": r("../frontend/src/abi.ts"), "@ui": r("../frontend/src/components") };
const entry = process.env.ENTRY as "inpage" | "content" | undefined;

// Three builds: the popup + service worker (ES modules), then the two tiny page scripts as standalone IIFEs
// (content scripts cannot import shared chunks).
export default defineConfig(
  entry
    ? {
        resolve: { alias },
        build: {
          emptyOutDir: false,
          lib: { entry: r(`./src/${entry}.ts`), formats: ["iife"], name: entry, fileName: () => `${entry}.js` },
        },
      }
    : {
        base: "./",
        resolve: { alias, dedupe },
        plugins: [react(), tailwindcss()],
        build: {
          rollupOptions: {
            input: { popup: r("./popup.html"), background: r("./src/background/index.ts") },
            output: { entryFileNames: "[name].js", chunkFileNames: "assets/[name]-[hash].js" },
          },
        },
      },
);
