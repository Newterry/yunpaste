import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./lib/i18n";
import "./styles.css";

const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches
  || navigatorWithStandalone.standalone === true;
document.documentElement.dataset.ios = String(isIos);
document.documentElement.dataset.standalone = String(isStandalone);

function updateResponsiveFontScale() {
  const width = window.visualViewport?.width || window.innerWidth;
  const height = window.visualViewport?.height || window.innerHeight;
  const reference = Math.min(Math.sqrt(width / 1366), Math.sqrt(height / 768));
  const mobileBoost = width <= 760 ? 1.04 : 1;
  const scale = Math.max(0.94, Math.min(1.18, reference * mobileBoost));
  document.documentElement.style.setProperty("--font-scale", scale.toFixed(3));
}

updateResponsiveFontScale();
window.addEventListener("resize", updateResponsiveFontScale, { passive: true });
window.visualViewport?.addEventListener("resize", updateResponsiveFontScale, { passive: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider><App /></I18nProvider>
  </StrictMode>
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {
        // The application remains fully usable when a browser blocks service workers.
      });
  }, { once: true });
}
