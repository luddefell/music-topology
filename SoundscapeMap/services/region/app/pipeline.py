from __future__ import annotations

import math
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any

import numpy as np
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis, QuadraticDiscriminantAnalysis
from sklearn.metrics import davies_bouldin_score, silhouette_score
from sklearn.mixture import GaussianMixture

from .settings import settings
from .taxonomy import GENRE_COLORS, GENRES


@dataclass(frozen=True)
class CellSignal:
    h3_cell: str
    lat: float
    lng: float
    genre_scores: dict[str, float]
    audio_energy: float = 0.5
    audio_valence: float = 0.5
    audio_danceability: float = 0.5
    audio_tempo_norm: float = 0.5
    vote_density: float = 0.0
    vote_count: int = 0


def entropy(distribution: dict[str, float]) -> float:
    total = sum(distribution.values())
    if total <= 0:
        return 0.0
    return -sum((score / total) * math.log(score / total) for score in distribution.values() if score > 0)


def dominant_genre(scores: dict[str, float]) -> str:
    if not scores:
        return "pop"
    return max(scores.items(), key=lambda item: item[1])[0]


def vibe_label(energy: float, valence: float, danceability: float, tempo_norm: float) -> str:
    if energy > 0.7 and danceability > 0.7:
        return "High Energy"
    if valence < 0.3 and energy < 0.4:
        return "Dark / Moody"
    if tempo_norm > 0.8:
        return "Fast"
    return "Open Mix"


def build_feature_matrix(cells: list[CellSignal]) -> tuple[np.ndarray, list[str]]:
    max_density = max([cell.vote_density for cell in cells], default=1.0) or 1.0
    features: list[list[float]] = []
    labels: list[str] = []
    for cell in cells:
        total = sum(cell.genre_scores.values()) or 1.0
        genre_vector = [cell.genre_scores.get(genre, 0.0) / total for genre in GENRES]
        row = [
            *genre_vector,
            cell.audio_energy,
            cell.audio_valence,
            cell.audio_danceability,
            cell.audio_tempo_norm,
            cell.vote_density / max_density,
            cell.lat * settings.cluster_spatial_weight,
            cell.lng * settings.cluster_spatial_weight,
        ]
        features.append(row)
        labels.append(dominant_genre(cell.genre_scores))
    return np.array(features, dtype=float), labels


def _hdbscan_labels(x: np.ndarray) -> tuple[np.ndarray, np.ndarray, str]:
    try:
        import hdbscan  # type: ignore
    except Exception:
        return np.arange(len(x)), np.ones(len(x)), "fixed_h3"

    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=settings.cluster_min_size,
        min_samples=3,
        metric="euclidean",
        cluster_selection_method="eom",
        prediction_data=True,
    )
    labels = clusterer.fit_predict(x)
    return labels, clusterer.probabilities_, "hdbscan"


def _gmm_labels(x: np.ndarray) -> tuple[np.ndarray, np.ndarray, str]:
    if len(x) < 5:
        return np.arange(len(x)), np.ones(len(x)), "fixed_h3"
    upper = min(20, len(x))
    best: GaussianMixture | None = None
    best_bic = math.inf
    for k in range(5, upper + 1):
        model = GaussianMixture(n_components=k, covariance_type="full", random_state=42)
        model.fit(x)
        bic = model.bic(x)
        if bic < best_bic:
            best = model
            best_bic = bic
    assert best is not None
    labels = best.predict(x)
    confidence = best.predict_proba(x).max(axis=1)
    return labels, confidence, "gmm"


