FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    enblend \
    hugin \
    hugin-tools \
    imagemagick \
    libimage-exiftool-perl \
    liblensfun-bin \
    liblensfun-data-v1 \
    rawtherapee \
  && rm -rf /var/lib/apt/lists/*

RUN lensfun-update-data || true \
  && command -v align_image_stack \
  && command -v enfuse \
  && command -v rawtherapee-cli \
  && command -v exiftool

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY handler.py /app/handler.py
COPY metrovan_processor.py /app/metrovan_processor.py

ENV METROVAN_PROCESSOR_COMMAND="python /app/metrovan_processor.py"
ENV METROVAN_REGEN_COMMAND="python /app/metrovan_processor.py"

CMD ["python", "-u", "handler.py"]
