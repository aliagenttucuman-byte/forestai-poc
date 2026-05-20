FROM python:3.11-slim

# Dependencias del sistema mínimas
# rasterio instala su propio GDAL via wheels binarios → no necesitamos libgdal-dev
RUN apt-get update && apt-get install -y \
    gcc g++ python3-dev \
    libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar primero las dependencias pesadas para aprovechar caché de Docker
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

ENV UPLOAD_DIR=/app/uploads
RUN mkdir -p /app/uploads

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
