import yfinance as yf
import pandas as pd
from pykrx import stock as krx
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor

# ── 섹터별 대표 종목 ────────────────────────────────────────────
SECTOR_STOCKS: dict[str, dict[str, list[str]]] = {
    "US": {
        "Technology":    ["AAPL", "MSFT", "NVDA", "META", "GOOGL", "AVGO", "ORCL", "AMD", "QCOM", "INTC", "AMAT", "MU"],
        "Healthcare":    ["UNH", "LLY", "JNJ", "ABBV", "MRK", "AMGN", "MDT", "BMY", "PFE", "GILD", "ISRG", "SYK"],
        "Financials":    ["JPM", "V", "MA", "BAC", "WFC", "GS", "BLK", "MS", "C", "AXP", "SCHW", "PGR"],
        "Energy":        ["XOM", "CVX", "COP", "EOG", "SLB", "MPC", "OXY", "VLO", "PSX", "HAL", "DVN", "BKR"],
        "Consumer Disc.":["AMZN", "TSLA", "HD", "MCD", "NKE", "LOW", "SBUX", "BKNG", "TJX", "CMG", "F", "GM"],
        "Industrials":   ["GE", "CAT", "RTX", "HON", "UNP", "BA", "LMT", "DE", "ETN", "EMR", "ITW", "PH"],
        "Materials":     ["LIN", "APD", "SHW", "ECL", "NEM", "FCX", "ALB", "DD", "DOW", "PPG", "NUE", "VMC"],
        "Utilities":     ["NEE", "SO", "DUK", "AEP", "D", "EXC", "XEL", "WEC", "ES", "ETR", "FE", "PPL"],
        "Real Estate":   ["AMT", "PLD", "EQIX", "WELL", "SPG", "DLR", "PSA", "O", "AVB", "EQR", "VTR", "BXP"],
    },
    "KR": {
        "반도체":      ["005930", "000660", "042700", "058470", "357780", "403870", "036930", "104830", "240810", "086390", "281820", "084370"],
        "ESS":         ["006400", "373220", "051910", "247540", "003670", "011790", "004490", "014680", "009830", "298040", "010120", "006260"],
        "2차전지":     ["006400", "373220", "096770", "247540", "005490", "051910", "003670", "011790", "004490", "086520", "298040", "066970"],
        "자동차":      ["005380", "000270", "012330", "011210", "204320", "073240", "018880", "064960", "161390", "003620", "023810", "005387"],
        "은행":        ["105560", "055550", "086790", "316140", "175330", "138930", "024110", "139130", "323410", "006220", "029780", "138040"],
        "화학":        ["051910", "011170", "006120", "004000", "010060", "003240", "006650", "014830", "011780", "285130", "005950", "037370"],
        "철강":        ["005490", "004020", "001230", "002220", "003030", "001080", "306200", "016380", "008260", "001430", "047050", "139990"],
        "조선":        ["009540", "042660", "010140", "267250", "075580", "002780", "443060", "100090", "100840", "071970", "014620", "077970"],
        "건설":        ["000720", "047040", "006360", "028050", "097230", "009415", "000210", "012630", "035890", "036200", "005960", "037440"],
        "운송":        ["003490", "011200", "000120", "086280", "020560", "028670", "000700", "003280", "298690", "002820", "129260", "020180"],
        "IT·소프트웨어":["035420", "035720", "018260", "012510", "064240", "099440", "053800", "039030", "047560", "402340", "042040", "377300"],
        "게임":        ["036570", "251270", "259960", "293490", "112040", "192080", "067160", "078340", "069080", "194480", "263750", "225570"],
        "미디어·엔터": ["352820", "041510", "122870", "035900", "034120", "079160", "053210", "035600", "134790", "032790", "403850", "241840"],
        "방산":        ["012450", "047810", "064350", "272210", "001570", "103140", "079550", "010820", "041520", "065450", "013810", "071970"],
        "증권":        ["016360", "006800", "039490", "071050", "030610", "078020", "001270", "003530", "001720", "030210", "001500", "018000"],
        "보험":        ["032830", "000810", "088350", "005830", "001450", "016610", "082640", "000400", "000370", "000540", "085620", "003690"],
        "음식료":      ["097950", "004370", "007310", "003230", "005180", "000080", "280360", "003920", "001680", "271560", "005300", "145990"],
        "소비재":      ["139480", "023530", "069960", "011810", "005440", "035810", "001800", "002310", "007070", "084680", "004170", "031430"],
        "화장품·뷰티": ["090430", "051900", "192820", "161890", "278470", "257720", "241710", "016100", "263920", "214370", "318160", "265740"],
        "리츠·부동산": ["395400", "088980", "348950", "293940", "357230", "357430", "330590", "365550", "088260", "448730", "451800", "329200"],
        "수소·친환경": ["005380", "012330", "336260", "271940", "298040", "010120", "288620", "382900", "277070", "120110", "298050", "089980"],
        "석유":        ["096770", "010950", "078930", "011170", "051910", "006650", "011780", "004000", "010060", "009830", "006120", "003240"],
        "로봇":        ["277810", "241560", "108490", "454910", "090360", "056190", "348210", "488900", "363260", "290650", "196300", "060280"],
        "건설기계":    ["267250", "241560", "267270", "017800", "000150", "002900", "064350", "082740", "017550", "023160", "267320", "382840"],
        "원자력·전력": ["015760", "034020", "051600", "082740", "298040", "010120", "267260", "009830", "036540", "105840", "083650", "036460"],
        "통신":        ["017670", "030200", "032640", "073490", "230240", "036630", "053800", "032500", "049080", "138080", "098460", "007340"],
        "항공·여행":   ["003490", "020560", "089590", "091810", "272450", "180640", "080160", "039130", "080420", "212560", "094850", "008770"],
        "반도체장비":  ["042700", "240810", "058470", "403870", "086390", "084370", "357780", "036930", "039030", "131970", "095340", "108490"],
        "변압기·전선": ["298040", "010120", "267260", "000500", "229640", "012200", "023160", "017040", "042370", "044490", "015590", "001440"],
        "제약·바이오": ["068270", "207940", "128940", "000100", "068760", "196170", "214150", "096530", "145020", "009290", "086900", "214370"],
    },
}


