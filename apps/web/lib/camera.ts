export interface Box { x: number; y: number; width: number; height: number }
export interface CameraPlan { x: number; y: number; zoom: number; partial: boolean }

/**
 * Where to place the camera so `content` fits the canvas, keeping `reserveRight`
 * pixels clear for an overlay such as the outline rail.
 *
 * If fitting everything would make text smaller than `minReadable`, the camera
 * stays at that zoom and shows the start of the content instead: its left edge
 * when it is too wide, its top when it is too tall, otherwise centred.
 * `partial` reports that only part of the content is visible. Pass
 * `minReadable: 0` to always fit everything.
 *
 * Returns null while the canvas or content has no measurable size.
 */
export function planCamera(
  content: Box,
  canvas: { width: number; height: number },
  { padding, reserveRight, minReadable, maxZoom }: { padding: number; reserveRight: number; minReadable: number; maxZoom: number },
): CameraPlan | null {
  const width = canvas.width - reserveRight - 2 * padding;
  const height = canvas.height - 2 * padding;
  if (width <= 0 || height <= 0 || content.width <= 0 || content.height <= 0) return null;
  const fit = Math.min(width / content.width, height / content.height, maxZoom);
  const partial = fit < minReadable && fit < maxZoom;
  const zoom = partial ? Math.min(minReadable, maxZoom) : fit;
  const place = (start: number, available: number, size: number) => {
    const scaled = size * zoom;
    return scaled <= available ? padding + (available - scaled) / 2 - start * zoom : padding - start * zoom;
  };
  return { x: place(content.x, width, content.width), y: place(content.y, height, content.height), zoom, partial };
}
