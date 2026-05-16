import assert from "node:assert/strict";
import test from "node:test";
import { buildExtensionIconUrl, hasPointerMovedBeyondThreshold } from "./dock-interaction.ts";

test("浮动 Dock 图标使用扩展自己的插件图标", () => {
  const url = buildExtensionIconUrl((path) => `chrome-extension://think-anytime/${path}`);

  assert.equal(url, "chrome-extension://think-anytime/icons/icon-48.png");
});

test("指针移动超过阈值才视为拖动", () => {
  assert.equal(hasPointerMovedBeyondThreshold({ x: 10, y: 10 }, { x: 13, y: 13 }), false);
  assert.equal(hasPointerMovedBeyondThreshold({ x: 10, y: 10 }, { x: 18, y: 10 }), true);
});