def get_us_stock_info(ticker: str) -> dict:
    t = yf.Ticker(ticker)
    info = t.info
    return {
        "ticker": ticker,
        "name": info.get("longName", ""),
        "sector": info.get("sector", ""),
        "market": "US",
        "price": info.get("currentPrice") or info.get("regularMarketPrice"),
        "change_pct": info.get("regularMarketChangePercent"),
        "market_cap": info.get("marketCap"),
        "per": info.get("trailingPE"),
        "pbr": info.get("priceToBook"),
        "volume": info.get("regularMarketVolume"),
    }


def get_kr_stock_info(ticker: str) -> dict:
    today = datetime.now().strftime("%Y%m%d")
    week_ago = (datetime.now() - timedelta(days=7)).strftime("%Y%m%d")
    df = krx.get_market_ohlcv_by_date(week_ago, today, ticker)
    if df.empty:
        return {}
    latest = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else latest
    close_col = "종가"
    vol_col = "거래량"
    change_pct = (latest[close_col] - prev[close_col]) / prev[close_col] * 100 if prev[close_col] else 0
    try:
        name = krx.get_market_ticker_name(ticker)
    except Exception:
        name = ticker
    return {
        "ticker": ticker,
        "name": name,
        "market": "KR",
        "price": int(latest[close_col]),
        "change_pct": round(change_pct, 2),
        "volume": int(latest[vol_col]),
        "open": int(latest["시가"]),
        "high": int(latest["고가"]),
        "low": int(latest["저가"]),
    }


_INTERVAL_PERIOD_US = {"weekly": "5y", "monthly": "max", "yearly": "max"}
_INTERVAL_PERIOD_KR_DAYS = {"daily": None, "weekly": 730, "monthly": 1825, "yearly": 3650}
_RESAMPLE_RULE = {"weekly": "W-FRI", "monthly": "ME", "yearly": "YE"}
_PERIOD_MAP_US = {"1m": "1mo", "3m": "3mo", "6m": "6mo"}


