FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py probe.py .
# Descarga los modelos en la imagen para que el arranque no dependa de la red
RUN python -c "from app import get_ocr; get_ocr()"
ENV PORT=3000 FLAGS_use_mkldnn=0
EXPOSE 3000
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT} --workers 1"]
