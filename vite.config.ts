import { defineConfig, type Plugin } from "vite";

/**
 * Politique de sécurité du contenu, injectée dans la version publiée (GitHub Pages,
 * application téléphone) où l'hébergeur ne permet pas d'envoyer d'en-têtes HTTP.
 * connect-src autorise https: pour joindre « Mon API » (adresse choisie par l'utilisateur)
 * et le téléchargement des modèles Whisper.
 */
function contentSecurityPolicy(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
  return {
    name: "monmeeting-csp",
    apply: "build",
    transformIndexHtml: (html) =>
      html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Chemins relatifs : la même version fonctionne à la racine d'un domaine (Netlify, serveur
  // Node, application téléphone) comme dans un sous-dossier (GitHub Pages).
  base: "./",
  plugins: [react(), contentSecurityPolicy()],
  server: {
    proxy: { "/api": "http://localhost:8787" },
  },
});
