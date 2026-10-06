import { useEffect, useRef } from "react";

import type { Camera } from "../board/camera";
import {
  candleFlicker,
  createMotes,
  moteOpacity,
  moteScreenPosition,
  stepMotes,
  type Bounds,
  type Mote,
} from "./motes";

export interface AmbientProps {
  camera: Camera;
  count?: number;
  className?: string;
}

/** Dust drifts slowly enough that 30fps is indistinguishable from 60. */
const FRAME_INTERVAL = 1 / 30;

export function Ambient({ camera, count = 26, className }: AmbientProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);

  const motesRef = useRef<Mote[]>([]);
  const boundsRef = useRef<Bounds>({ width: 0, height: 0 });
  const cameraRef = useRef(camera);
  const frameRef = useRef(0);

  // Through a ref: a dependency would restart the dust field on every pan.
  cameraRef.current = camera;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // jsdom and some webviews throw or return null; the board is usable without dust.
    let context: CanvasRenderingContext2D | null = null;
    try {
      context = canvas.getContext("2d");
    } catch {
      context = null;
    }
    if (!context) return;

    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = (): void => {
      const parent = canvas.parentElement;
      if (!parent) return;

      const width = parent.clientWidth;
      const height = parent.clientHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.max(1, Math.floor(width * ratio));
      canvas.height = Math.max(1, Math.floor(height * ratio));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const bounds = { width, height };
      boundsRef.current = bounds;
      // Re-seeded on resize; the fixed seed keeps the field stable across renders.
      motesRef.current = createMotes(count, bounds, 20261004);
    };

    const draw = (time: number): void => {
      const bounds = boundsRef.current;
      const motes = motesRef.current;
      if (bounds.width <= 0 || bounds.height <= 0) return;

      context.clearRect(0, 0, bounds.width, bounds.height);
      context.globalCompositeOperation = "lighter";

      for (const mote of motes) {
        const position = moteScreenPosition(
          mote,
          cameraRef.current,
          bounds,
          0.3,
        );
        context.globalAlpha = moteOpacity(mote, time);
        context.beginPath();
        context.arc(position.x, position.y, mote.radius, 0, Math.PI * 2);
        context.fillStyle = "#ffd9a0";
        context.fill();
      }

      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";
    };

    resize();

    if (reduced) {
      draw(0);
      if (vignetteRef.current) vignetteRef.current.style.opacity = "1";
      const observer = new ResizeObserver(resize);
      observer.observe(canvas.parentElement ?? canvas);
      return () => observer.disconnect();
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas.parentElement ?? canvas);

    let last = 0;
    let clock = 0;
    let accumulated = 0;

    const loop = (now: number): void => {
      const delta = last === 0 ? FRAME_INTERVAL : (now - last) / 1000;
      last = now;
      clock += delta;

      // Throttled to ~30fps but integrating real time, so motion is not at half speed.
      accumulated += delta;
      if (accumulated >= FRAME_INTERVAL) {
        stepMotes(motesRef.current, accumulated, boundsRef.current);
        draw(clock);
        if (vignetteRef.current) {
          vignetteRef.current.style.opacity = String(candleFlicker(clock));
        }
        accumulated = 0;
      }

      frameRef.current = requestAnimationFrame(loop);
    };

    frameRef.current = requestAnimationFrame(loop);

    const onVisibility = (): void => {
      if (document.hidden) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      } else if (frameRef.current === 0) {
        last = 0;
        frameRef.current = requestAnimationFrame(loop);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      document.removeEventListener("visibilitychange", onVisibility);
      observer.disconnect();
    };
  }, [count]);

  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className ?? ""}`}
    >
      <div
        ref={vignetteRef}
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 18% 8%, rgb(255 196 110 / 0.16), transparent 70%)",
          mixBlendMode: "soft-light",
        }}
      />
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}
