from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from services.market_data import get_us_stock_info, get_kr_stock_info, get_ohlcv, get_sector_data, get_sector_stocks
from services.ml_predictor import get_technical_summary, predict_price
from pykrx import stock as krx
from datetime import datetime
import asyncio
import threading
import json
import yfinance as yf

router = APIRouter()

_kr_ticker_map: dict[str, str] = {}       # SECTOR_STOCKS 기반 캐시 (~240개)
_full_kr_ticker_map: dict[str, str] = {}  # FinanceDataReader 기반 전종목 캐시
_full_map_ready = False
_full_map_building = False
_full_map_lock = threading.Lock()


def _build_full_kr_ticker_map():
    global _full_kr_ticker_map, _full_map_ready, _full_map_building
    try:
        import FinanceDataReader as fdr
        kospi = fdr.StockListing("KOSPI")[["Code", "Name"]].dropna()
        kosdaq = fdr.StockListing("KOSDAQ")[["Code", "Name"]].dropna()
        import pandas as pd
        combined = pd.concat([kospi, kosdaq]).drop_duplicates(subset=["Code"])
        result = {row["Code"]: row["Name"] for _, row in combined.iterrows() if row["Code"] and row["Name"]}
        _full_kr_ticker_map = result
        _full_map_ready = True
        print(f"[FDR] 전종목 맵 완성: {len(result)}개")
    except Exception as e:
        print(f"[FDR] 전종목 맵 빌드 실패: {e}")
    finally:
        _full_map_building = False


def start_full_kr_map_build():
    """서버 시작 시 FinanceDataReader로 전종목 맵을 백그라운드에서 빌드."""
    global _full_map_building
    with _full_map_lock:
        if _full_map_building or _full_map_ready:
            return
        _full_map_building = True
    threading.Thread(target=_build_full_kr_ticker_map, daemon=True).start()


def _get_kr_ticker_map() -> dict[str, str]:
    """KR ticker→name 맵. KRX 인증+전종목 맵 준비 시 전종목, 아니면 SECTOR_STOCKS 기반 반환."""
    global _kr_ticker_map
    if _full_map_ready:
        return _full_kr_ticker_map
    if _kr_ticker_map:
        return _kr_ticker_map
    from services.market_data import SECTOR_STOCKS
    all_tickers = list({t for tickers in SECTOR_STOCKS.get("KR", {}).values() for t in tickers})
    result: dict[str, str] = {}
    for t in all_tickers:
        try:
            name = krx.get_market_ticker_name(t)
            if name:
                result[t] = name
        except Exception:
            pass
    _kr_ticker_map = result
    return result


@router.get("/search-status")
def search_status():
    return {
        "full_map_ready": _full_map_ready,
        "full_map_building": _full_map_building,
        "total_tickers": len(_full_kr_ticker_map) if _full_map_ready else None,
        "sector_tickers": len(_kr_ticker_map),
    }


@router.get("/search/{market}")
def search_stocks(market: str, q: str = Query("")):
    q = q.strip()
    if not q:
        return {"results": []}
    try:
        if market.upper() == "KR":
            ticker_map = _get_kr_ticker_map()
            ql = q.lower()
            results = []
            for ticker, name in ticker_map.items():
                if ticker == q or ql in name.lower():
                    results.append({"ticker": ticker, "name": name})
            return {"results": results[:10]}
        else:
            t = yf.Ticker(q.upper())
            info = t.info
            name = info.get("longName") or info.get("shortName", "")
            if name:
                return {"results": [{"ticker": q.upper(), "name": name}]}
            return {"results": []}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/info/{market}/{ticker}")
def stock_info(market: str, ticker: str):
    try:
        if market.upper() == "US":
            return get_us_stock_info(ticker.upper())
        else:
            return get_kr_stock_info(ticker)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/chart/{market}/{ticker}")
def stock_chart(market: str, ticker: str, period: str = Query("1y"), interval: str = Query("daily")):
    try:
        t = ticker.upper() if market.upper() == "US" else ticker
        df = get_ohlcv(t, market.upper(), period, interval)
        records = df.reset_index().to_dict(orient="records")
        return {"data": records, "ticker": ticker, "market": market}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/technical/{market}/{ticker}")
def technical_analysis(market: str, ticker: str):
    try:
        df = get_ohlcv(ticker.upper() if market.upper() == "US" else ticker, market.upper(), "1y")
        summary = get_technical_summary(df)
        return summary
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/predict/{market}/{ticker}")
def price_prediction(market: str, ticker: str, days: int = Query(7)):
    try:
        df = get_ohlcv(ticker.upper() if market.upper() == "US" else ticker, market.upper(), "3y")
        result = predict_price(df, days_ahead=days, ticker=ticker, market=market.upper())
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/predict-stream/{market}/{ticker}")
async def predict_stream(market: str, ticker: str, days: int = Query(7)):
    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def _send(obj: dict):
        loop.call_soon_threadsafe(queue.put_nowait, json.dumps(obj, ensure_ascii=False))

    def run():
        try:
            _send({"type": "status", "message": "데이터 조회 중..."})
            t = ticker.upper() if market.upper() == "US" else ticker
            df = get_ohlcv(t, market.upper(), "3y")

            _send({"type": "status", "message": "모델 준비 중..."})

            def progress_cb(epoch: int, total: int, val_loss):
                _send({
                    "type": "progress",
                    "epoch": epoch,
                    "total": total,
                    "val_loss": round(float(val_loss), 6) if val_loss is not None else None,
                })

            result = predict_price(df, days_ahead=days, ticker=ticker,
                                   market=market.upper(), progress_cb=progress_cb)
            _send({"type": "result", "data": result})
        except Exception as e:
            _send({"type": "error", "message": str(e)})
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    threading.Thread(target=run, daemon=True).start()

    async def event_gen():
        while True:
            item = await queue.get()
            if item is None:
                break
            yield f"data: {item}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/sectors/{market}")
def sector_performance(market: str, period: str = Query("3m")):
    try:
        return {"data": get_sector_data(market.upper(), trend_period=period)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/sector-stocks/{market}/{sector}")
def sector_stocks_list(market: str, sector: str):
    try:
        return {"data": get_sector_stocks(market, sector)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/overview/{market}/{ticker}")
def company_overview(market: str, ticker: str):
    try:
        from services.company_overview import get_company_overview
        # 회사명 조회
        if market.upper() == "KR":
            info = get_kr_stock_info(ticker)
            name = info.get("name", ticker)
        else:
            info = get_us_stock_info(ticker.upper())
            name = info.get("name", ticker)
        return get_company_overview(market, ticker, name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
