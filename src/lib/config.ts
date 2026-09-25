/**
 * Mode entreprise (build avec VITE_MODE_ENTREPRISE=1) : aucune fonction n'envoie de données de
 * réunion hors de l'infrastructure de l'organisation. Le mode « Claude.ai » est masqué ; seule
 * « Mon API » (serveur interne) rédige et transcrit, en plus de la transcription sur l'appareil.
 */
export const ENTERPRISE_MODE = import.meta.env.VITE_MODE_ENTREPRISE === "1";
