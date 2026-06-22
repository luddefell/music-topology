from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, model_validator
from h3 import cell_to_latlng

from .pipeline import CellSignal, cluster_cells
from .settings import settings

app = FastAPI(title="SoundscapeMap Region Service", version="0.1.0")


class TrackEnrichmentPayload(BaseModel):
    model: str | None = None
    track_id: str
    name: str | None = None
    artist: str | None = None
    genre_label: str | None = None
    fallback_genre: str | None = None
    instruction: str | None = None


class CellSignalPayload(BaseModel):
    h3_cell: str
    lat: float | None = None
    lng: float | None = None
    genre_scores: dict[str, float] = Field(default_factory=dict)
    audio_energy: float = 0.5
    audio_valence: float = 0.5
    audio_danceability: float = 0.5
    audio_tempo_norm: float = 0.5
    vote_density: float = 0.0
    vote_count: int = 0

    @model_validator(mode="after")
    def fill_h3_center(self):
        if self.lat is None or self.lng is None:
            lat, lng = cell_to_latlng(self.h3_cell)
            self.lat = lat
            self.lng = lng
        return self


@app.get("/health")
async def health():
    return {"ok": True, "model": settings.region_model}


@app.post("/tracks/enrich")
async def enrich_track(payload: TrackEnrichmentPayload, authorization: str | None = Header(default=None)):
    api_key = _openai_api_key(authorization)
    if api_key:
        enriched = _openai_descriptors(payload, api_key)
        if enriched:
            return enriched
    return _local_descriptors(payload)


def _openai_api_key(authorization: str | None) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return os.getenv("OPENAI_API_KEY", "").strip() or os.getenv("ML_LLM_API_KEY", "").strip()


def _openai_descriptors(payload: TrackEnrichmentPayload, api_key: str) -> dict | None:
    model = payload.model or os.getenv("OPENAI_DESCRIPTOR_MODEL", "gpt-4.1-mini")
    prompt = {
        "track_id": payload.track_id,
        "title": payload.name,
        "artist": payload.artist,
        "spotify_genre_label": payload.genre_label,
        "fallback_genre": None if payload.fallback_genre == "unknown" else payload.fallback_genre,
        "task": (
            "Create descriptors for grouping songs on a hyperlocal campus sound map. "
            "Use music/culture/listening-context words, not neighborhood names. "
            "Do not return unknown. Return 3 to 6 short lowercase descriptors. "
            "If confident, include one macro:<genre> descriptor such as macro:electronic, "
            "macro:hiphop, macro:rock, macro:latin, macro:jazz, macro:pop, or macro:classical."
        ),
    }
    body = {
        "model": model,
        "input": [
            {
                "role": "system",
                "content": (
                    "You enrich Spotify track metadata for ML clustering. "
                    "Return only JSON with keys descriptors and summary. "
                    "descriptors must be an array of short lowercase slugs."
                ),
            },
            {"role": "user", "content": json.dumps(prompt)},
        ],
        "temperature": 0.2,
        "max_output_tokens": 220,
    }
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            data = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None

    parsed = _parse_openai_json(data)
    descriptors = _clean_descriptors(parsed.get("descriptors", []))
    descriptors = [item for item in descriptors if item != "unknown" and item != "macro:unknown"]
    if not descriptors:
        return None
    return {
        "model": model,
        "provider": "openai",
        "track_id": payload.track_id,
        "descriptors": descriptors[:8],
        "summary": str(parsed.get("summary") or f"{payload.name or 'Track'} is grouped by AI music descriptors."),
    }


def _parse_openai_json(data: dict) -> dict:
    text = data.get("output_text") or ""
    if not text:
        for item in data.get("output", []):
            for content in item.get("content", []):
                if content.get("type") in {"output_text", "text"} and content.get("text"):
                    text += content["text"]
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not match:
        return {}
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _clean_descriptors(values) -> list[str]:
    descriptors: list[str] = []
    if not isinstance(values, list):
        return descriptors
    for value in values:
        cleaned = re.sub(r"[^a-z0-9:-]+", "-", str(value).lower()).strip("-")
        if cleaned:
            descriptors.append(cleaned)
    return list(dict.fromkeys(descriptors))


def _local_descriptors(payload: TrackEnrichmentPayload):
    text = " ".join(
        part.lower()
        for part in [payload.name, payload.artist, payload.genre_label, payload.fallback_genre]
        if part
    )
    descriptors: list[str] = []
    rules = [
        ("late-night", ["night", "midnight", "after dark", "dark"]),
        ("study-friendly", ["study", "ambient", "lo-fi", "lofi", "jazz", "piano", "acoustic"]),
        ("danceable", ["dance", "club", "house", "techno", "disco", "edm"]),
        ("high-energy", ["rock", "punk", "trap", "drill", "rage", "metal"]),
        ("social", ["pop", "viral", "hit", "party"]),
        ("moody", ["sad", "blue", "alone", "melancholy", "emo"]),
        ("global", ["latin", "reggaeton", "afro", "k-pop", "j-pop", "world"]),
    ]
    for descriptor, needles in rules:
        if any(needle in text for needle in needles):
            descriptors.append(descriptor)
    if payload.fallback_genre and payload.fallback_genre != "unknown":
        descriptors.append(f"macro:{payload.fallback_genre}")
    if not descriptors:
        descriptors.append("open-mix")
    return {
        "model": payload.model or "local-descriptor-llm-v1",
        "provider": "local-fallback",
        "track_id": payload.track_id,
        "descriptors": list(dict.fromkeys(descriptors))[:8],
        "summary": f"{payload.name or 'Track'} is treated as a {' / '.join(descriptors[:3])} signal for sound-region clustering.",
    }


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
                    "dominant_genre": "unknown",
                    "genre_color": "#64748B",
                    "vote_count": 0,
                    "is_transition_zone": False,
                },
            }
            for cell in requested[:500]
        ],
    }
