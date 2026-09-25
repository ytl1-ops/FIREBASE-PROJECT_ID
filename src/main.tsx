import { Capacitor } from "@capacitor/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Version web installée (PWA) : fonctionnement hors ligne. Inutile dans l'application native.
// Enregistré tardivement et hors du chemin critique ; « ?sans-cache » dans l'adresse le désactive
// (et supprime un service worker déjà installé) pour diagnostiquer un navigateur récalcitrant.
if (import.meta.env.PROD && "serviceWorker" in navigator && !Capacitor.isNativePlatform()) {
  const disabled = new URLSearchParams(window.location.search).has("sans-cache");
  window.setTimeout(() => {
    try {
      if (disabled) {
        void navigator.serviceWorker
          .getRegistrations()
          .then((regs) => regs.forEach((r) => void r.unregister()))
          .catch(() => {});
      } else {
        navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
      }
    } catch {
      // Service worker indisponible : l'application fonctionne sans mode hors ligne.
    }
  }, 5000);
}
