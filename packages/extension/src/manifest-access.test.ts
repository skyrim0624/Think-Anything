import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

interface WebAccessibleResource {
  resources?: string[];
  matches?: string[];
}

interface ExtensionManifest {
  web_accessible_resources?: WebAccessibleResource[];
}

const manifestPath = join(dirname(fileURLToPath(import.meta.url)), "../public/manifest.json");

test("Dock 浮动图标资源必须允许 content script 在网页内加载", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ExtensionManifest;
  const webResources = manifest.web_accessible_resources ?? [];

  assert.equal(
    webResources.some(
      (entry) =>
        entry.resources?.includes("icons/icon-48.png") &&
        entry.matches?.includes("http://*/*") &&
        entry.matches?.includes("https://*/*"),
    ),
    true,
  );
});
