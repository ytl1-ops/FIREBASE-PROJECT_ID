import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Chemins relatifs : la même version fonctionne à la racine d'un domaine (Netlify, serveur
  // Node, application téléphone) comme dans un sous-dossier (GitHub Pages).
  base: "./",
  plugins: [react()],
  server: {
    proxy: { "/api": "http://localhost:8787" },
  },
});
