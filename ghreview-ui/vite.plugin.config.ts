import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// Mirrors the host's own plugin-sdk vite config: until @dorsk/cctui-plugin-sdk is
// published, these externals are declared here rather than imported.
const RUNTIME_PATHS: Record<string, string> = {
  svelte: "/plugin-runtime/svelte.js",
  "svelte/internal/client": "/plugin-runtime/svelte-internal-client.js",
  "svelte/internal/disclose-version": "/plugin-runtime/svelte-internal-disclose-version.js",
  "svelte/store": "/plugin-runtime/svelte-store.js",
  "@dorsk/tsumikit": "/plugin-runtime/tsumikit.js",
};

export default defineConfig({
  plugins: [svelte({ compilerOptions: { css: "injected" }, emitCss: false })],
  // Library mode leaves `process.env.NODE_ENV` for a bundler that never runs:
  // the host loads this file straight into the browser.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: {
    alias: {
      $lib: new URL("./src/lib", import.meta.url).pathname,
    },
  },
  build: {
    outDir: "dist/ghreview/web",
    emptyOutDir: true,
    minify: true,
    // Component styles are injected at mount, but the plain `import "*.css"`
    // sheets (tokens, embed, markdown, syntax) cannot be — they leave as one
    // asset the manifest's `styles[]` points the host at.
    cssCodeSplit: false,
    lib: { entry: "src/plugin.ts", formats: ["es"], fileName: () => "index.js" },
    rollupOptions: {
      external: (id: string) => id in RUNTIME_PATHS,
      output: { paths: RUNTIME_PATHS, assetFileNames: "index.css" },
    },
  },
});
