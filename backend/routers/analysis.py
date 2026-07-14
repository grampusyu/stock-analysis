from fastapi import APIRouter, HTTPException, Query
from services.market_data import get_kr_fund_flow
import yfinance as yf
from pykrx import stock as krx
from datetime import datetime, timedelta
import pandas as pd

router = APIRouter()


@router.get("/fund-flow/{ticker}")
def fund_flow(ticker: str, days: int = Query(30)):
    try:
        df = get_kr_fund_flow(ticker, days)
        if df.empty:
            return {"data": [], "ticker": ticker}
        df.index = pd.to_datetime(df.index).strftime("%Y-%m-%d")
        return {"data": df.reset_index().to_dict(orient="records"), "ticker": ticker}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/kr-market-summary")
def kr_market_summary():
    try:
        result = {}
        for name, symbol in [("KOSPI", "^KS11"), ("KOSDAQ", "^KQ11")]:
            t = yf.Ticker(symbol)
            hist = t.history(period="5d")
            if len(hist) >= 2:
                close = float(hist["Close"].iloc[-1])
                prev_close = float(hist["Close"].iloc[-2])
                change_pct = (close - prev_close) / prev_close * 100
                result[name] = {"close": round(close, 2), "change_pct": round(change_pct, 2)}
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/top-movers/{market}")
def top_movers(market: str):
    try:
        if market.upper() == "KR":
            today = datetime.now().strftime("%Y%m%d")
            prev = (datetime.now() - timedelta(days=1)).strftime("%Y%m%d")
            df = krx.get_market_ohlcv_by_date(prev, today, "005930")
            # 시장 전체 데이터 대신 주요 종목 목록으로 대체
            tickers = {
                "삼성전자": "005930", "SK하이닉스": "000660", "LG에너지솔루션": "373220",
                "삼성바이오로직스": "207940", "현대차": "005380", "POSCO홀딩스": "005490",
                "카카오": "035720", "네이버": "035420", "기아": "000270", "셀트리온": "068270",
            }
            result = []
            end = datetime.now().strftime("%Y%m%d")
            start = (datetime.now() - timedelta(days=3)).strftime("%Y%m%d")
            for name, code in tickers.items():
                try:
                    df2 = krx.get_market_ohlcv_by_date(start, end, code)
                    if len(df2) >= 2:
                        chg = (df2["종가"].iloc[-1] - df2["종가"].iloc[-2]) / df2["종가"].iloc[-2] * 100
                        result.append({"ticker": code, "name": name, "change_pct": round(chg, 2), "price": int(df2["종가"].iloc[-1])})
                except Exception:
                    pass
            gainers = sorted(result, key=lambda x: x["change_pct"], reverse=True)[:5]
            losers = sorted(result, key=lambda x: x["change_pct"])[:5]
            return {"gainers": gainers, "losers": losers}
        else:
            tickers_info = [
                ("AAPL", "Apple"), ("MSFT", "Microsoft"), ("NVDA", "NVIDIA"),
                ("AMZN", "Amazon"), ("GOOGL", "Alphabet"), ("META", "Meta"),
                ("TSLA", "Tesla"), ("JPM", "JPMorgan"), ("V", "Visa"), ("UNH", "UnitedHealth"),
            ]
            result = []
            for ticker, name in tickers_info:
                try:
                    t = yf.Ticker(ticker)
                    hist = t.history(period="2d")
                    if len(hist) >= 2:
                        chg = (hist["Close"].iloc[-1] - hist["Close"].iloc[-2]) / hist["Close"].iloc[-2] * 100
                        result.append({"ticker": ticker, "name": name, "change_pct": round(chg, 2), "price": round(float(hist["Close"].iloc[-1]), 2)})
                except Exception:
                    pass
            gainers = sorted(result, key=lambda x: x["change_pct"], reverse=True)[:5]
            losers = sorted(result, key=lambda x: x["change_pct"])[:5]
            return {"gainers": gainers, "losers": losers}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
