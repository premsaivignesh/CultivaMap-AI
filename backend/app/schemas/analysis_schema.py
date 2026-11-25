from typing import Optional

from pydantic import BaseModel, Field


class Params(BaseModel):
    # DBSCAN
    eps: float = Field(default=0.4, gt=0, le=10)
    min_samples: int = Field(default=5, ge=2, le=200)
    use_coordinates: bool = True
    spatial_weight: float = Field(default=1.0, ge=0, le=5)
    # suitability thresholds (cluster means) - editable, justify with references for your crop/region
    slope_good: float = Field(default=8.0, gt=0, le=60)
    slope_ok: float = Field(default=15.0, gt=0, le=60)
    moist_good: float = Field(default=22.0, ge=0, le=100)
    moist_ok: float = Field(default=15.0, ge=0, le=100)
    elev_min: Optional[float] = None
    elev_max: Optional[float] = None
    include_moderate: bool = True
    # processing
    remove_outliers: bool = True
    grid_cells: int = Field(default=240, ge=60, le=400)
