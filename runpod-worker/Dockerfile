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
    libgomp1 \
    libimage-exiftool-perl \
    liblensfun-bin \
    liblensfun-data-v1 \
    rawtherapee \
  && rm -rf /var/lib/apt/lists/*

RUN curl -L \
      -o /tmp/RawTherapee_5.12_release.AppImage \
      https://rawtherapee.com/shared/builds/linux/RawTherapee_5.12_release.AppImage \
  && echo "95d0db7b9c6af85209af66b10b31ac47270e39d937763ac919f826586ea49f08  /tmp/RawTherapee_5.12_release.AppImage" | sha256sum -c - \
  && chmod +x /tmp/RawTherapee_5.12_release.AppImage \
  && mkdir -p /opt/rawtherapee-5.12 \
  && cd /opt/rawtherapee-5.12 \
  && /tmp/RawTherapee_5.12_release.AppImage --appimage-extract \
  && printf '%s\n' '#!/bin/sh' \
      'exec /opt/rawtherapee-5.12/squashfs-root/AppRun "$@"' \
      > /usr/local/bin/rawtherapee-cli \
  && chmod +x /usr/local/bin/rawtherapee-cli \
  && rm /tmp/RawTherapee_5.12_release.AppImage

RUN lensfun-update-data || true \
  && command -v align_image_stack \
  && command -v enfuse \
  && command -v exiftool \
  && command -v rawtherapee-cli \
  && rawtherapee-cli -v >/tmp/rawtherapee-version.txt 2>&1

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY handler.py /app/handler.py
COPY metrovan_processor.py /app/metrovan_processor.py

ENV METROVAN_PROCESSOR_COMMAND="python /app/metrovan_processor.py"
ENV METROVAN_REGEN_COMMAND="python /app/metrovan_processor.py"
ENV METROVAN_ACR_LCP_DIR="/opt/metrovan/lcp-profiles"
ENV METROVAN_RAWTHERAPEE_CLI="/usr/local/bin/rawtherapee-cli"

CMD ["python", "-u", "handler.py"]
