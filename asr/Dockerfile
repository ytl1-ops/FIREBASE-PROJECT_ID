# Service de transcription MonMeeting : faster-whisper + sherpa-onnx (100 % local).
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl bzip2 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

ENV MODELS_DIR=/models
COPY download_models.sh .
RUN ./download_models.sh

COPY merge.py pipeline.py app.py ./
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
