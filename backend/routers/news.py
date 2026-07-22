from fastapi import APIRouter, Query
import requests
import xml.etree.ElementTree as ET
from datetime import datetime
import time

router = APIRouter()

_cache: dict[str, tuple[float, list]] = {}
_CACHE_TTL = 600  # 10분


def _cached(key: str) -> list | None:
    if key in _cache:
        ts, data = _cache[key]
        if time.time() - ts < _CACHE_TTL:
            return data
    return None


def _store(key: str, data: list):
    _cache[key] = (time.time(), data)



def _get_kr_company_name(ticker: str) -> str:
    try:
        from pykrx import stock as krx
        name = krx.get_market_ticker_name(ticker)
        return name if name else ticker
    except Exception:
        return ticker


def _fetch_google_news(query: str, lang: str = "ko", country: str = "KR") -> list[dict]:
    try:
        encoded = requests.utils.quote(query)
        url = f"https://news.google.com/rss/search?q={encoded}&hl={lang}&gl={country}&ceid={country}:{lang}"
        res = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=8)
        root = ET.fromstring(res.content)
        articles = []
        for item in root.findall(".//item")[:20]:
            raw_title = item.findtext("title", "")
            title = raw_title.rsplit(" - ", 1)[0].strip()
            link = item.findtext("link", "")
            source_el = item.find("source")
            source = source_el.text if source_el is not None else ""
            pub = item.findtext("pubDate", "")
            try:
                dt = datetime.strptime(pub, "%a, %d %b %Y %H:%M:%S %Z")
                pub_fmt = dt.strftime("%Y-%m-%d %H:%M")
            except Exception:
                pub_fmt = pub[:16] if pub else ""
            if title and link:
                articles.append({"title": title, "url": link, "source": source, "published": pub_fmt})
        return articles
    except Exception:
        return []


@router.get("/stock/{market}/{ticker}")
def stock_news(market: str, ticker: str):
    key = f"stock:{market}:{ticker}"
    cached = _cached(key)
    if cached is not None:
        return {"articles": cached, "ticker": ticker, "market": market}

    if market.upper() == "KR":
        name = _get_kr_company_name(ticker)
        articles = _fetch_google_news(f'"{name}"', lang="ko", country="KR")
    else:
        articles = _fetch_google_news(f"{ticker.upper()} stock", lang="en", country="US")

    _store(key, articles)
    return {"articles": articles, "ticker": ticker, "market": market}


@router.get("/sentiment/{market}/{ticker}")
def news_sentiment(market: str, ticker: str):
    """뉴스 조회 + Gemini 감성 분석. 캐시 30분."""
    from services.sentiment import get_sentiment_cached

    # 뉴스 먼저 조회 (기존 캐시 활용)
    key = f"stock:{market}:{ticker}"
    articles = _cached(key)
    if articles is None:
        if market.upper() == "KR":
            name = _get_kr_company_name(ticker)
            articles = _fetch_google_news(f'"{name}"', lang="ko", country="KR")
        else:
            articles = _fetch_google_news(f"{ticker.upper()} stock", lang="en", country="US")
        _store(key, articles)

    if market.upper() == "KR":
        stock_name = _get_kr_company_name(ticker)
    else:
        stock_name = ticker.upper()

    analyzed = get_sentiment_cached(market, ticker, stock_name, articles)

    pos = sum(1 for a in analyzed if a["sentiment"] == "긍정")
    neg = sum(1 for a in analyzed if a["sentiment"] == "부정")
    neu = sum(1 for a in analyzed if a["sentiment"] == "중립")
    total = len(analyzed)
    overall = "긍정" if pos > neg and pos >= total * 0.4 else "부정" if neg > pos and neg >= total * 0.4 else "중립"

    return {
        "ticker": ticker,
        "market": market,
        "stock_name": stock_name,
        "overall": overall,
        "counts": {"긍정": pos, "중립": neu, "부정": neg},
        "articles": analyzed,
    }


@router.get("/market")
def market_news(market: str = Query("KR")):
    key = f"market:{market}"
    cached = _cached(key)
    if cached is not None:
        return {"articles": cached, "market": market}

    if market.upper() == "KR":
        articles = _fetch_google_news("코스피 코스닥 증시 주식", lang="ko", country="KR")
    else:
        articles = _fetch_google_news("stock market S&P 500 nasdaq", lang="en", country="US")

    _store(key, articles)
    return {"articles": articles, "market": market}
