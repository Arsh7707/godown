"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Shows a fixed-width page (the A4 bill) shrunk to fit the screen, like a PDF
 * preview, so a phone sees the whole bill exactly as it prints. Printing
 * ignores the shrink.
 */
export function FitWidth({ width, children }: { width: number; children: React.ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      if (!outer.current || !inner.current) return;
      const scale = Math.min(1, outer.current.clientWidth / width);
      setFit({ scale, height: inner.current.offsetHeight * scale });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (outer.current) ro.observe(outer.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={outer} className="w-full overflow-hidden print:!h-auto print:overflow-visible" style={{ height: fit?.height }}>
      <div
        ref={inner}
        className="origin-top-left print:!w-full print:!transform-none"
        style={{ width, transform: fit ? `scale(${fit.scale})` : undefined, visibility: fit ? undefined : "hidden" }}
      >
        {children}
      </div>
    </div>
  );
}
