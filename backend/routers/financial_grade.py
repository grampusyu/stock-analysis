"""chart-pattern-predictor 프로젝트가 매일 아침 생성하는 재무 등급 스캔 CSV를
그대로 읽어서 서빙한다. 실데이터는 별도 프로젝트(D:\\02_Project\\chart-pattern-predictor)의
financial_grade.py가 매일 Task Scheduler로 생성한다(pattern_scan.py와 동일한 서빙 패턴).

DART 재무제표 기반 5단계(최상/상/중/하/최하) 건전성 등급 + 업종 평균 대비 저평가 여부를
포함한다. 매매 신호가 아니라 스크리닝 참고용이다.
"""
import glob
import json
import os
import sqlite3
import threading
import time
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, Query
from pydantic import BaseModel

router = APIRouter()

CSV_DIR = os.environ.get(
    "PATTERN_SCAN_DIR", r"D:\02_Project\chart-pattern-predictor\data"
)

FAV_DB_PATH = Path(__file__).parent.parent / "portfolio.db"

KSIC_PATH = Path(__file__).parent.parent / "data" / "ksic_10.csv"


def _load_sector_map() -> dict[str, str]:
    """DART induty_code(한국표준산업분류 코드) -> 업종명 매핑.

    DART company.json의 induty_code는 KSIC 소분류(3~4자리) 코드를 그대로 쓴다
    (예: 701=자연과학 및 공학 연구개발업, 212=의약품 제조업) — 별도 이름 필드가
    없어서 FinanceData/KSIC 공개 코드표(github.com/FinanceData/KSIC)를 받아
    로컬에 저장해두고 조인한다.
    """
    if not KSIC_PATH.exists():
        return {}
    df = pd.read_csv(KSIC_PATH, dtype={"Industy_code": str})
    return dict(zip(df["Industy_code"], df["Industy_name"]))


SECTOR_MAP = _load_sector_map()


def _init_favorites_db():
    with sqlite3.connect(FAV_DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS financial_grade_favorites (
                market TEXT NOT NULL,
                code TEXT NOT NULL,
                added_at TEXT DEFAULT (datetime('now')),
                PRIMARY KEY (market, code)
            )
        """)


_init_favorites_db()


class FavoriteItem(BaseModel):
    market: str
    code: str

_cache: dict = {}
_cache_lock = threading.Lock()
CACHE_TTL = 1800  # 30분

TIER_ORDER = ["최상", "상", "중", "하", "최하"]


def _latest_csv_path() -> str | None:
    files = glob.glob(os.path.join(CSV_DIR, "financial_grade_*.csv"))
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
    if "sparkline" in df.columns:
        df["sparkline"] = df["sparkline"].apply(lambda v: json.loads(v) if isinstance(v, str) else None)
    df["tier"] = pd.Categorical(df["tier"], categories=TIER_ORDER, ordered=True)
    df = df.sort_values(["tier", "score"], ascending=[True, False])
    df = df.astype(object).where(pd.notnull(df), None)  # NaN -> None (Starlette JSONResponse는 NaN을 허용 안 함)
    records = df.to_dict(orient="records")
    date_str = key.replace("financial_grade_", "").replace(".csv", "")

    with _cache_lock:
        _cache[key] = {"records": records, "date": date_str, "ts": now, "mtime": mtime}
    return records, date_str


@router.get("")
def get_financial_grade(
    market: str = Query("ALL", description="KOSPI | KOSDAQ | ALL"),
    tier: str = Query("ALL", description="최상 | 상 | 중 | 하 | 최하 | ALL"),
    undervalued_only: bool = Query(False),
    code: str = Query(None, description="특정 종목코드로 단건 조회(다른 필터 무시)"),
    limit: int = Query(200),
):
    records, date_str = _load()
    if date_str is None:
        return {"results": [], "total": 0, "date": None, "tier_counts": {}}

    if code:
        matched = [r for r in records if r.get("code") == code]
        return {"results": matched, "total": len(matched), "date": date_str, "tier_counts": {}}

    tier_counts: dict[str, int] = {}
    for r in records:
        tier_counts[r["tier"]] = tier_counts.get(r["tier"], 0) + 1

    if market != "ALL":
        records = [r for r in records if r.get("market") == market]
    if tier != "ALL":
        records = [r for r in records if r.get("tier") == tier]
    if undervalued_only:
        records = [r for r in records if r.get("undervalued")]

    return {
        "results": records[:limit],
        "total": len(records),
        "date": date_str,
        "tier_counts": tier_counts,
    }


@router.get("/favorites")
def get_favorites():
    with sqlite3.connect(FAV_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT market, code FROM financial_grade_favorites ORDER BY added_at DESC"
        ).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.post("/favorites")
def add_favorite(item: FavoriteItem):
    with sqlite3.connect(FAV_DB_PATH) as conn:
        conn.execute(
            "INSERT OR IGNORE INTO financial_grade_favorites (market, code) VALUES (?, ?)",
            (item.market, item.code),
        )
    return {"ok": True}


@router.delete("/favorites/{market}/{code}")
def remove_favorite(market: str, code: str):
    with sqlite3.connect(FAV_DB_PATH) as conn:
        conn.execute(
            "DELETE FROM financial_grade_favorites WHERE market=? AND code=?",
            (market, code),
        )
    return {"ok": True}
