import assert from "node:assert/strict";
import test from "node:test";
import { buildExtensionIconUrl, getDockIconPresentation, hasPointerMovedBeyondThreshold } from "./dock-interaction.ts";

test("浮动 Dock 图标使用扩展自己的插件图标", () => {
  const url = buildExtensionIconUrl((path) => `chrome-extension://think-anytime/${path}`);

  assert.equal(url, "chrome-extension://think-anytime/icons/icon-48.png");
});

test("指针移动超过阈值才视为拖动", () => {
  assert.equal(hasPointerMovedBeyondThreshold({ x: 10, y: 10 }, { x: 13, y: 13 }), false);
  assert.equal(hasPointerMovedBeyondThreshold({ x: 10, y: 10 }, { x: 18, y: 10 }), true);
});

test("收起态插件图标铺满圆角方形，不再嵌套圆形按钮", () => {
  const presentation = getDockIconPresentation();

  assert.equal(presentation.containerSize, 62);
  assert.equal(presentation.buttonSize, presentation.containerSize);
  assert.equal(presentation.imageSize, presentation.containerSize);
  assert.equal(presentation.borderRadius, 14);
});
