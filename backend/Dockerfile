FROM python:3.11-slim

# Dependencias del sistema para rasterio, gdal, opencv
RUN apt-get update && apt-get install -y \
    gdal-bin libgdal-dev gcc g++ python3-dev \
    libgl1-mesa-glx libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV UPLOAD_DIR=/app/uploads
RUN mkdir -p /app/uploads

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
