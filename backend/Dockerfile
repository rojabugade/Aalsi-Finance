FROM python:3.12-slim

# uv: fast, reproducible dependency installs (project standard — no pip).
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_NO_CACHE=1 \
    UV_SYSTEM_PYTHON=1

WORKDIR /app

# Tesseract is the local, on-box OCR backend (no external/AI service): the default
# extraction path reads receipts/statements without sending bytes to any LLM.
# tesseract-ocr-eng ships the English language data; libgl/libglib satisfy Pillow.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        tesseract-ocr tesseract-ocr-eng libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN uv pip install --system -r requirements.txt

COPY . .

EXPOSE 8000

# Overridden per-service in docker-compose (api / worker / beat).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
