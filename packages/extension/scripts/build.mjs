import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const shared = {
  bundle: true,
  sourcemap: true,
  logLevel: "info",
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
  },
};

await build({
  ...shared,
  entryPoints: [join(root, "src/background.ts")],
  outfile: join(dist, "background.js"),
  format: "esm",
  platform: "browser",
  target: "chrome120",
});

await build({
  ...shared,
  entryPoints: [join(root, "src/content.ts")],
  outfile: join(dist, "content.js"),
  format: "iife",
  platform: "browser",
  target: "chrome120",
});

await build({
  ...shared,
  entryPoints: [join(root, "src/side-panel.tsx")],
  outfile: join(dist, "side-panel.js"),
  format: "iife",
  platform: "browser",
  target: "chrome120",
});

cpSync(join(root, "public/manifest.json"), join(dist, "manifest.json"));
cpSync(join(root, "side-panel.html"), join(dist, "side-panel.html"));
cpSync(join(root, "src/styles.css"), join(dist, "styles.css"));
