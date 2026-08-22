/**
 * Annotation model + rendering for the Draw modal.
 *
 * Kept out of the component because it is pure geometry: given a list of
 * shapes and a 2D context, draw them. That makes the on-screen preview
 * and the exported full-resolution PNG the same code path, which is the
 * only way they stay in sync.
 *
 * Coordinates are NORMALISED to 0…1 of the source image, never pixels.
 * The editor canvas is whatever size the viewport allows and the export
 * canvas is the image's own resolution, so pixel coordinates would mean
 * the exported arrow lands somewhere other than the one the user drew.
 * Stroke widths are normalised the same way, against the image's
 * shorter edge, so a line keeps its visual weight at any export size.
 */

export type Point = { x: number; y: number };

export type Tool = "pen" | "arrow" | "line" | "rect" | "ellipse" | "text";

export type Shape =
  | { id: string; kind: "pen"; points: Point[]; color: string; width: number }
  | { id: string; kind: "arrow" | "line"; from: Point; to: Point; color: string; width: number }
  | { id: string; kind: "rect" | "ellipse"; from: Point; to: Point; color: string; width: number }
  | { id: string; kind: "text"; at: Point; text: string; color: string; width: number };

/** Annotation colors — saturated enough to survive on any photograph. */
export const DRAW_COLORS = [
  "#ff3b30",
  "#ffcc00",
  "#34c759",
  "#0a84ff",
  "#af52de",
  "#ffffff",
  "#000000",
] as const;

/** Stroke weights as a fraction of the image's shorter edge. */
export const DRAW_WIDTHS = [0.004, 0.008, 0.016] as const;

/** Text cap height as a fraction of the shorter edge, per weight step. */
const TEXT_SCALE = 4.5;

const ARROW_HEAD = 3.2; // multiples of stroke width
const MIN_PX = 1.5;

/**
 * Convert a normalised stroke width to pixels for a given canvas.
 * Clamped so the thinnest stroke never disappears on a small preview.
 */
function strokePx(width: number, w: number, h: number): number {
  return Math.max(MIN_PX, width * Math.min(w, h));
}

function px(p: Point, w: number, h: number): [number, number] {
  return [p.x * w, p.y * h];
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  lw: number,
) {
  const angle = Math.atan2(ty - fy, tx - fx);
  const len = ARROW_HEAD * lw;
  const spread = Math.PI / 7;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - len * Math.cos(angle - spread), ty - len * Math.sin(angle - spread));
  ctx.lineTo(tx - len * Math.cos(angle + spread), ty - len * Math.sin(angle + spread));
  ctx.closePath();
  ctx.fill();
}

/** Draw one shape onto a context whose drawing area is `w` × `h` pixels. */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  w: number,
  h: number,
) {
  const lw = strokePx(shape.width, w, h);
  ctx.save();
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  switch (shape.kind) {
    case "pen": {
      if (shape.points.length === 0) break;
      ctx.beginPath();
      const [sx, sy] = px(shape.points[0]!, w, h);
      ctx.moveTo(sx, sy);
      // Quadratic smoothing through the midpoints: raw lineTo on
      // pointermove samples renders visibly faceted on a fast stroke.
      for (let i = 1; i < shape.points.length - 1; i += 1) {
        const [cx, cy] = px(shape.points[i]!, w, h);
        const [nx, ny] = px(shape.points[i + 1]!, w, h);
        ctx.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
      }
      const [ex, ey] = px(shape.points[shape.points.length - 1]!, w, h);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      break;
    }
    case "line":
    case "arrow": {
      const [fx, fy] = px(shape.from, w, h);
      const [tx, ty] = px(shape.to, w, h);
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      if (shape.kind === "arrow") drawArrowHead(ctx, fx, fy, tx, ty, lw);
      break;
    }
    case "rect": {
      const [fx, fy] = px(shape.from, w, h);
      const [tx, ty] = px(shape.to, w, h);
      ctx.strokeRect(fx, fy, tx - fx, ty - fy);
      break;
    }
    case "ellipse": {
      const [fx, fy] = px(shape.from, w, h);
      const [tx, ty] = px(shape.to, w, h);
      ctx.beginPath();
      ctx.ellipse(
        (fx + tx) / 2,
        (fy + ty) / 2,
        Math.abs(tx - fx) / 2,
        Math.abs(ty - fy) / 2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      break;
    }
    case "text": {
      const size = lw * TEXT_SCALE;
      const [tx, ty] = px(shape.at, w, h);
      ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textBaseline = "top";
      // A halo in the opposite tone: annotation text lands on unknown
      // imagery, and red-on-red is unreadable.
      ctx.lineWidth = Math.max(2, size / 8);
      ctx.strokeStyle = shape.color === "#000000" ? "#ffffff" : "#000000";
      ctx.lineJoin = "round";
      shape.text.split("\n").forEach((line, i) => {
        const y = ty + i * size * 1.25;
        ctx.strokeText(line, tx, y);
        ctx.fillText(line, tx, y);
      });
      break;
    }
  }
  ctx.restore();
}

export function drawAll(
  ctx: CanvasRenderingContext2D,
  shapes: Shape[],
  w: number,
  h: number,
) {
  for (const s of shapes) drawShape(ctx, s, w, h);
}

/** Text size in CSS pixels for the on-screen editing input. */
export function textSizePx(width: number, w: number, h: number): number {
  return strokePx(width, w, h) * TEXT_SCALE;
}
