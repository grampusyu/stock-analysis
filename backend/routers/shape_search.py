"""사용자가 캔버스에 그린 가격 곡선(모양)과 유사한 최근 가격 움직임을 가진
종목을 찾는다. chart-pattern-predictor가 매일 생성하는 종가 시계열 캐시
(price_series_YYYYMMDD.json)를 그대로 읽어서 비교하므로 실시간 네트워크
조회가 없어 빠르다.
"""
import glob
import os
import threading
import time

import numpy as np
import pandas as pd
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter()

DATA_DIR = os.environ.get(
    "PATTERN_SCAN_DIR", r"D:\02_Project\chart-pattern-predictor\data"
)
RESAMPLE_N = 50  # 그린 곡선/종목 곡선을 비교할 때 맞출 공통 포인트 수

_cache: dict = {}
_cache_lock = threading.Lock()
CACHE_TTL = 1800  # 30분


def _latest_file(pattern: str) -> str | None:
    files = [
        f for f in glob.glob(os.path.join(DATA_DIR, pattern))
        if "excluded" not in os.path.basename(f)
    ]
    return max(files, key=os.path.basename) if files else None


def _load() -> tuple[dict, dict]:
    """(code -> close_series, code -> {name, market}) 반환. 30분 캐시."""
    series_path = _latest_file("price_series_*.json")
    names_path = _latest_file("pattern_scan_*.csv")
    if not series_path or not names_path:
        return {}, {}

    key = f"{os.path.basename(series_path)}|{os.path.basename(names_path)}"
    now = time.time()
    with _cache_lock:
        cached = _cache.get(key)
        if cached and now - cached["ts"] < CACHE_TTL:
            return cached["series"], cached["names"]

    import json
    with open(series_path, encoding="utf-8") as f:
        series = json.load(f)

    names_df = pd.read_csv(names_path, encoding="utf-8-sig", dtype={"code": str})
    names = {
        row.code: {"name": row.name, "market": row.market}
        for row in names_df.itertuples()
    }

    with _cache_lock:
        _cache[key] = {"series": series, "names": names, "ts": now}
    return series, names


def _resample(arr: np.ndarray, n: int = RESAMPLE_N) -> np.ndarray:
    if len(arr) == n:
        return arr.astype(float)
    x_old = np.linspace(0, 1, len(arr))
    x_new = np.linspace(0, 1, n)
    return np.interp(x_new, x_old, arr)


def _normalize(arr: np.ndarray) -> np.ndarray:
    lo, hi = float(arr.min()), float(arr.max())
    if hi - lo < 1e-9:
        return np.zeros_like(arr)
    return (arr - lo) / (hi - lo)


class ShapeSearchRequest(BaseModel):
    points: list[float] = Field(..., min_length=2, description="사용자가 그린 곡선의 y값 배열 (왼쪽->오른쪽 순서)")
    window: int = Field(20, description="비교할 최근 거래일 수: 20 | 60 | 120")
    market: str = Field("ALL", description="KOSPI | KOSDAQ | ALL")
    limit: int = Field(20)


@router.post("")
def search_shape(req: ShapeSearchRequest):
    series_map, names_map = _load()
    if not series_map:
        return {"results": [], "total": 0}

    drawn = _normalize(_resample(np.array(req.points, dtype=float)))

    results = []
    for code, closes in series_map.items():
        meta = names_map.get(code)
        if not meta:
            continue
        if req.market != "ALL" and meta["market"] != req.market:
            continue
        if len(closes) < req.window:
            continue

        window_slice = np.array(closes[-req.window:], dtype=float)
        norm_slice = _normalize(_resample(window_slice))
        dist = float(np.sqrt(np.mean((drawn - norm_slice) ** 2)))

        results.append({
            "code": code,
            "name": meta["name"],
            "market": meta["market"],
            "distance": round(dist, 4),
            "preview": [round(v) for v in window_slice.tolist()],
        })

    results.sort(key=lambda r: r["distance"])
    return {"results": results[: req.limit], "total": len(results)}
