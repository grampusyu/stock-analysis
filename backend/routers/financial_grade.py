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

from services.market_data import SECTOR_STOCKS

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


def _build_theme_map() -> dict[str, str]:
    """/sectors 페이지의 30개 테마(SECTOR_STOCKS["KR"])를 종목코드 -> 테마명으로 뒤집는다.

    한 종목이 여러 테마에 동시 소속된 경우(예: LG화학은 화학/석유/2차전지/ESS 4곳)
    딕셔너리 정의 순서상 먼저 나오는 테마를 채택한다(setdefault). 테마는 12종목씩만
    수동 선별된 목록이라 전종목을 커버하지 못하므로, 여기 없는 종목은 KSIC 업종명으로
    폴백한다(아래 _load() 참고).
    """
    theme_map: dict[str, str] = {}
    for theme, tickers in SECTOR_STOCKS.get("KR", {}).items():
        for ticker in tickers:
            theme_map.setdefault(ticker, theme)
    return theme_map


TICKER_THEME_MAP = _build_theme_map()
THEME_NAMES = set(SECTOR_STOCKS.get("KR", {}).keys())

# DART induty_code는 회사가 등록 시점에 신고한 값이 그대로 남아있어, 이후 주력 사업을
# 바꾼 회사는 실제 업종과 다르게 표시되는 경우가 있다(예: 파미셀은 등록 코드가 여전히
# "262 전자 부품 제조업"이지만 현재는 줄기세포 치료제 회사). 사용자가 발견한 오류를
# 종목코드 단위로 여기에 수동 보정한다.
SECTOR_OVERRIDES: dict[str, str] = {
    "005690": "의료용 물질 및 의약품 제조업",  # 파미셀: 등록 코드(262 전자 부품 제조업)가 사업 전환 전 기준으로 남아있음
}


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

    df = pd.read_csv(path, encoding="utf-8-sig", dtype={"code": str, "induty_code": str})
    if "sparkline" in df.columns:
        df["sparkline"] = df["sparkline"].apply(lambda v: json.loads(v) if isinstance(v, str) else None)
    df["tier"] = pd.Categorical(df["tier"], categories=TIER_ORDER, ordered=True)
    # induty_code(3~5자리 KSIC 세분류)는 490여 개로 필터 드롭다운에 쓰기엔 너무 세분화되어
    # 있어서, 앞 2자리(KSIC 중분류/division, 전체 77개 중 실제로는 약 60개만 등장)로
    # 묶어 "업종" 필터의 기본값으로 쓴다.
    division_code = df["induty_code"].fillna("").astype(str).str.slice(0, 2)
    df["sector"] = division_code.map(SECTOR_MAP).fillna("기타")
    # /sectors 페이지와 동일한 테마(반도체/2차전지/게임 등)에 속한 종목은 그 테마명으로
    # 덮어써서 사용자가 익숙한 테마 기준으로도 필터링할 수 있게 한다(테마가 없는 종목은
    # 위에서 계산한 KSIC 업종명 유지).
    df["sector"] = df["code"].map(TICKER_THEME_MAP).fillna(df["sector"])
    df["sector"] = df["code"].map(SECTOR_OVERRIDES).fillna(df["sector"])
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
    sector: str = Query("ALL", description="업종명(KSIC) | ALL"),
    undervalued_only: bool = Query(False),
    code: str = Query(None, description="특정 종목코드로 단건 조회(다른 필터 무시)"),
    limit: int = Query(200),
):
    empty_sectors = {"theme_sector_counts": {}, "industry_sector_counts": {}}
    records, date_str = _load()
    if date_str is None:
        return {"results": [], "total": 0, "date": None, "tier_counts": {}, **empty_sectors}

    if code:
        matched = [r for r in records if r.get("code") == code]
        return {"results": matched, "total": len(matched), "date": date_str, "tier_counts": {}, **empty_sectors}

    tier_counts: dict[str, int] = {}
    theme_sector_counts: dict[str, int] = {}
    industry_sector_counts: dict[str, int] = {}
    for r in records:
        tier_counts[r["tier"]] = tier_counts.get(r["tier"], 0) + 1
        counts = theme_sector_counts if r["sector"] in THEME_NAMES else industry_sector_counts
        counts[r["sector"]] = counts.get(r["sector"], 0) + 1

    if market != "ALL":
        records = [r for r in records if r.get("market") == market]
    if sector != "ALL":
        records = [r for r in records if r.get("sector") == sector]
    if tier != "ALL":
        records = [r for r in records if r.get("tier") == tier]
    if undervalued_only:
        records = [r for r in records if r.get("undervalued")]

    return {
        "results": records[:limit],
        "total": len(records),
        "date": date_str,
        "tier_counts": tier_counts,
        "theme_sector_counts": dict(sorted(theme_sector_counts.items(), key=lambda kv: kv[1], reverse=True)),
        "industry_sector_counts": dict(sorted(industry_sector_counts.items(), key=lambda kv: kv[1], reverse=True)),
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
