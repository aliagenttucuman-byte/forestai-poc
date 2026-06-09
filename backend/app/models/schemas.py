from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from uuid import UUID
from enum import Enum

class AnalysisStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"

class AnalysisCreated(BaseModel):
    analysis_id: UUID
    status: AnalysisStatus
    created_at: datetime
    filename: str

class AnalysisStatusResponse(BaseModel):
    analysis_id: UUID
    status: AnalysisStatus
    progress: int
    current_step: Optional[str]
    created_at: datetime
    completed_at: Optional[datetime]
    tree_count: Optional[int]
    error: Optional[str]

class AnalysisSummaryItem(BaseModel):
    analysis_id: UUID
    filename: str
    name: Optional[str]
    status: AnalysisStatus
    created_at: datetime
    tree_count: Optional[int]
    error: Optional[str]

class AnalysisList(BaseModel):
    items: List[AnalysisSummaryItem]
    total: int
    limit: int
    offset: int

class TreeProperties(BaseModel):
    tree_id: str
    species: str
    crown_area_m2: float
    height_m: float
    biomass_kg: float
    age_years: int
    confidence: str
    centroid_lat: float
    centroid_lon: float
    allometric_source: Optional[str]

class TreeDetail(TreeProperties):
    r_mean: Optional[float]
    g_mean: Optional[float]
    b_mean: Optional[float]
    texture_score: Optional[float]
    # Clasificación Vision LLM (None si no se ejecutó o falló)
    vlm_species: Optional[str] = None
    vlm_health: Optional[str] = None
    vlm_confidence: Optional[float] = None
    vlm_notes: Optional[str] = None

class SpeciesDistribution(BaseModel):
    species: str
    count: int
    percentage: float
    total_biomass_kg: float

class InventorySummary(BaseModel):
    analysis_id: UUID
    total_trees: int
    total_biomass_tons: float
    total_crown_area_ha: float
    average_height_m: float
    average_age_years: float
    species_distribution: List[SpeciesDistribution]
    analyzed_at: Optional[datetime]
    source_filename: str

class ErrorResponse(BaseModel):
    detail: str
    code: Optional[str] = None
