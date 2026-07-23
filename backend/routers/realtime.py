from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import asyncio
import json
import yfinance as yf
from pykrx import stock as krx
from datetime import datetime, timedelta

router = APIRouter()


def _fetch_price_kr(ticker: str) -> dict | None:
    """KR 종목 현재가: pykrx OHLCV (KRX 기준, 환율 오염 없음)"""
    try:
        today    = datetime.now().strftime("%Y%m%d")
        week_ago = (datetime.now() - timedelta(days=7)).strftime("%Y%m%d")
        df = krx.get_market_ohlcv_by_date(week_ago, today, ticker)
        if df is None or df.empty:
            return None
        latest = df.iloc[-1]
        prev   = df.iloc[-2] if len(df) > 1 else latest
        price  = int(latest["종가"])
        prev_close = int(prev["종가"])
        change_pct = ((price - prev_close) / prev_close * 100) if prev_close else 0
        return {
            "ticker": ticker,
            "market": "KR",
            "price": price,
            "change_pct": round(change_pct, 2),
            "volume": int(latest["거래량"]),
            "timestamp": datetime.now().isoformat(),
        }
    except Exception:
        return None


def _fetch_price_us(ticker: str) -> dict | None:
    """US 종목 현재가: yfinance fast_info"""
    try:
        fi = yf.Ticker(ticker.upper()).fast_info
        price = fi.last_price
        if not price:
            return None
        prev_close = fi.previous_close or price
        change_pct = ((price - prev_close) / prev_close * 100) if prev_close else 0
        return {
            "ticker": ticker,
            "market": "US",
            "price": round(float(price), 2),
            "change_pct": round(float(change_pct), 2),
            "volume": int(fi.last_volume) if fi.last_volume else None,
            "timestamp": datetime.now().isoformat(),
        }
    except Exception:
        return None


def _fetch_price(market: str, ticker: str) -> dict | None:
    if market.upper() == "KR":
        return _fetch_price_kr(ticker)
    return _fetch_price_us(ticker)


@router.websocket("/ws/price/{market}/{ticker}")
async def price_stream(websocket: WebSocket, market: str, ticker: str):
    await websocket.accept()
    try:
        while True:
            data = await asyncio.to_thread(_fetch_price, market, ticker)
            if data:
                await websocket.send_text(json.dumps(data))
            await asyncio.sleep(5)
    except (WebSocketDisconnect, Exception):
        pass


@router.websocket("/ws/fund-flow/{ticker}")
async def fund_flow_stream(websocket: WebSocket, ticker: str):
    from pykrx import stock as krx
    await websocket.accept()
    try:
        while True:
            today = datetime.now().strftime("%Y%m%d")
            week_ago = (datetime.now() - timedelta(days=7)).strftime("%Y%m%d")
            df = krx.get_market_trading_value_by_date(week_ago, today, ticker)
            if not df.empty:
                latest = df.iloc[-1]
                await websocket.send_text(json.dumps({
                    "ticker": ticker,
                    "date": str(df.index[-1]),
                    "individual": int(latest.get("개인", 0)),
                    "foreign": int(latest.get("외국인합계", 0)),
                    "institution": int(latest.get("기관합계", 0)),
                    "timestamp": datetime.now().isoformat(),
                }))
            await asyncio.sleep(60)
    except WebSocketDisconnect:
        pass
