import sqlite3
import os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from services.market_data import get_us_stock_info, get_kr_stock_info

router = APIRouter()

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "portfolio.db")


def _get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db():
    with _get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS holdings (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker    TEXT    NOT NULL,
                market    TEXT    NOT NULL,
                quantity  REAL    NOT NULL,
                avg_price REAL    NOT NULL,
                UNIQUE(ticker, market)
            )
        """)


_init_db()


class Holding(BaseModel):
    ticker: str
    market: str  # "US" or "KR"
    quantity: float
    avg_price: float


@router.get("/")
def get_portfolio():
    with _get_conn() as conn:
        rows = conn.execute("SELECT * FROM holdings").fetchall()

    result = []
    for row in rows:
        h = dict(row)
        try:
            if h["market"] == "US":
                info = get_us_stock_info(h["ticker"])
            else:
                info = get_kr_stock_info(h["ticker"])
            current_price = info.get("price", h["avg_price"])
            profit_pct = (current_price - h["avg_price"]) / h["avg_price"] * 100
            result.append({
                **h,
                "current_price": current_price,
                "profit_pct": round(profit_pct, 2),
                "total_value": round(current_price * h["quantity"], 2),
                "name": info.get("name", h["ticker"]),
            })
        except Exception:
            result.append({**h, "current_price": h["avg_price"], "profit_pct": 0})
    return {"holdings": result}


@router.post("/add")
def add_holding(holding: Holding):
    market = holding.market.upper()
    with _get_conn() as conn:
        existing = conn.execute(
            "SELECT * FROM holdings WHERE ticker=? AND market=?",
            (holding.ticker, market),
        ).fetchone()

        if existing:
            e = dict(existing)
            total_qty = e["quantity"] + holding.quantity
            new_avg = (e["avg_price"] * e["quantity"] + holding.avg_price * holding.quantity) / total_qty
            conn.execute(
                "UPDATE holdings SET quantity=?, avg_price=? WHERE ticker=? AND market=?",
                (total_qty, new_avg, holding.ticker, market),
            )
            updated = dict(conn.execute(
                "SELECT * FROM holdings WHERE ticker=? AND market=?",
                (holding.ticker, market),
            ).fetchone())
            return {"message": "포지션 추가됨", "holding": updated}

        conn.execute(
            "INSERT INTO holdings (ticker, market, quantity, avg_price) VALUES (?,?,?,?)",
            (holding.ticker, market, holding.quantity, holding.avg_price),
        )
        new_row = dict(conn.execute(
            "SELECT * FROM holdings WHERE ticker=? AND market=?",
            (holding.ticker, market),
        ).fetchone())
        return {"message": "종목 추가됨", "holding": new_row}


@router.delete("/remove/{market}/{ticker}")
def remove_holding(market: str, ticker: str):
    with _get_conn() as conn:
        result = conn.execute(
            "DELETE FROM holdings WHERE ticker=? AND market=?",
            (ticker, market.upper()),
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="종목을 찾을 수 없습니다")
    return {"message": f"{ticker} 제거됨"}
