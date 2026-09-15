from fastapi import APIRouter, Query
from services.market_data import SECTOR_STOCKS
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import json, os, threading, requests, xml.etree.ElementTree as ET
from pykrx import stock as krx

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

def _load_fdr_csv() -> "pd.DataFrame | None":
    """FDR GitHub 캐시에서 최근 유효한 날짜의 CSV를 직접 로드 (최대 7일 이전까지 시도)"""
    import pandas as pd
    from datetime import date, timedelta

    base = "https://raw.githubusercontent.com/FinanceData/fdr_krx_data_cache/refs/heads/master/data/listing/krx"
    for delta in range(7):
        d = (date.today() - timedelta(days=delta)).strftime("%Y-%m-%d")
        try:
            df = pd.read_csv(
                f"{base}/{d}.csv",
                index_col=0,
                dtype={"Code": str, "Dept": str, "ChangeCode": str, "MarketId": str},
            )
            return df.reset_index(drop=True)
        except Exception:
            continue
    return None


def _get_listings() -> dict[str, dict]:
    """FDR GitHub 캐시 직접 로드 → 현재가·거래량·등락률 (KOSPI + KOSDAQ)"""
    market_id_map = {"STK": "KOSPI", "KSQ": "KOSDAQ"}
    result: dict[str, dict] = {}

    df = _load_fdr_csv()
    if df is None:
        return result

    for _, row in df.iterrows():
        code = str(row.get("Code", "") or "").strip()
        mkt_id = str(row.get("MarketId", "") or "")
        market = market_id_map.get(mkt_id)
        if not code or not market:
            continue
        result[code] = {
            "name":       str(row.get("Name", code)),
            "market":     market,
            "price":      float(row.get("Close", 0) or 0),
            "volume":     int(row.get("Volume", 0) or 0),
            "change_pct": float(row.get("ChagesRatio", 0) or 0),
            "marcap":     int(row.get("Marcap", 0) or 0),
        }
    return result


# ── 패턴 분석 (기술적 지표) ───────────────────────────────────────────────

def _fetch_ohlcv_kr(ticker: str, days: int = 90) -> tuple[list[float], list[float]]:
    """pykrx 개별 조회 → (종가 리스트, 거래량 리스트)"""
    end   = datetime.now().strftime("%Y%m%d")
    start = (datetime.now() - timedelta(days=days)).strftime("%Y%m%d")
    try:
        df = krx.get_market_ohlcv_by_date(start, end, ticker)
        if df is None or df.empty:
            return [], []
        return df["종가"].tolist(), df["거래량"].tolist()
    except Exception:
        return [], []


def _ema(data: list[float], period: int) -> list[float]:
    k = 2 / (period + 1)
    result = [data[0]]
    for v in data[1:]:
        result.append(v * k + result[-1] * (1 - k))
    return result


