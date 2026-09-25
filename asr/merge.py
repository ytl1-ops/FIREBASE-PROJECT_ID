"""Fusion de la transcription (mots horodatés) et de la diarisation (tours de parole).

Fonctions pures, sans dépendance aux modèles : testées isolément.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Word:
    start: float  # secondes
    end: float
    text: str  # avec l'espace de tête fourni par Whisper (« ▁mot » → « mot »)


@dataclass
class Turn:
    start: float
    end: float
    speaker: int


def speaker_at(start: float, end: float, turns: list[Turn]) -> int | None:
    """Locuteur dont le tour recouvre le plus l'intervalle ; à défaut, le tour le plus proche."""
    best, best_overlap = None, 0.0
    for t in turns:
        overlap = min(end, t.end) - max(start, t.start)
        if overlap > best_overlap:
            best, best_overlap = t.speaker, overlap
    if best is not None or not turns:
        return best
    middle = (start + end) / 2
    nearest = min(turns, key=lambda t: min(abs(middle - t.start), abs(middle - t.end)))
    return nearest.speaker


def group_utterances(
    words: list[Word],
    turns: list[Turn],
    max_pause: float = 1.5,
    max_duration: float = 30.0,
) -> list[dict]:
    """Regroupe les mots en interventions : un changement de locuteur, une pause longue
    ou une durée excessive ouvre une nouvelle intervention. Les locuteurs sont renumérotés
    par ordre d'apparition (« Locuteur 1 », « Locuteur 2 »…)."""
    utterances: list[dict] = []
    labels: dict[int, str] = {}

    def label(speaker: int | None) -> str:
        key = -1 if speaker is None else speaker
        if key not in labels:
            labels[key] = f"Locuteur {len(labels) + 1}"
        return labels[key]

    current: dict | None = None
    for w in words:
        text = w.text.strip()
        if not text:
            continue
        who = label(speaker_at(w.start, w.end, turns))
        if (
            current is None
            or who != current["speaker"]
            or w.start - current["_end"] > max_pause
            or w.end - current["_start"] > max_duration
        ):
            current = {"speaker": who, "_start": w.start, "_end": w.end, "words": [text]}
            utterances.append(current)
        else:
            current["words"].append(text)
            current["_end"] = w.end

    return [
        {
            "start": round(u["_start"] * 1000),
            "end": round(u["_end"] * 1000),
            "speaker": u["speaker"],
            "text": join_words(u["words"]),
        }
        for u in utterances
    ]


def join_words(words: list[str]) -> str:
    """Recolle les mots en respectant la ponctuation française (espace avant « : ; ! ? »)."""
    text = ""
    for w in words:
        if not text:
            text = w
        elif w[0] in ",.)…" or w.startswith("'") or text.endswith(("'", "’", "(")):
            text += w
        else:
            text += " " + w
    return text
