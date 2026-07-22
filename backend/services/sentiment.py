"""Gemini API를 이용한 뉴스 감성 분석 서비스."""
import os
import json
import time
import threading

_cache: dict[str, tuple[float, list]] = {}
_cache_lock = threading.Lock()
_CACHE_TTL = 1800  # 30분


def analyze_news_sentiment(articles: list[dict], stock_name: str) -> list[dict]:
    """뉴스 기사 목록을 받아 각 기사에 sentiment/reason 필드를 추가해 반환.

    sentiment: "긍정" | "중립" | "부정"
    """
    if not articles:
        return []

    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        return [{"sentiment": "중립", "reason": "GEMINI_API_KEY 미설정", **a} for a in articles]

    targets = articles[:10]
    titles = [a["title"] for a in targets]

    prompt = f"""다음은 '{stock_name}' 관련 뉴스 제목들입니다.
각 제목을 주식 투자자 관점에서 긍정/중립/부정으로 분류하세요.

뉴스 제목 ({len(titles)}개):
{chr(10).join(f'{i}. {t}' for i, t in enumerate(titles))}

아래 JSON 배열 형식으로만 응답하세요. 다른 텍스트 없이 JSON만 출력하세요:
[{{"index": 0, "sentiment": "긍정", "reason": "이유 한 문장"}}, ...]

sentiment는 반드시 "긍정", "중립", "부정" 중 하나여야 합니다."""

    try:
        from google import genai

        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model="gemini-flash-latest",
            contents=prompt,
        )
        raw = response.text.strip()
        start = raw.find("[")
        end = raw.rfind("]") + 1
        parsed: list[dict] = json.loads(raw[start:end])

        result = []
        parsed_map = {item["index"]: item for item in parsed if "index" in item}
        for i, article in enumerate(targets):
            info = parsed_map.get(i, {})
            sentiment = info.get("sentiment", "중립")
            if sentiment not in ("긍정", "중립", "부정"):
                sentiment = "중립"
            result.append({
                **article,
                "sentiment": sentiment,
                "reason": info.get("reason", ""),
            })
        return result

    except Exception as e:
        return [{**a, "sentiment": "중립", "reason": f"분석 오류: {e}"} for a in targets]


def get_sentiment_cached(market: str, ticker: str, stock_name: str, articles: list[dict]) -> list[dict]:
    key = f"sentiment:{market}:{ticker}"
    now = time.time()
    with _cache_lock:
        if key in _cache:
            ts, data = _cache[key]
            if now - ts < _CACHE_TTL:
                return data

    result = analyze_news_sentiment(articles, stock_name)
    with _cache_lock:
        _cache[key] = (time.time(), result)
    return result
