import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Float, DateTime, Text, Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase
from geoalchemy2 import Geometry
import enum

class Base(DeclarativeBase):
    pass

class AnalysisStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"

class Analysis(Base):
    __tablename__ = "analyses"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=True)
    filename = Column(String(255), nullable=False)
    filepath = Column(String(500), nullable=False)
    status = Column(SAEnum(AnalysisStatus), default=AnalysisStatus.pending, nullable=False)
    progress = Column(Integer, default=0)
    current_step = Column(String(255), nullable=True)
    tree_count = Column(Integer, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

class Tree(Base):
    __tablename__ = "trees"
    id = Column(String(50), primary_key=True)  # "tree-0001"
    analysis_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    species = Column(String(50), nullable=False)
    crown_area_m2 = Column(Float, nullable=False)
    height_m = Column(Float, nullable=False)
    biomass_kg = Column(Float, nullable=False)
    age_years = Column(Integer, nullable=False)
    confidence = Column(String(10), nullable=False)
    centroid_lat = Column(Float, nullable=False)
    centroid_lon = Column(Float, nullable=False)
    allometric_source = Column(String(255), nullable=True)
    r_mean = Column(Float, nullable=True)
    g_mean = Column(Float, nullable=True)
    b_mean = Column(Float, nullable=True)
    texture_score = Column(Float, nullable=True)
    # PostGIS geometry (polygon de la copa en EPSG:4326)
    geom = Column(Geometry("POLYGON", srid=4326), nullable=True)
