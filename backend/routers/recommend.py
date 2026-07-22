from fastapi import APIRouter, Query
from services.market_data import SECTOR_STOCKS
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import FinanceDataReader as fdr
import json, os, threading, requests, xml.etree.ElementTree as ET

router = APIRouter()

_cache_lock = threading.Lock()
_cache: dict = {}


# ── 날짜·캐시 유틸 ─────────────────────────────────────────────────────────

def _next_thursday() -> datetime:
    now = datetime.now()
    days = (3 - now.weekday()) % 7 or 7
    return (now + timedelta(days=days)).replace(hour=0, minute=0, second=0, microsecond=0)


def _cache_valid() -> bool:
    with _cache_lock:
        return bool(_cache.get("data")) and datetime.now() < _cache.get("valid_until", datetime.min)


# ── 데이터 수집 ────────────────────────────────────────────────────────────

def _get_listings() -> dict[str, dict]:
    """FDR StockListing → 현재가·거래량·등락률 (KOSPI + KOSDAQ)"""
    result: dict[str, dict] = {}
    for market in ["KOSPI", "KOSDAQ"]:
        try:
            df = fdr.StockListing(market)
            for _, row in df.iterrows():
                code = str(row.get("Code", "") or "").strip()
                if not code:
                    continue
                result[code] = {
                    "name":       str(row.get("Name", code)),
                    "market":     market,
                    "price":      float(row.get("Close", 0) or 0),
                    "volume":     int(row.get("Volume", 0) or 0),
                    "change_pct": float(row.get("ChagesRatio", 0) or 0),
                    "marcap":     int(row.get("Marcap", 0) or 0),
                }
        except Exception:
            pass
    return result


# ── 뉴스 수집 ──────────────────────────────────────────────────────────────

def _fetch_titles(name: str) -> list[str]:
    try:
        encoded = requests.utils.quote(f'"{name}"')
        url = f"https://news.google.com/rss/search?q={encoded}&hl=ko&gl=KR&ceid=KR:ko"
        res = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=5)
        root = ET.fromstring(res.content)
        return [
            item.findtext("title", "").rsplit(" - ", 1)[0].strip()
            for item in root.findall(".//item")[:3]
            if item.findtext("title", "")
        ]
    except Exception:
        return []


# ── Gemini 배치 감성 ───────────────────────────────────────────────────────

def _batch_sentiment(candidates: list[dict]) -> dict[str, str]:
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        return {c["ticker"]: "긍정" for c in candidates}

    lines = [
        f"{c['name']}({c['ticker']}): {' / '.join(c.get('news_titles', []))}"
        for c in candidates if c.get("news_titles")
    ]
    if not lines:
        return {c["ticker"]: "긍정" for c in candidates}

    prompt = (
        "다음 한국 주식 종목들의 뉴스를 보고 투자 전망을 긍정/부정으로만 판단하세요.\n"
        "JSON 배열로만 응답하세요. 다른 텍스트 없이 JSON만 출력하세요.\n"
        '형식: [{"t":"종목코드","s":"긍정"}, ...]\n\n'
        + "\n".join(lines)
    )
    try:
        from google import genai
        client = genai.Client(api_key=api_key)
        resp = client.models.generate_content(model="gemini-flash-latest", contents=prompt)
        raw = resp.text.strip()
        parsed = json.loads(raw[raw.find("["):raw.rfind("]") + 1])
        return {item["t"]: item.get("s", "부정") for item in parsed if "t" in item}
    except Exception:
        return {c["ticker"]: "긍정" for c in candidates}


# ── 핵심 추천 로직 ─────────────────────────────────────────────────────────

def _build_recommendations() -> list[dict]:
    # 1. KOSPI+KOSDAQ 현재가·거래량·등락률 (StockListing만 사용, ~1s)
    listings = _get_listings()
    if not listings:
        return []

    # 2. 섹터 역맵 (ticker → sectors)
    ticker_sectors: dict[str, list[str]] = {}
    for sector, tickers in SECTOR_STOCKS.get("KR", {}).items():
        for t in tickers:
            ticker_sectors.setdefault(str(t), []).append(sector)

    # 3. 섹터별 오늘 평균 등락률 (SECTOR_STOCKS 종목 기준)
    sector_changes: dict[str, list[float]] = {}
    for ticker, sectors in ticker_sectors.items():
        if ticker in listings:
            chg = listings[ticker]["change_pct"]
            for s in sectors:
                sector_changes.setdefault(s, []).append(chg)

    sector_avg: dict[str, float] = {
        s: sum(v) / len(v)
        for s, v in sector_changes.items() if v
    }

    rising_sectors = {s for s, avg in sector_avg.items() if avg > 0}

    # 4. 종목 필터 + 점수
    candidates = []
    for ticker, info in listings.items():
        if ticker not in ticker_sectors:
            continue

        price      = info["price"]
        volume     = info["volume"]
        change_pct = info["change_pct"]

        if price <= 0 or volume < 50_000:
            continue
        if change_pct < -5:  # 급락 종목 제외
            continue

        my_sectors = ticker_sectors.get(ticker, [])
        rising     = [s for s in my_sectors if s in rising_sectors]
        if not rising:
            continue

        avg_sect = sum(sector_avg.get(s, 0) for s in rising) / len(rising)

        # 점수: 섹터 상승 + 당일 모멘텀 + 거래량 보너스
        vol_bonus = 0.5 if volume >= 200_000 else 0.0
        score = (avg_sect * 2) + max(0, change_pct * 0.5) + vol_bonus

        candidates.append({
            "ticker":   ticker,
            "name":     info["name"],
            "market":   info["market"],
            "price":    int(price),
            "volume":   volume,
            "change":   round(change_pct, 2),
            "sectors":  rising,
            "sect_avg": round(avg_sect, 2),
            "marcap":   info["marcap"],
            "score":    round(score, 3),
        })

    candidates.sort(key=lambda x: x["score"], reverse=True)
    top50 = candidates[:50]

    # 5. 뉴스 병렬 수집
    def add_news(c: dict) -> dict:
        c["news_titles"] = _fetch_titles(c["name"])
        return c

    with ThreadPoolExecutor(max_workers=10) as ex:
        top50 = list(ex.map(add_news, top50))

    # 6. Gemini 배치 감성 (1회)
    sentiment_map = _batch_sentiment(top50)

    final = [c for c in top50 if sentiment_map.get(c["ticker"]) == "긍정"]
    final.sort(key=lambda x: x["score"], reverse=True)

    for i, c in enumerate(final[:20], 1):
        c["rank"]      = i
        c["sentiment"] = "긍정"
        c.pop("news_titles", None)

    return final[:20]


# ── 엔드포인트 ─────────────────────────────────────────────────────────────

@router.get("/kr")
def get_recommendations(refresh: bool = Query(False)):
    if not refresh and _cache_valid():
        with _cache_lock:
            return {
                "stocks":       _cache["data"],
                "generated_at": _cache["generated_at"],
                "valid_until":  _cache["valid_until"].strftime("%Y-%m-%d"),
                "cached":       True,
            }

    stocks = _build_recommendations()
    now = datetime.now()
    valid_until = _next_thursday()

    with _cache_lock:
        _cache["data"]         = stocks
        _cache["generated_at"] = now.strftime("%Y-%m-%d %H:%M")
        _cache["valid_until"]  = valid_until

    return {
        "stocks":       stocks,
        "generated_at": now.strftime("%Y-%m-%d %H:%M"),
        "valid_until":  valid_until.strftime("%Y-%m-%d"),
        "cached":       False,
    }
