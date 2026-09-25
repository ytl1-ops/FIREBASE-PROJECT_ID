"""Transcription + identification des voix, 100 % locale.

- faster-whisper (Whisper optimisé CTranslate2) : texte horodaté au mot ;
- sherpa-onnx (segmentation pyannote + empreintes vocales 3D-Speaker) : tours de parole ;
- fusion des deux (merge.py).
Aucun service externe : les modèles sont téléchargés une fois, puis tout tourne hors ligne.
"""

from __future__ import annotations

import os
import threading
from collections.abc import Callable

import numpy as np

from merge import Turn, Word, group_utterances

SAMPLE_RATE = 16_000
MODELS_DIR = os.environ.get("MODELS_DIR", "/models")
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "auto")  # auto | cpu | cuda
WHISPER_COMPUTE = os.environ.get("WHISPER_COMPUTE_TYPE", "default")
SEGMENTATION_MODEL = os.environ.get(
    "SEGMENTATION_MODEL", f"{MODELS_DIR}/sherpa-onnx-pyannote-segmentation-3-0/model.onnx"
)
EMBEDDING_MODEL = os.environ.get(
    "EMBEDDING_MODEL", f"{MODELS_DIR}/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"
)
# Distance de regroupement des voix quand le nombre d'intervenants n'est pas indiqué.
CLUSTER_THRESHOLD = float(os.environ.get("CLUSTER_THRESHOLD", "0.5"))
CPU_THREADS = int(os.environ.get("CPU_THREADS", str(os.cpu_count() or 4)))

Progress = Callable[[str, float], None]

_lock = threading.Lock()
_whisper = None


def _load_whisper():
    global _whisper
    with _lock:
        if _whisper is None:
            from faster_whisper import WhisperModel

            _whisper = WhisperModel(
                WHISPER_MODEL,
                device=WHISPER_DEVICE,
                compute_type=WHISPER_COMPUTE,
                cpu_threads=CPU_THREADS,
                download_root=f"{MODELS_DIR}/whisper",
            )
        return _whisper


def decode(path: str) -> np.ndarray:
    """Décode tout fichier audio/vidéo (webm, mp4, m4a, mp3, wav…) en mono 16 kHz float32."""
    from faster_whisper import decode_audio

    return decode_audio(path, sampling_rate=SAMPLE_RATE)


def diarize(audio: np.ndarray, speakers: int | None, progress: Progress) -> list[Turn]:
    import sherpa_onnx

    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=SEGMENTATION_MODEL),
            num_threads=CPU_THREADS,
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=EMBEDDING_MODEL, num_threads=CPU_THREADS),
        clustering=sherpa_onnx.FastClusteringConfig(
            num_clusters=speakers if speakers and speakers > 0 else -1,
            threshold=CLUSTER_THRESHOLD,
        ),
        min_duration_on=0.3,
        min_duration_off=0.5,
    )
    if not config.validate():
        raise RuntimeError("Modèles de diarisation introuvables : lancez download_models.sh.")
    engine = sherpa_onnx.OfflineSpeakerDiarization(config)

    def callback(done: int, total: int) -> int:
        progress("Identification des voix", done / max(total, 1))
        return 0

    result = engine.process(audio, callback=callback).sort_by_start_time()
    return [Turn(r.start, r.end, r.speaker) for r in result]


def transcribe(
    path: str,
    languages: list[str],
    speakers: int | None,
    vocabulary: list[str],
    progress: Progress,
) -> dict:
    progress("Préparation de l'audio", 0.0)
    audio = decode(path)
    duration = len(audio) / SAMPLE_RATE

    turns: list[Turn] = []
    if speakers != 1 and duration > 2:
        turns = diarize(audio, speakers, progress)

    model = _load_whisper()
    terms = [v.strip() for v in vocabulary if v.strip()]
    segments, info = model.transcribe(
        audio,
        language=languages[0] if len(languages) == 1 else None,
        task="transcribe",
        word_timestamps=True,
        vad_filter=True,
        beam_size=5,
        condition_on_previous_text=False,  # limite les répétitions en boucle
        initial_prompt=("Vocabulaire : " + ", ".join(terms[:100])) if terms else None,
        hotwords=" ".join(terms[:100]) if terms else None,
    )
    words: list[Word] = []
    for seg in segments:
        progress("Transcription", min(seg.end / max(duration, 1), 1.0))
        if seg.words:
            words.extend(Word(w.start, w.end, w.word) for w in seg.words)
        else:
            words.append(Word(seg.start, seg.end, seg.text))

    progress("Finalisation", 1.0)
    return {
        "segments": group_utterances(words, turns),
        "languages": [info.language] if info.language else [],
        "durationMs": round(duration * 1000),
    }
