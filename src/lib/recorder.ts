/**
 * Enregistreur audio/vidéo longue durée.
 * - Audio : micro seul, ou micro + audio système (onglet de visioconférence) mixés.
 * - Vidéo : caméra + micro, ou écran partagé + micro + audio système.
 * - Fragments émis toutes les `timeslice` ms pour être persistés immédiatement.
 * - Verrou d'écran (Wake Lock) pour éviter la mise en veille pendant la réunion.
 */
export type CaptureMode = "micro" | "visio" | "onglet" | "camera" | "ecran";

/** Modes qui captent le son de l'ordinateur : le micro y est facultatif. */
export const usesDisplay = (mode: CaptureMode) => mode === "visio" || mode === "onglet" || mode === "ecran";

/** Message clair pour les erreurs d'accès aux périphériques. */
export function deviceErrorMessage(err: unknown, mode?: CaptureMode): string {
  const name = err instanceof DOMException ? err.name : "";
  switch (name) {
    case "NotAllowedError":
      return "Accès refusé. Autorisez le microphone (et le partage d'écran le cas échéant) pour ce site dans le navigateur, puis réessayez.";
    case "NotFoundError":
      return "Aucun microphone détecté sur cet appareil. Branchez un micro ou un casque, ou vérifiez Windows : Paramètres → Confidentialité → Microphone. Pour enregistrer une émission ou une vidéo qui passe sur l'ordinateur (France 24, YouTube…), choisissez la source « Son de l'ordinateur ou d'un onglet », qui fonctionne sans micro.";
    case "NotReadableError":
      if (mode && usesDisplay(mode)) {
        return "Capture de l'écran ou de l'onglet impossible sur cet appareil. Sur ordinateur, utilisez Chrome ou Edge ; sur téléphone, le partage du son d'un onglet n'est pas disponible.";
      }
      return "Le microphone est déjà utilisé par une autre application (Teams, Zoom…) ou bloqué par le système. Fermez-la puis réessayez.";
    case "AbortError":
      return "Partage annulé : sélectionnez l'onglet ou l'écran à enregistrer et cochez « Partager l'audio ».";
    default:
      return `Impossible de démarrer l'enregistrement : ${err instanceof Error ? err.message : String(err)}`;
  }
}

export const isVideoMode = (mode: CaptureMode) => mode === "camera" || mode === "ecran";

export interface RecorderCallbacks {
  onChunk: (chunk: Blob, index: number) => void;
  onLevel?: (level: number) => void;
  onError?: (message: string) => void;
}

const PREFERRED_MIME = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/webm",
];

const PREFERRED_VIDEO_MIME = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
  "video/webm",
];

export function pickMimeType(video = false): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return (video ? PREFERRED_VIDEO_MIME : PREFERRED_MIME).find((m) => MediaRecorder.isTypeSupported(m));
}

export function recordingSupported(): boolean {
  return Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";
}

export class MeetingRecorder {
  private recorder: MediaRecorder | null = null;
  private streams: MediaStream[] = [];
  private audioContext: AudioContext | null = null;
  private levelTimer: number | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private chunkIndex: number;
  /** Flux micro seul, utilisé par la reconnaissance vocale d'aperçu. */
  micStream: MediaStream | null = null;
  /** Flux vidéo en cours (aperçu à l'écran). */
  videoStream: MediaStream | null = null;
  mimeType = "audio/webm";

  constructor(
    private callbacks: RecorderCallbacks,
    startIndex = 0,
  ) {
    this.chunkIndex = startIndex;
  }

