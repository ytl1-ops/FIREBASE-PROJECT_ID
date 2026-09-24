/**
 * Transcription d'aperçu en direct via la reconnaissance vocale du navigateur
 * (Chrome, Edge, Safari). Elle permet de suivre la réunion en temps réel ; la
 * transcription de référence est produite ensuite à partir de l'audio complet.
 */

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): RecognitionCtor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function liveSpeechSupported(): boolean {
  return Boolean(getCtor());
}

export interface LiveSpeechCallbacks {
  onFinal: (text: string) => void;
  onInterim: (text: string) => void;
  onError?: (message: string) => void;
}

export class LiveSpeech {
  private recognition: SpeechRecognitionLike | null = null;
  private active = false;

  constructor(
    private lang: string,
    private callbacks: LiveSpeechCallbacks,
  ) {}

  start() {
    const Ctor = getCtor();
    if (!Ctor) return;
    this.active = true;
    const rec = new Ctor();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript.trim();
        if (!text) continue;
        if (r.isFinal) this.callbacks.onFinal(text);
        else interim += `${text} `;
      }
      this.callbacks.onInterim(interim.trim());
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.active = false;
        this.callbacks.onError?.("Reconnaissance vocale refusée par le navigateur.");
      }
    };
    // Le navigateur coupe la reconnaissance après un silence : on la relance.
    rec.onend = () => {
      if (this.active) {
        try {
          rec.start();
        } catch {
          // déjà démarrée
        }
      }
    };
    this.recognition = rec;
    rec.start();
  }

  stop() {
    this.active = false;
    this.recognition?.stop();
    this.recognition = null;
    this.callbacks.onInterim("");
  }
}
