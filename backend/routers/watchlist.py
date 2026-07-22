from fastapi import APIRouter
from pydantic import BaseModel
import sqlite3
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from services.market_data import get_kr_stock_info, get_us_stock_info

router = APIRouter()
DB_PATH = Path(__file__).parent.parent / "portfolio.db"


def _init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS watchlist (
                market TEXT NOT NULL,
                ticker TEXT NOT NULL,
                added_at TEXT DEFAULT (datetime('now')),
                PRIMARY KEY (market, ticker)
            )
        """)

_init_db()


class WatchItem(BaseModel):
    market: str
    ticker: str


def _fetch_price(item: dict) -> dict:
    try:
        if item["market"] == "KR":
            info = get_kr_stock_info(item["ticker"])
        else:
            info = get_us_stock_info(item["ticker"])
        return {**item, **info}
    except Exception:
        return item


@router.get("")
def get_watchlist():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT market, ticker, added_at FROM watchlist ORDER BY added_at DESC"
        ).fetchall()
    items = [dict(r) for r in rows]
    if not items:
        return {"items": []}
    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(_fetch_price, items))
    return {"items": results}


@router.post("")
def add_to_watchlist(item: WatchItem):
    ticker = item.ticker.upper() if item.market.upper() == "US" else item.ticker
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT OR IGNORE INTO watchlist (market, ticker) VALUES (?, ?)",
            (item.market.upper(), ticker),
        )
    return {"ok": True}


@router.delete("/{market}/{ticker}")
def remove_from_watchlist(market: str, ticker: str):
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "DELETE FROM watchlist WHERE market=? AND ticker=?",
            (market.upper(), ticker),
        )
    return {"ok": True}
