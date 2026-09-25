import { useEffect, useState } from "react";
import { fetchHealth, type Health } from "./lib/api.ts";
import { GuidePage } from "./pages/GuidePage.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { MeetingPage } from "./pages/MeetingPage.tsx";
import { NewMeetingPage } from "./pages/NewMeetingPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || "/");
  useEffect(() => {
    const onChange = () => setHash(window.location.hash.slice(1) || "/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export function navigate(path: string) {
  window.location.hash = path;
}

export function App() {
  const route = useHashRoute();
  const [health, setHealth] = useState<Health | null | undefined>(undefined);

  useEffect(() => {
    void fetchHealth().then(setHealth);
  }, []);

  let page;
  const [path, search = ""] = route.split("?");
  const meetingMatch = path.match(/^\/reunion\/([\w-]+)$/);
  if (meetingMatch) {
    const tab = new URLSearchParams(search).get("onglet") ?? undefined;
    page = <MeetingPage key={meetingMatch[1]} id={meetingMatch[1]} initialTab={tab} health={health ?? null} />;
  } else if (path === "/nouvelle") page = <NewMeetingPage />;
  else if (path === "/aide") page = <GuidePage />;
  else if (path === "/reglages") page = <SettingsPage onSaved={setHealth} />;
  else page = <HomePage />;

  return (
    <>
      <header className="topbar">
        <a href="#/">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={26} height={26} />
          MonMeeting
        </a>
        <span className="spacer" />
        <span className="status">
          {health === undefined
            ? ""
            : health === null
              ? "Mode autonome — transcription sur l'appareil, rédaction via Claude.ai"
              : `Mon API : rédaction ${health.generation.available ? `✓ (${health.generation.model})` : "✗"} · transcription ${
                  health.transcription.available ? "✓" : "✗"
                }`}
        </span>
        <a href="#/aide" className="topbar-icon" title="Prise en main" aria-label="Prise en main">
          ?
        </a>
        <a href="#/reglages" className="topbar-icon" title="Réglages" aria-label="Réglages">
          ⚙
        </a>
      </header>
      <main>{page}</main>
    </>
  );
}
