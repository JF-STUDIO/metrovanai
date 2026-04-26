FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    enblend \
    hugin-tools \
    imagemagick \
    libimage-exiftool-perl \
    rawtherapee \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY handler.py /app/handler.py
COPY metrovan_processor.py /app/metrovan_processor.py

ENV METROVAN_PROCESSOR_COMMAND="python /app/metrovan_processor.py"
ENV METROVAN_REGEN_COMMAND="python /app/metrovan_processor.py"

CMD ["python", "-u", "handler.py"]