def get_ohlcv(ticker: str, market: str, period: str = "1y", interval: str = "daily") -> pd.DataFrame:
    agg = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}

    if market == "US":
        yf_interval = {"daily": "1d", "weekly": "1wk", "monthly": "1mo"}.get(interval, "1d")
        yf_period   = _INTERVAL_PERIOD_US.get(interval, _PERIOD_MAP_US.get(period, period))
        t = yf.Ticker(ticker)
        df = t.history(period=yf_period, interval=yf_interval)
        df = df.rename(columns={"Open": "open", "High": "high", "Low": "low", "Close": "close", "Volume": "volume"})
        df = df[["open", "high", "low", "close", "volume"]]
        if interval == "yearly":
            df.index = df.index.tz_localize(None) if df.index.tz else df.index
            df = df.resample("YE").agg(agg).dropna(subset=["close"])
        df.index = df.index.tz_localize(None).strftime("%Y-%m-%d") if df.index.tz else df.index.strftime("%Y-%m-%d")
        df.index.name = "date"
        return df

    else:
        period_map = {"1m": 30, "3m": 90, "6m": 180, "1y": 365, "3y": 1095}
        kr_days = _INTERVAL_PERIOD_KR_DAYS.get(interval) or period_map.get(period, 365)
        end   = datetime.now().strftime("%Y%m%d")
        start = (datetime.now() - timedelta(days=kr_days)).strftime("%Y%m%d")
        df = krx.get_market_ohlcv_by_date(start, end, ticker)
        df = df.rename(columns={"시가": "open", "고가": "high", "저가": "low", "종가": "close", "거래량": "volume"})
        df.index = pd.to_datetime(df.index)
        if interval in _RESAMPLE_RULE:
            df = df.resample(_RESAMPLE_RULE[interval]).agg(agg).dropna(subset=["close"])
        df.index = df.index.strftime("%Y-%m-%d")
        df.index.name = "date"
        return df[["open", "high", "low", "close", "volume"]]


def get_sector_stocks(market: str, sector: str) -> list[dict]:
    tickers = SECTOR_STOCKS.get(market.upper(), {}).get(sector, [])

    def fetch(ticker: str) -> dict:
        try:
            info = get_us_stock_info(ticker) if market.upper() == "US" else get_kr_stock_info(ticker)
            return {
                "ticker": ticker,
                "name": info.get("name", ticker),
                "price": info.get("price", 0) or 0,
                "change_pct": info.get("change_pct", 0) or 0,
            }
        except Exception:
            return {"ticker": ticker, "name": ticker, "price": 0, "change_pct": 0}

    with ThreadPoolExecutor(max_workers=6) as ex:
        return list(ex.map(fetch, tickers))


def get_kr_fund_flow(ticker: str, days: int = 30) -> pd.DataFrame:
    end = datetime.now().strftime("%Y%m%d")
    start = (datetime.now() - timedelta(days=days)).strftime("%Y%m%d")
    try:
        df = krx.get_market_trading_value_by_date(start, end, ticker)
        return df
    except Exception:
        return pd.DataFrame()


