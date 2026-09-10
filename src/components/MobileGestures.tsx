import { ChevronLeft, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";

type GestureMode = "idle" | "pull" | "back" | "refreshing";

interface MobileGesturesProps {
  canGoBack: boolean;
  onBack: () => void;
  onRefresh?: () => Promise<void> | void;
}

const MOBILE_QUERY = "(max-width: 760px) and (pointer: coarse)";
const EDGE_START = 30;
const BACK_THRESHOLD = 76;
const REFRESH_THRESHOLD = 88;

function activeScroller(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  return element?.closest<HTMLElement>(
    ".overview-panel, .file-browser, .webdav-workspace, .settings-page, .ticket-page, .admin-panel, .preview-panel__body"
  ) || null;
}

function isFormControl(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(
    "input, textarea, select, [contenteditable='true'], [role='slider']"
  ));
}

export function MobileGestures({ canGoBack, onBack, onRefresh }: MobileGesturesProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<GestureMode>("idle");
  const [armed, setArmed] = useState(false);
  const pullIndicator = useRef<HTMLDivElement>(null);
  const backIndicator = useRef<HTMLDivElement>(null);
  const latest = useRef({ canGoBack, onBack, onRefresh });
  const gesture = useRef({
    startX: 0,
    startY: 0,
    rawX: 0,
    rawY: 0,
    edge: false,
    pull: false,
    tracking: false
  });
  latest.current = { canGoBack, onBack, onRefresh };

  useEffect(() => {
    const surface = document.querySelector<HTMLElement>(".workspace-main");
    if (!surface) return;

    const reset = () => {
      gesture.current.tracking = false;
      gesture.current.edge = false;
      gesture.current.pull = false;
      gesture.current.rawX = 0;
      gesture.current.rawY = 0;
      pullIndicator.current?.style.removeProperty("--gesture-distance");
      backIndicator.current?.style.removeProperty("--gesture-distance");
      setArmed(false);
      setMode("idle");
    };

    const touchStart = (event: TouchEvent) => {
      if (!window.matchMedia(MOBILE_QUERY).matches || event.touches.length !== 1) return;
      if (document.querySelector(".modal-layer, .modal-backdrop, .destination-backdrop")) return;
      const touch = event.touches[0];
      const scroller = activeScroller(event.target);
      const edge = touch.clientX <= EDGE_START && latest.current.canGoBack;
      const pull = Boolean(latest.current.onRefresh)
        && !edge
        && !isFormControl(event.target)
        && (!scroller || scroller.scrollTop <= 0);
      gesture.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        rawX: 0,
        rawY: 0,
        edge,
        pull,
        tracking: edge || pull
      };
    };

    const touchMove = (event: TouchEvent) => {
      const current = gesture.current;
      if (!current.tracking || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - current.startX;
      const dy = touch.clientY - current.startY;
      current.rawX = dx;
      current.rawY = dy;

      if (current.edge) {
        if (dx < 0 || Math.abs(dy) > Math.abs(dx) * 1.1) {
          reset();
          return;
        }
        if (dx < 7) return;
        event.preventDefault();
        setMode("back");
        const distance = Math.min(98, dx * .72);
        backIndicator.current?.style.setProperty("--gesture-distance", `${distance}px`);
        setArmed(dx >= BACK_THRESHOLD);
        return;
      }

      if (!current.pull || dy <= 0 || Math.abs(dx) > Math.abs(dy) * .72) {
        reset();
        return;
      }
      const scroller = activeScroller(event.target);
      if (scroller && scroller.scrollTop > 0) {
        reset();
        return;
      }
      if (dy < 7) return;
      event.preventDefault();
      setMode("pull");
      const distance = Math.min(92, Math.pow(dy, .82) * 1.9);
      pullIndicator.current?.style.setProperty("--gesture-distance", `${distance}px`);
      setArmed(dy >= REFRESH_THRESHOLD);
    };

    const touchEnd = () => {
      const current = gesture.current;
      if (!current.tracking) return;
      if (current.edge && current.rawX >= BACK_THRESHOLD) {
        reset();
        latest.current.onBack();
        return;
      }
      if (current.pull && current.rawY >= REFRESH_THRESHOLD && latest.current.onRefresh) {
        gesture.current.tracking = false;
        setArmed(false);
        setMode("refreshing");
        pullIndicator.current?.style.setProperty("--gesture-distance", "54px");
        Promise.resolve(latest.current.onRefresh()).finally(() => {
          window.setTimeout(reset, 260);
        });
        return;
      }
      reset();
    };

    surface.addEventListener("touchstart", touchStart, { passive: true });
    surface.addEventListener("touchmove", touchMove, { passive: false });
    surface.addEventListener("touchend", touchEnd, { passive: true });
    surface.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      surface.removeEventListener("touchstart", touchStart);
      surface.removeEventListener("touchmove", touchMove);
      surface.removeEventListener("touchend", touchEnd);
      surface.removeEventListener("touchcancel", reset);
    };
  }, []);

  return (
    <>
      <div ref={pullIndicator} className={`mobile-pull-indicator is-${mode} ${armed ? "is-armed" : ""}`} role="status" aria-live="polite" aria-hidden={mode === "idle" ? true : undefined}>
        <RefreshCw />
        <span>{mode === "refreshing" ? t("mobile.refreshing") : armed ? t("mobile.release") : t("mobile.pull")}</span>
      </div>
      <div ref={backIndicator} className={`mobile-edge-back is-${mode} ${armed ? "is-armed" : ""}`} aria-hidden="true">
        <ChevronLeft />
      </div>
    </>
  );
}