  private async openMic(mode: CaptureMode, deviceId?: string): Promise<MediaStream> {
    const constraints = (id?: string): MediaStreamConstraints => ({
      audio: {
        deviceId: id ? { exact: id } : undefined,
        channelCount: 1,
        echoCancellation: mode !== "micro",
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    try {
      return await navigator.mediaDevices.getUserMedia(constraints(deviceId));
    } catch (err) {
      // Micro choisi débranché entre-temps : on retente avec le micro par défaut.
      if (deviceId && err instanceof DOMException && (err.name === "OverconstrainedError" || err.name === "NotFoundError")) {
        return navigator.mediaDevices.getUserMedia(constraints());
      }
      throw err;
    }
  }

  async start(mode: CaptureMode, deviceId?: string) {
    let mic: MediaStream | null = null;
    if (mode !== "onglet") {
      try {
        mic = await this.openMic(mode, deviceId);
      } catch (err) {
        // Sans micro, les modes « son de l'ordinateur » restent possibles.
        if (!(usesDisplay(mode) && err instanceof DOMException && err.name === "NotFoundError")) throw err;
        this.callbacks.onError?.(
          "Aucun microphone détecté : seul le son de l'ordinateur sera enregistré.",
        );
      }
    }
    if (mic) {
      this.micStream = mic;
      this.streams.push(mic);
    }

    this.audioContext = new AudioContext();
    const destination = this.audioContext.createMediaStreamDestination();
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 1024;

    if (mic) {
      const micSource = this.audioContext.createMediaStreamSource(mic);
      micSource.connect(destination);
      micSource.connect(analyser);
    }

    let videoTrack: MediaStreamTrack | undefined;
    if (mode === "camera") {
      const cam = await navigator.mediaDevices.getUserMedia({
        // 480p suffit pour une réunion filmée et divise le poids par ~2 par rapport au 720p.
        video: { width: { ideal: 854 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 }, facingMode: "user" },
      });
      this.streams.push(cam);
      videoTrack = cam.getVideoTracks()[0];
    }

    if (usesDisplay(mode)) {
      // Capture de l'onglet/écran partagé (Teams, Zoom, Meet dans le navigateur).
      // Écran : 10 images/s suffisent (contenu majoritairement fixe) et gardent le texte net.
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 10, max: 15 }, width: { max: 1920 }, height: { max: 1080 } },
        audio: true,
      });
      this.streams.push(display);
      if (mode === "ecran") videoTrack = display.getVideoTracks()[0];
      else display.getVideoTracks().forEach((t) => t.stop());
      if (display.getAudioTracks().length === 0 && !mic) {
        throw new Error(
          "Aucun son partagé. Relancez et, dans la fenêtre de partage, choisissez l'onglet (ou l'écran entier) puis cochez « Partager l'audio ».",
        );
      }
      if (display.getAudioTracks().length === 0) {
        this.callbacks.onError?.(
          "Aucun audio partagé : cochez « Partager l'audio de l'onglet » pour enregistrer les participants distants.",
        );
      } else {
        const sys = this.audioContext.createMediaStreamSource(
          new MediaStream(display.getAudioTracks()),
        );
        sys.connect(destination);
        sys.connect(analyser);
      }
    }

    const tracks = [...destination.stream.getAudioTracks()];
    if (videoTrack) {
      tracks.push(videoTrack);
      this.videoStream = new MediaStream([videoTrack]);
      // Si l'utilisateur arrête le partage d'écran depuis le navigateur, on le signale.
      videoTrack.addEventListener("ended", () =>
        this.callbacks.onError?.("La source vidéo a été interrompue ; l'audio continue d'être enregistré."),
      );
    }
    this.mimeType = pickMimeType(Boolean(videoTrack)) ?? (videoTrack ? "video/webm" : "audio/webm");
    this.recorder = new MediaRecorder(new MediaStream(tracks), {
      mimeType: this.mimeType,
      // Opus mono à 32 kbit/s : qualité « voix » transparente, ≈ 14 Mo par heure.
      audioBitsPerSecond: 32_000,
      // Vidéo : ≈ 270 Mo/h (caméra 480p) ou ≈ 360 Mo/h (écran), texte et visages lisibles.
      ...(videoTrack ? { videoBitsPerSecond: mode === "ecran" ? 800_000 : 600_000 } : {}),
    });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.callbacks.onChunk(e.data, this.chunkIndex++);
    };
    this.recorder.onerror = () => this.callbacks.onError?.("Erreur de l'enregistreur.");
    this.recorder.start(5000);

    const buffer = new Uint8Array(analyser.fftSize);
    this.levelTimer = window.setInterval(() => {
      analyser.getByteTimeDomainData(buffer);
      let peak = 0;
      for (const v of buffer) peak = Math.max(peak, Math.abs(v - 128));
      this.callbacks.onLevel?.(peak / 128);
    }, 100);

    await this.acquireWakeLock();
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private onVisibility = () => {
    if (document.visibilityState === "visible" && this.recorder) void this.acquireWakeLock();
  };

  private async acquireWakeLock() {
    try {
      this.wakeLock = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {
      // Non bloquant : certains navigateurs refusent le verrou d'écran.
    }
  }

  pause() {
    if (this.recorder?.state === "recording") this.recorder.pause();
  }

  resume() {
    if (this.recorder?.state === "paused") this.recorder.resume();
  }

  get state(): RecordingState | "inactive" {
    return this.recorder?.state ?? "inactive";
  }

  /** Arrête l'enregistrement ; résout une fois le dernier fragment émis. */
  async stop(): Promise<number> {
    const recorder = this.recorder;
    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        recorder.stop();
      });
    }
    this.cleanup();
    return this.chunkIndex;
  }

  private cleanup() {
    if (this.levelTimer) window.clearInterval(this.levelTimer);
    this.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    this.streams = [];
    this.micStream = null;
    this.videoStream = null;
    void this.audioContext?.close();
    this.audioContext = null;
    void this.wakeLock?.release();
    this.wakeLock = null;
    this.recorder = null;
    document.removeEventListener("visibilitychange", this.onVisibility);
  }
}