def get_sector_data(market: str = "KR", trend_period: str = "3m") -> list:
    if market == "KR":
        sector_etfs = {
            "반도체":      "091160.KS",
            "ESS":         None,
            "자동차":      "091180.KS",
            "2차전지":     "305720.KS",
            "은행":        "139220.KS",
            "화학":        "139230.KS",
            "건설기계":    "130680.KS",
            "운송":        "130660.KS",
            "철강":        "117700.KS",
            "원자력·전력": "451430.KS",
            "조선":        "138230.KS",
            "통신":        "266380.KS",
            "미디어·엔터": "228800.KS",
            "게임":        "269420.KS",
            "리츠·부동산": "329200.KS",
            "방산":        "325010.KS",
            "증권":        "139250.KS",
            "음식료":      "139260.KS",
            "소비재":      "266410.KS",
            "화장품·뷰티": "228790.KS",
            "건설":        "130690.KS",
            "보험":        "140570.KS",
            "수소·친환경": "381170.KS",
            "석유":        "117460.KS",
            "로봇":        "381180.KS",
            "IT·소프트웨어": None,
            "항공·여행":   None,
            "반도체장비":  None,
            "변압기·전선": None,
            "제약·바이오": None,
        }
    else:
        sector_etfs = {
            "Technology": "XLK", "Healthcare": "XLV", "Financials": "XLF",
            "Energy": "XLE", "Consumer Disc.": "XLY", "Industrials": "XLI",
            "Materials": "XLB", "Utilities": "XLU", "Real Estate": "XLRE",
        }

    def fetch_etf(etf: str, trend_period: str) -> tuple[float, float, list[float]] | None:
        """ETF로 trend_pct, daily_pct, sparkline 계산. 실패 시 None."""
        try:
            if trend_period == "1d":
                hist = yf.Ticker(etf).history(period="5d", interval="1d")
                if len(hist) < 2:
                    return None
                start_price = float(hist["Close"].iloc[-2])
                end_price   = float(hist["Close"].iloc[-1])
                trend_pct   = (end_price - start_price) / start_price * 100
                daily_pct   = trend_pct
                sparkline   = [round(float(v), 2) for v in hist["Close"].values]
            elif trend_period == "1w":
                hist = yf.Ticker(etf).history(period="5d", interval="1d")
                if len(hist) < 2:
                    return None
                start_price = float(hist["Close"].iloc[0])
                end_price   = float(hist["Close"].iloc[-1])
                prev_price  = float(hist["Close"].iloc[-2])
                trend_pct   = (end_price - start_price) / start_price * 100
                daily_pct   = (end_price - prev_price) / prev_price * 100
                sparkline   = [round(float(v), 2) for v in hist["Close"].values]
            else:
                yf_period = {"1m": "1mo", "3m": "3mo", "6m": "6mo", "1y": "1y"}.get(trend_period, "3mo")
                hist = yf.Ticker(etf).history(period=yf_period)
                if len(hist) < 2:
                    return None
                start_price = float(hist["Close"].iloc[0])
                end_price   = float(hist["Close"].iloc[-1])
                prev_price  = float(hist["Close"].iloc[-2])
                trend_pct   = (end_price - start_price) / start_price * 100
                daily_pct   = (end_price - prev_price) / prev_price * 100
                step = max(1, len(hist) // 30)
                sampled = hist["Close"].iloc[::step]
                if sampled.index[-1] != hist.index[-1]:
                    sampled = pd.concat([sampled, hist["Close"].iloc[[-1]]])
                sparkline = [round(float(v), 2) for v in sampled.values]
            return trend_pct, daily_pct, sparkline
        except Exception:
            return None

    def fetch_kr_fallback(sector: str, trend_period: str) -> tuple[float, float, list[float]] | None:
        """SECTOR_STOCKS 상위 3개 종목 pykrx 평균으로 수익률 계산."""
        tickers = SECTOR_STOCKS.get("KR", {}).get(sector, [])[:3]
        if not tickers:
            return None
        period_days = {"1d": 5, "1w": 10, "1m": 35, "3m": 100, "6m": 195, "1y": 380}.get(trend_period, 100)
        end_str   = datetime.now().strftime("%Y%m%d")
        start_str = (datetime.now() - timedelta(days=period_days)).strftime("%Y%m%d")
        trend_pcts, daily_pcts, sparkline = [], [], []
        for ticker in tickers:
            try:
                df = krx.get_market_ohlcv_by_date(start_str, end_str, ticker)
                if len(df) < 2:
                    continue
                closes = df["종가"].tolist()
                trend_pcts.append((closes[-1] - closes[0]) / closes[0] * 100)
                daily_pcts.append((closes[-1] - closes[-2]) / closes[-2] * 100)
                if not sparkline:
                    step = max(1, len(closes) // 30)
                    sparkline = [round(float(v), 2) for v in closes[::step]]
            except Exception:
                continue
        if not trend_pcts:
            return None
        return (
            sum(trend_pcts) / len(trend_pcts),
            sum(daily_pcts) / len(daily_pcts),
            sparkline,
        )

    def fetch_one(item: tuple[str, str | None]) -> dict | None:
        sector, etf = item
        result = None
        if etf:
            result = fetch_etf(etf, trend_period)
        if result is None and market == "KR":
            result = fetch_kr_fallback(sector, trend_period)
        if result is None:
            return None
        trend_pct, daily_pct, sparkline = result
        return {
            "sector":     sector,
            "etf":        etf,
            "change_pct": round(daily_pct, 2),
            "trend_pct":  round(trend_pct, 2),
            "trend":      "상승" if trend_pct >= 0 else "하락",
            "sparkline":  sparkline,
        }

    with ThreadPoolExecutor(max_workers=10) as ex:
        results = list(ex.map(fetch_one, sector_etfs.items()))
    return [r for r in results if r is not None]
