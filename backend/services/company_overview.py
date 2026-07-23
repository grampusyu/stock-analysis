"""Gemini API를 이용한 기업 개요·전망 생성 서비스."""
import os
import json
import time
import threading
from typing import Optional

_cache: dict[str, tuple[float, dict]] = {}
_cache_lock = threading.Lock()
_CACHE_TTL = 3600  # 1시간


def _find_kr_sector(ticker: str) -> Optional[str]:
    from services.market_data import SECTOR_STOCKS
    for sector, tickers in SECTOR_STOCKS.get("KR", {}).items():
        if ticker in tickers:
            return sector
    return None


def _find_us_sector(ticker: str) -> Optional[str]:
    from services.market_data import SECTOR_STOCKS
    for sector, tickers in SECTOR_STOCKS.get("US", {}).items():
        if ticker.upper() in tickers:
            return sector
    return None


def get_company_overview(market: str, ticker: str, company_name: str) -> dict:
    cache_key = f"{market}:{ticker}"
    now = time.time()
    with _cache_lock:
        if cache_key in _cache:
            ts, data = _cache[cache_key]
            if now - ts < _CACHE_TTL:
                return data

    market = market.upper()

    # 섹터 조회
    if market == "KR":
        sector = _find_kr_sector(ticker) or "기타"
    else:
        sector = _find_us_sector(ticker)
        if not sector:
            try:
                import yfinance as yf
                info = yf.Ticker(ticker).info
                sector = info.get("sector") or info.get("industry") or "Other"
            except Exception:
                sector = "Other"

    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        result = {
            "ticker": ticker,
            "name": company_name,
            "sector": sector,
            "description": None,
            "outlook": None,
            "error": "GEMINI_API_KEY 환경변수가 설정되지 않았습니다.",
        }
        with _cache_lock:
            _cache[cache_key] = result
        return result

    prompt = f"""다음 기업에 대해 한국어로 간결하게 설명해주세요.

기업명: {company_name}
종목코드: {ticker}
마켓: {market}
섹터: {sector}

아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만 출력하세요:
{{
  "description": "회사의 핵심 사업과 주요 제품/서비스를 설명하는 2-3문장",
  "outlook": "해당 산업 트렌드와 기업의 성장 가능성, 주요 리스크를 포함한 앞으로의 전망 2-3문장"
}}"""

    from google import genai
    client = genai.Client(api_key=api_key)

    result = None
    for attempt in range(3):
        try:
            response = client.models.generate_content(
                model="gemini-2.0-flash",
                contents=prompt,
            )
            raw = response.text.strip()
            start = raw.find("{")
            end = raw.rfind("}") + 1
            parsed = json.loads(raw[start:end])

            result = {
                "ticker": ticker,
                "name": company_name,
                "sector": sector,
                "description": parsed.get("description", ""),
                "outlook": parsed.get("outlook", ""),
                "error": None,
            }
            break
        except Exception as e:
            err = str(e)
            if ("429" in err or "resource_exhausted" in err.lower()) and attempt < 2:
                time.sleep(5 * (attempt + 1))
                continue
            is_rate_limit = "429" in err or "resource_exhausted" in err.lower()
            result = {
                "ticker": ticker,
                "name": company_name,
                "sector": sector,
                "description": None,
                "outlook": None,
                "error": "API 사용 한도 초과 — 잠시 후 다시 시도해주세요." if is_rate_limit else err,
            }
            break

    if result is None:
        result = {
            "ticker": ticker, "name": company_name, "sector": sector,
            "description": None, "outlook": None,
            "error": "API 사용 한도 초과 — 잠시 후 다시 시도해주세요.",
        }

    # 성공 결과만 캐시 (에러는 캐시 안 함 → 재시도 가능)
    if result["error"] is None:
        with _cache_lock:
            _cache[cache_key] = (time.time(), result)
    return result