def _calc_pattern(ticker: str) -> dict:
    """기술적 지표 5종 합산 → 패턴 판정"""
    closes, volumes = _fetch_ohlcv_kr(ticker)
    if len(closes) < 26:
        return {"pattern": "분석불가", "pattern_score": 0, "pattern_signals": {}}

    score   = 0
    signals = {}

    # 1. MA5 / MA20 교차 (±2, 최근 크로스 ±1 보너스)
    ma5  = sum(closes[-5:]) / 5
    ma20 = sum(closes[-20:]) / 20
    if ma5 > ma20:
        score += 2
        signals["MA"] = "골든크로스"
        if len(closes) >= 25:
            prev_ma5  = sum(closes[-10:-5]) / 5
            prev_ma20 = sum(closes[-25:-5]) / 20
            if prev_ma5 <= prev_ma20:
                score += 1   # 최근 발생 보너스
    else:
        score -= 2
        signals["MA"] = "데드크로스"
        if len(closes) >= 25:
            prev_ma5  = sum(closes[-10:-5]) / 5
            prev_ma20 = sum(closes[-25:-5]) / 20
            if prev_ma5 >= prev_ma20:
                score -= 1

    # 2. RSI 14일 (±2)
    gains, losses = [], []
    for i in range(1, 15):
        d = closes[-i] - closes[-i - 1]
        (gains if d > 0 else losses).append(abs(d))
    avg_gain = sum(gains) / 14 if gains else 0
    avg_loss = sum(losses) / 14 if losses else 1e-9
    rsi = 100 - (100 / (1 + avg_gain / avg_loss))
    if rsi >= 55:
        score += 2
        signals["RSI"] = f"{rsi:.0f} 강세"
    elif rsi <= 45:
        score -= 2
        signals["RSI"] = f"{rsi:.0f} 약세"
    else:
        signals["RSI"] = f"{rsi:.0f} 중립"

    # 3. MACD 12/26/9 (±2)
    ema12   = _ema(closes, 12)
    ema26   = _ema(closes, 26)
    macd    = [e12 - e26 for e12, e26 in zip(ema12, ema26)]
    sig_line = _ema(macd, 9)
    if macd[-1] > sig_line[-1]:
        score += 2
        signals["MACD"] = "매수신호"
    else:
        score -= 2
        signals["MACD"] = "매도신호"

    # 4. 볼린저밴드 20일 위치 (±1)
    bb_mean = sum(closes[-20:]) / 20
    bb_std  = (sum((c - bb_mean) ** 2 for c in closes[-20:]) / 20) ** 0.5
    band_range = (4 * bb_std) or 1
    bb_pos = (closes[-1] - (bb_mean - 2 * bb_std)) / band_range  # 0~1
    if bb_pos > 0.8:
        score -= 1
        signals["BB"] = "과매수"
    elif bb_pos < 0.2:
        score += 1
        signals["BB"] = "과매도"
    elif bb_pos > 0.5:
        score += 1
        signals["BB"] = "중상단"
    else:
        score -= 1
        signals["BB"] = "중하단"

    # 5. 거래량 추세 5일 vs 20일 (±1)
    if len(volumes) >= 20:
        vol5  = sum(volumes[-5:]) / 5
        vol20 = sum(volumes[-20:]) / 20
        if vol20 > 0:
            if vol5 > vol20 * 1.2:
                score += 1
                signals["VOL"] = "증가"
            elif vol5 < vol20 * 0.8:
                score -= 1
                signals["VOL"] = "감소"
            else:
                signals["VOL"] = "보통"

    pattern = "상승" if score >= 3 else ("하락" if score <= -3 else "중립")
    return {"pattern": pattern, "pattern_score": score, "pattern_signals": signals}


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
        resp = client.models.generate_content(model="gemini-3.6-flash", contents=prompt)
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

    # 상승 섹터가 없으면(하락장·장외) 상대적으로 덜 하락한 상위 절반 섹터로 폴백
    if not rising_sectors and sector_avg:
        sorted_avgs = sorted(sector_avg.values(), reverse=True)
        median = sorted_avgs[len(sorted_avgs) // 2]
        rising_sectors = {s for s, avg in sector_avg.items() if avg >= median}

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

    # 섹터 필터 후에도 후보가 없으면 섹터 조건 제거하고 재수집
    if not candidates:
        for ticker, info in listings.items():
            price      = info["price"]
            volume     = info["volume"]
            change_pct = info["change_pct"]
            if price <= 0 or volume < 50_000 or change_pct < -5:
                continue
            my_sectors = ticker_sectors.get(ticker, [])
            avg_sect = sum(sector_avg.get(s, 0) for s in my_sectors) / len(my_sectors) if my_sectors else 0
            vol_bonus = 0.5 if volume >= 200_000 else 0.0
            score = (avg_sect * 2) + max(0, change_pct * 0.5) + vol_bonus
            candidates.append({
                "ticker":   ticker,
                "name":     info["name"],
                "market":   info["market"],
                "price":    int(price),
                "volume":   volume,
                "change":   round(change_pct, 2),
                "sectors":  my_sectors[:3],
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

    # 7. 패턴 분석 (기술적 지표 5종, 최종 20개 병렬)
    def add_pattern(c: dict) -> dict:
        result = _calc_pattern(c["ticker"])
        c.update(result)
        return c

    with ThreadPoolExecutor(max_workers=5) as ex:
        final20 = list(ex.map(add_pattern, final[:20]))

    return final20


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
