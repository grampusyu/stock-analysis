from fastapi import APIRouter, Query
from pykrx import stock as krx
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
import time
import threading

router = APIRouter()

_cache: dict = {}
_cache_lock = threading.Lock()
CACHE_TTL = 1800  # 30분


def _recent_trading_date() -> str:
    d = datetime.now()
    if d.hour < 9:
        d -= timedelta(days=1)
    for _ in range(7):
        if d.weekday() < 5:
            return d.strftime("%Y%m%d")
        d -= timedelta(days=1)
    return d.strftime("%Y%m%d")


def _fetch_screen_data(market_type: str) -> list[dict]:
    # 최근 거래일부터 최대 5일 탐색
    base = datetime.now()
    if base.hour < 9:
        base -= timedelta(days=1)

    ohlcv = None
    actual_date = None
    for i in range(7):
        d = base - timedelta(days=i)
        if d.weekday() >= 5:
            continue
        date_str = d.strftime("%Y%m%d")
        try:
            df = krx.get_market_ohlcv_by_ticker(date_str, market=market_type)
            if not df.empty:
                ohlcv = df
                actual_date = date_str
                break
        except Exception:
            continue

    if ohlcv is None or ohlcv.empty:
        return []

    # OHLCV + 재무지표 병렬 조회
    fund = None
    try:
        with ThreadPoolExecutor(max_workers=1) as ex:
            f = ex.submit(krx.get_market_fundamental_by_ticker, actual_date, market=market_type)
            fund = f.result(timeout=30)
    except Exception:
        fund = None

    results = []
    for ticker, row in ohlcv.iterrows():
        try:
            name = krx.get_market_ticker_name(str(ticker))
        except Exception:
            name = str(ticker)

        price = int(row.get("종가", 0) or 0)
        if price <= 0:
            continue

        item = {
            "ticker": str(ticker),
            "name": name,
            "market_type": market_type,
            "price": price,
            "volume": int(row.get("거래량", 0) or 0),
            "change_pct": round(float(row.get("등락률", 0) or 0), 2),
            "per": None,
            "pbr": None,
        }

        if fund is not None and ticker in fund.index:
            frow = fund.loc[ticker]
            try:
                per = float(frow.get("PER", 0) or 0)
                item["per"] = round(per, 1) if 0 < per < 999 else None
            except Exception:
                pass
            try:
                pbr = float(frow.get("PBR", 0) or 0)
                item["pbr"] = round(pbr, 2) if pbr > 0 else None
            except Exception:
                pass

        results.append(item)

    return results


def _get_cached(market_type: str) -> list[dict]:
    key = f"screen_{market_type}"
    now = time.time()
    with _cache_lock:
        if key in _cache and now - _cache[key]["ts"] < CACHE_TTL:
            return _cache[key]["data"]

    data = _fetch_screen_data(market_type)
    with _cache_lock:
        _cache[key] = {"data": data, "ts": time.time()}
    return data


@router.get("/kr")
def screen_kr(
    market_type: str = Query("KOSPI", description="KOSPI | KOSDAQ | ALL"),
    change_min: float = Query(-30),
    change_max: float = Query(30),
    volume_min: int = Query(0),
    per_min: float = Query(None),
    per_max: float = Query(None),
    sort_by: str = Query("volume", description="volume | change_pct | change_pct_asc | per | price"),
    limit: int = Query(50),
):
    if market_type == "ALL":
        with ThreadPoolExecutor(max_workers=2) as ex:
            f1 = ex.submit(_get_cached, "KOSPI")
            f2 = ex.submit(_get_cached, "KOSDAQ")
            data = f1.result() + f2.result()
    else:
        data = _get_cached(market_type)

    filtered = []
    for item in data:
        if not (change_min <= item["change_pct"] <= change_max):
            continue
        if item["volume"] < volume_min:
            continue
        if per_min is not None and (item["per"] is None or item["per"] < per_min):
            continue
        if per_max is not None and (item["per"] is None or item["per"] > per_max):
            continue
        filtered.append(item)

    if sort_by == "change_pct":
        filtered.sort(key=lambda x: x["change_pct"], reverse=True)
    elif sort_by == "change_pct_asc":
        filtered.sort(key=lambda x: x["change_pct"])
    elif sort_by == "per":
        filtered.sort(key=lambda x: (x["per"] is None, x["per"] or 999))
    elif sort_by == "price":
        filtered.sort(key=lambda x: x["price"], reverse=True)
    else:
        filtered.sort(key=lambda x: x["volume"], reverse=True)

    return {
        "results": filtered[:limit],
        "total": len(filtered),
        "market_type": market_type,
    }
