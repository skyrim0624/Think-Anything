export interface PointerPoint {
  x: number;
  y: number;
}

export interface DockIconPresentation {
  containerSize: number;
  buttonSize: number;
  imageSize: number;
  borderRadius: number;
}

export function buildExtensionIconUrl(resolveUrl: (path: string) => string, size = 48): string {
  return resolveUrl(`icons/icon-${size}.png`);
}

export function getDockIconPresentation(): DockIconPresentation {
  return {
    containerSize: 62,
    buttonSize: 62,
    imageSize: 62,
    borderRadius: 14,
  };
}

export function hasPointerMovedBeyondThreshold(
  start: PointerPoint,
  current: PointerPoint,
  threshold = 6,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}
