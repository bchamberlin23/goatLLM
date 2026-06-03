import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("scheduler")) {
            return "vendor-react";
          }
          if (id.includes("/@ai-sdk/") || id.includes("/ai@")) {
            return "vendor-ai";
          }
          if (id.includes("/@modelcontextprotocol/")) {
            return "vendor-mcp";
          }
          if (id.includes("/@monaco-editor/") || id.includes("/monaco-editor/")) {
            return "vendor-monaco";
          }
          if (id.includes("/docx/") || id.includes("/pptxgenjs/") || id.includes("/xlsx/")) {
            return "vendor-office";
          }
          if (id.includes("/lucide-react/")) {
            return "vendor-icons";
          }
          if (
            id.includes("/react-markdown/") ||
            id.includes("/remark-") ||
            id.includes("/rehype-") ||
            id.includes("/katex/") ||
            id.includes("/marked/")
          ) {
            return "vendor-markdown";
          }
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  optimizeDeps: {
    include: ["@tauri-apps/plugin-http"],
  },
});
