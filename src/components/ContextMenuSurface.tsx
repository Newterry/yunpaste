import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuPoint {
  x: number;
  y: number;
}

export function useDismissibleMenu(open: boolean, close: () => void) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", pointer);
    window.addEventListener("keydown", keydown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", pointer);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [close, open]);
  return root;
}

export function ContextMenuSurface({ children, point }: {
  children: ReactNode;
  point?: ContextMenuPoint;
}) {
  const surface = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!point || !surface.current) return;
    const element = surface.current;
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportRight = viewportLeft + (viewport?.width || window.innerWidth);
    const viewportBottom = viewportTop + (viewport?.height || window.innerHeight);
    const edge = 8;
    const gap = 6;
    const rect = element.getBoundingClientRect();
    const left = Math.max(viewportLeft + edge, Math.min(point.x + gap, viewportRight - rect.width - edge));
    const below = point.y + gap;
    const above = point.y - rect.height - gap;
    const top = below + rect.height <= viewportBottom - edge ? below : Math.max(viewportTop + edge, above);

    element.style.left = `${Math.round(left)}px`;
    element.style.top = `${Math.round(top)}px`;
    element.style.visibility = "visible";
  }, [point]);

  const menu = <div
    ref={surface}
    className={`context-menu manager-context ${point ? "context-menu--pointer" : ""}`}
    style={point ? { left: point.x, top: point.y, visibility: "hidden" } : undefined}
    onPointerDown={(event) => event.stopPropagation()}
  >{children}</div>;

  return point ? createPortal(menu, document.body) : menu;
}
