/**
 * Enregistreur audio/vidéo longue durée.
 * - Audio : micro seul, ou micro + audio système (onglet de visioconférence) mixés.
 * - Vidéo : caméra + micro, ou écran partagé + micro + audio système.
 * - Fragments émis toutes les `timeslice` ms pour être persistés immédiatement.
 * - Verrou d'écran (Wake Lock) pour éviter la mise en veille pendant la réunion.
 */
export type CaptureMode = "micro" | "visio" | "camera" | "ecran";

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

  async start(mode: CaptureMode, deviceId?: string) {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: 1,
        echoCancellation: mode !== "micro",
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.micStream = mic;
    this.streams.push(mic);

    this.audioContext = new AudioContext();
    const destination = this.audioContext.createMediaStreamDestination();
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 1024;

    const micSource = this.audioContext.createMediaStreamSource(mic);
    micSource.connect(destination);
    micSource.connect(analyser);

    let videoTrack: MediaStreamTrack | undefined;
    if (mode === "camera") {
      const cam = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      });
      this.streams.push(cam);
      videoTrack = cam.getVideoTracks()[0];
    }

    if (mode === "visio" || mode === "ecran") {
      // Capture de l'onglet/écran partagé (Teams, Zoom, Meet dans le navigateur).
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      this.streams.push(display);
      if (mode === "ecran") videoTrack = display.getVideoTracks()[0];
      else display.getVideoTracks().forEach((t) => t.stop());
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
      audioBitsPerSecond: 64_000,
      // ≈ 450 Mo par heure : lisible et partageable, sans saturer le stockage du navigateur.
      ...(videoTrack ? { videoBitsPerSecond: 1_000_000 } : {}),
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
