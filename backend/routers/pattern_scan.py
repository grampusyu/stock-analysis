"""chart-pattern-predictor 프로젝트에서 매일 생성하는 전종목 패턴 스캔 CSV를
읽어서 서빙한다. 실데이터는 별도 프로젝트(D:\\02_Project\\chart-pattern-predictor)의
scan_current_pattern.py / daily_alert.py가 매일 07:00 Task Scheduler로 생성한다.

스팩/저유동성/최근 2개년 연속 순손실 종목은 생성 단계(run_scan)에서 이미
제외되므로 이 라우터는 CSV를 그대로 읽어 서빙하기만 한다(실시간 재무 조회 없음 —
과거에 yfinance로 요청당 실시간 조회를 시도했으나 종목당 수 초~수십 초가 걸려
페이지가 멈추는 수준이었음. DART API로 전환해 스캔 파이프라인 쪽에서 미리 계산).

원 통계 분석(analyze_flow_pattern.py)의 상관계수는 r=0.002~0.04 수준으로 매우
약했으므로, 이 점수는 매매 신호가 아니라 탐색용 참고 지표다.
"""
import glob
import os
import threading
import time

import pandas as pd
from fastapi import APIRouter, Query

router = APIRouter()

CSV_DIR = os.environ.get(
    "PATTERN_SCAN_DIR", r"D:\02_Project\chart-pattern-predictor\data"
)

_cache: dict = {}
_cache_lock = threading.Lock()
CACHE_TTL = 1800  # 30분


def _latest_csv_path() -> str | None:
    files = [
        f for f in glob.glob(os.path.join(CSV_DIR, "pattern_scan_*.csv"))
        if "excluded" not in os.path.basename(f)
    ]
    if not files:
        return None
    return max(files, key=os.path.basename)


def _load() -> tuple[list[dict], str | None]:
    path = _latest_csv_path()
    if not path:
        return [], None

    key = os.path.basename(path)
    mtime = os.path.getmtime(path)
    now = time.time()
    with _cache_lock:
        cached = _cache.get(key)
        if cached and cached["mtime"] == mtime and now - cached["ts"] < CACHE_TTL:
            return cached["records"], cached["date"]

    df = pd.read_csv(path, encoding="utf-8-sig", dtype={"code": str})
    df = df.sort_values("score", ascending=False)
    records = df.to_dict(orient="records")
    date_str = key.replace("pattern_scan_", "").replace(".csv", "")

    with _cache_lock:
        _cache[key] = {"records": records, "date": date_str, "ts": now, "mtime": mtime}
    return records, date_str


@router.get("")
def get_pattern_scan(
    market: str = Query("ALL", description="KOSPI | KOSDAQ | ALL"),
    limit: int = Query(50),
):
    records, date_str = _load()
    if date_str is None:
        return {"results": [], "total": 0, "date": None}

    if market != "ALL":
        records = [r for r in records if r.get("market") == market]

    return {
        "results": records[:limit],
        "total": len(records),
        "date": date_str,
    }