def _qda_labels(x: np.ndarray, weak_labels: list[str]) -> tuple[np.ndarray, np.ndarray, str]:
    if len(set(weak_labels)) < 2:
        return np.arange(len(x)), np.ones(len(x)), "fixed_h3"
    counts = Counter(weak_labels)
    estimator = QuadraticDiscriminantAnalysis(reg_param=0.1)
    model_name = "qda"
    if min(counts.values()) < 50:
        estimator = LinearDiscriminantAnalysis()
        model_name = "lda"
    estimator.fit(x, weak_labels)
    predicted = estimator.predict(x)
    proba = estimator.predict_proba(x)
    label_map = {label: idx for idx, label in enumerate(sorted(set(predicted)))}
    labels = np.array([label_map[label] for label in predicted])
    return labels, proba.max(axis=1), model_name


def evaluate_quality(x: np.ndarray, labels: np.ndarray, fit_duration_ms: int, model: str) -> dict[str, Any]:
    valid_mask = labels != -1
    valid_labels = labels[valid_mask]
    n_clusters = len(set(valid_labels.tolist()))
    n_valid = int(valid_mask.sum())
    if n_valid > 2 and 1 < n_clusters < n_valid:
        silhouette = float(silhouette_score(x[valid_mask], valid_labels))
        davies = float(davies_bouldin_score(x[valid_mask], valid_labels))
    else:
        silhouette = 0.0
        davies = 0.0
    return {
        "model": model,
        "n_clusters": n_clusters,
        "n_noise_cells": int((labels == -1).sum()),
        "silhouette_score": silhouette,
        "davies_bouldin": davies,
        "fit_duration_ms": fit_duration_ms,
    }


def cluster_cells(cells: list[CellSignal]) -> dict[str, Any]:
    eligible = [cell for cell in cells if cell.vote_count >= 3]
    if not eligible:
        return {"features": [], "quality": evaluate_quality(np.empty((0, 0)), np.array([]), 0, "fixed_h3")}

    started = time.perf_counter()
    x, weak_labels = build_feature_matrix(eligible)
    if settings.region_model == "gmm":
        labels, confidence, model = _gmm_labels(x)
    elif settings.region_model == "qda":
        labels, confidence, model = _qda_labels(x, weak_labels)
    elif settings.region_model == "hdbscan":
        labels, confidence, model = _hdbscan_labels(x)
    else:
        labels, confidence, model = np.arange(len(eligible)), np.ones(len(eligible)), "fixed_h3"

    duration_ms = int((time.perf_counter() - started) * 1000)
    quality = evaluate_quality(x, labels, duration_ms, model)

    clusters: dict[int, list[tuple[CellSignal, float]]] = defaultdict(list)
    for cell, label, conf in zip(eligible, labels.tolist(), confidence.tolist(), strict=True):
        clusters[int(label)].append((cell, float(conf)))

    features = []
    for label, members in clusters.items():
        genre_scores: dict[str, float] = defaultdict(float)
        vote_count = 0
        energies, valences, dances, tempos = [], [], [], []
        for cell, _ in members:
            vote_count += cell.vote_count
            energies.append(cell.audio_energy)
            valences.append(cell.audio_valence)
            dances.append(cell.audio_danceability)
            tempos.append(cell.audio_tempo_norm)
            for genre, score in cell.genre_scores.items():
                genre_scores[genre] += score

        genre = dominant_genre(dict(genre_scores))
        transition = label == -1 or entropy(dict(genre_scores)) > 1.5
        if transition:
            genre = "mixed"
        features.append(
            {
                "type": "Feature",
                "geometry": None,
                "properties": {
                    "cluster_id": label,
                    "h3_cells": [cell.h3_cell for cell, _ in members],
                    "dominant_genre": genre,
                    "vibe": "Mixed vibes" if transition else vibe_label(np.mean(energies), np.mean(valences), np.mean(dances), np.mean(tempos)),
                    "genre_color": GENRE_COLORS[genre],
                    "confidence": float(np.mean([conf for _, conf in members])),
                    "vote_count": vote_count,
                    "cell_count": len(members),
                    "is_transition_zone": transition,
                },
            }
        )

    return {"type": "FeatureCollection", "features": features, "quality": quality}
