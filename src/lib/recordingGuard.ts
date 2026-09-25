/**
 * Empêche de quitter une réunion en cours d'enregistrement par un lien interne (logo, retour) :
 * la page de réunion serait démontée et l'enregistrement interrompu.
 */
let active = false;
let lastHash = window.location.hash;

export function setRecordingActive(value: boolean) {
  active = value;
  lastHash = window.location.hash;
}

window.addEventListener("hashchange", () => {
  if (!active) {
    lastHash = window.location.hash;
    return;
  }
  if (window.confirm("Un enregistrement est en cours. Quitter cette réunion l'arrêtera. Continuer ?")) {
    active = false;
    lastHash = window.location.hash;
  } else {
    // Retour à la réunion sans recharger la page. Ce gestionnaire est enregistré avant celui du
    // routeur (import du module) : le routeur lit ensuite l'adresse déjà rétablie.
    history.replaceState(null, "", lastHash);
  }
});
