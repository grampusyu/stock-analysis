import os
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
from functools import lru_cache


# ──────────────────────────────────────────────
# 공통 유틸
# ──────────────────────────────────────────────

def _find_row(df: pd.DataFrame, keywords: list[str]) -> pd.Series | None:
    for kw in keywords:
        matches = [idx for idx in df.index if kw.lower() in str(idx).lower()]
        if matches:
            return df.loc[matches[0]]
    return None


def _row_to_yearly(row: pd.Series, divisor: float = 1.0) -> dict[str, float | None]:
    result = {}
    for col, val in row.items():
        try:
            year = str(col.year) if hasattr(col, "year") else str(col)[:4]
            result[year] = round(float(val) / divisor, 1) if pd.notna(val) else None
        except Exception:
            pass
    return dict(sorted(result.items()))


# ──────────────────────────────────────────────
# 미국 주식 (yfinance)
# ──────────────────────────────────────────────

def get_us_financials(ticker: str) -> dict:
    t = yf.Ticker(ticker.upper())
    info = t.info or {}

    fin = t.financials        # rows=items, cols=dates
    bal = t.balance_sheet
    cf  = t.cashflow

    def extract(df, keywords, divisor=1e9):
        if df is None or df.empty:
            return {}
        row = _find_row(df, keywords)
        return _row_to_yearly(row, divisor) if row is not None else {}

    income = {
        "revenue":          extract(fin, ["Total Revenue"]),
        "operating_income": extract(fin, ["Operating Income", "EBIT"]),
        "net_income":       extract(fin, ["Net Income"]),
    }
    balance = {
        "total_assets":      extract(bal, ["Total Assets"]),
        "total_liabilities": extract(bal, ["Total Liabilities"]),
        "equity":            extract(bal, ["Stockholders Equity", "Total Equity"]),
    }
    cashflow = {
        "operating":  extract(cf, ["Operating Cash Flow"]),
        "investing":  extract(cf, ["Investing Cash Flow"]),
        "financing":  extract(cf, ["Financing Cash Flow"]),
    }

    roe = info.get("returnOnEquity")
    roa = info.get("returnOnAssets")
    div = info.get("dividendYield")
    ratios = {
        "per":            round(info.get("trailingPE"), 1) if info.get("trailingPE") else None,
        "pbr":            round(info.get("priceToBook"), 1) if info.get("priceToBook") else None,
        "roe":            round(roe * 100, 1) if roe else None,
        "roa":            round(roa * 100, 1) if roa else None,
        "eps":            round(info.get("trailingEps"), 2) if info.get("trailingEps") else None,
        "dividend_yield": round(div * 100, 2) if div else None,
    }

    return {
        "income": income,
        "balance": balance,
        "cashflow": cashflow,
        "ratios": ratios,
        "currency": "USD",
        "unit": "십억 달러",
    }


# ──────────────────────────────────────────────
# 한국 주식 (yfinance — DART API 키 불필요)
# ──────────────────────────────────────────────

def _kr_yf_ticker(ticker: str) -> yf.Ticker:
    """6자리 종목코드로 yfinance Ticker 생성 (KOSPI .KS, KOSDAQ .KQ 자동 시도)"""
    for suffix in (".KS", ".KQ"):
        t = yf.Ticker(ticker + suffix)
        info = t.info or {}
        if info.get("quoteType") or info.get("longName"):
            return t
    return yf.Ticker(ticker + ".KS")


def get_kr_financials(ticker: str) -> dict:
    t = _kr_yf_ticker(ticker)
    info = t.info or {}

    fin = t.financials
    bal = t.balance_sheet
    cf  = t.cashflow

    # 억원 단위 (yfinance는 원화 그대로 반환)
    KRW_DIVISOR = 1e8

    def extract(df, keywords, divisor=KRW_DIVISOR):
        if df is None or df.empty:
            return {}
        row = _find_row(df, keywords)
        return _row_to_yearly(row, divisor) if row is not None else {}

    income = {
        "revenue":          extract(fin, ["Total Revenue"]),
        "operating_income": extract(fin, ["Operating Income", "EBIT"]),
        "net_income":       extract(fin, ["Net Income"]),
    }
    balance = {
        "total_assets":      extract(bal, ["Total Assets"]),
        "total_liabilities": extract(bal, ["Total Liabilities Net Minority Interest", "Total Liabilities"]),
        "equity":            extract(bal, ["Stockholders Equity", "Total Equity Gross Minority Interest"]),
    }
    cashflow = {
        "operating":  extract(cf, ["Operating Cash Flow"]),
        "investing":  extract(cf, ["Investing Cash Flow"]),
        "financing":  extract(cf, ["Financing Cash Flow"]),
    }

    roe = info.get("returnOnEquity")
    roa = info.get("returnOnAssets")
    # KR: dividendYield은 이미 % 단위 (0.54 = 0.54%), US와 다름
    div = info.get("dividendYield")
    # PER: trailingPE 없으면 forwardPE 사용
    per = info.get("trailingPE") or info.get("forwardPE")
    ratios: dict = {
        "per":            round(per, 1) if per else None,
        "pbr":            round(info.get("priceToBook"), 1) if info.get("priceToBook") else None,
        "roe":            round(roe * 100, 1) if roe else None,
        "roa":            round(roa * 100, 1) if roa else None,
        "eps":            round(info.get("trailingEps"), 0) if info.get("trailingEps") else None,
        "dividend_yield": round(div, 2) if div else None,  # KR은 이미 %
    }

    return {
        "income": income,
        "balance": balance,
        "cashflow": cashflow,
        "ratios": ratios,
        "currency": "KRW",
        "unit": "억원",
    }
