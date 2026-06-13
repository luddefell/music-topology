from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .pipeline import CellSignal, cluster_cells
from .settings import settings

app = FastAPI(title="SoundscapeMap Region Service", version="0.1.0")


class CellSignalPayload(BaseModel):
    h3_cell: str
    lat: float
    lng: float
    genre_scores: dict[str, float] = Field(default_factory=dict)
    audio_energy: float = 0.5
    audio_valence: float = 0.5
    audio_danceability: float = 0.5
    audio_tempo_norm: float = 0.5
    vote_density: float = 0.0
    vote_count: int = 0


@app.get("/health")
async def health():
    return {"ok": True, "model": settings.region_model}


@app.post("/regions/cluster")
async def cluster(payload: list[CellSignalPayload]):
    if len(payload) > 5000:
        raise HTTPException(status_code=413, detail="Too many cells for one clustering request")
    cells = [CellSignal(**item.model_dump()) for item in payload]
    return cluster_cells(cells)


@app.get("/regions")
async def regions(cells: str = ""):
    requested = [cell for cell in cells.split(",") if cell]
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": None,
                "properties": {
                    "h3_cell": cell,
                    "dominant_genre": "pop",
                    "genre_color": "#EC4899",
                    "vote_count": 0,
                    "is_transition_zone": False,
                },
            }
            for cell in requested[:500]
        ],
    }
