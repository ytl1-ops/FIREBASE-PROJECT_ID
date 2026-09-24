import { useEffect, useState } from "react";
import { fetchHealth, type Health } from "./lib/api.ts";
import { HomePage } from "./pages/HomePage.tsx";
import { MeetingPage } from "./pages/MeetingPage.tsx";
import { NewMeetingPage } from "./pages/NewMeetingPage.tsx";

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
  else page = <HomePage />;

  return (
    <>
      <header className="topbar">
        <a href="#/">
          <img src="/icon.svg" alt="" width={26} height={26} />
          MonMeeting
        </a>
        <span className="spacer" />
        <span className="status">
          {health === undefined
            ? ""
            : health === null
              ? "Serveur injoignable — enregistrement local uniquement"
              : `Rédaction : ${health.apiKeyConfigured ? "active" : "clé API manquante"} · Transcription HD : ${
                  health.transcriptionConfigured ? "active" : "non configurée"
                }`}
        </span>
      </header>
      <main>{page}</main>
    </>
  );
}
