#!/bin/sh
# Télécharge les modèles d'identification des voix (sherpa-onnx, publiés sur GitHub).
# Le modèle Whisper est téléchargé automatiquement au premier démarrage (puis mis en cache).
set -eu
DIR="${MODELS_DIR:-/models}"
REL="https://github.com/k2-fsa/sherpa-onnx/releases/download"
mkdir -p "$DIR"
if [ ! -f "$DIR/sherpa-onnx-pyannote-segmentation-3-0/model.onnx" ]; then
  curl -fsSL "$REL/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2" | tar xj -C "$DIR"
fi
if [ ! -f "$DIR/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx" ]; then
  curl -fsSL -o "$DIR/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx" \
    "$REL/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"
fi
echo "Modèles prêts dans $DIR"
