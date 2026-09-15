import re

import requests
import yfinance as yf
import numpy as np
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


def get_intraday_pattern(ticker: str, market: str) -> dict:
    """최근 60거래일의 5분봉을 10분 단위로 묶어 '하루 중 시간대별 평균 가격 변동'
    패턴을 계산한다.

    각 거래일의 장 시작가(그날 첫 봉의 시가) 대비 매 10분 구간 종가의 변화율을 구하고,
    같은 시간대(예: 11:00)끼리 모아 평균·표준편차를 낸다. 매매 신호가 아니라
    "이 종목은 보통 장 초반에 오르는 편인지" 정도를 보여주는 탐색용 참고 지표다.
    (yfinance는 10분봉을 직접 지원하지 않아 5분봉을 받아 2개씩 묶는다)
    """
    if market == "KR":
        # 코스피(.KS)/코스닥(.KQ) 중 어느 쪽인지 미리 알 수 없고, yfinance가 틀린
        # 접미사에도 가끔 소량의 부실한(며칠치뿐인) 데이터를 돌려줘서 "비어있지 않으면
        # 그대로 사용"은 위험함(예: 코스닥 종목인데 .KS로도 조회돼 그쪽을 잘못 채택) —
        # 두 접미사 다 조회해서 행 수가 더 많은(더 완전한) 쪽을 채택한다.
        df_ks = yf.Ticker(f"{ticker}.KS").history(period="60d", interval="5m")
        df_kq = yf.Ticker(f"{ticker}.KQ").history(period="60d", interval="5m")
        df = df_ks if len(df_ks) >= len(df_kq) else df_kq
    else:
        df = yf.Ticker(ticker).history(period="60d", interval="5m")
    if df.empty:
        return {"hours": [], "days_used": 0}

    df = df[["Open", "Close"]].dropna()
    df["date"] = df.index.date
    # 분을 10분 단위로 내림(예: 09:05→09:00, 09:15→09:10)해 같은 10분 구간으로 묶는다
    bucket_ts = df.index.floor("10min")
    df["hour"] = bucket_ts.strftime("%H:%M")
    df = df.groupby(["date", "hour"], sort=False).agg(Open=("Open", "first"), Close=("Close", "last")).reset_index()

    rows = []
    for date, day_df in df.groupby("date"):
        day_open = day_df["Open"].iloc[0]
        if not day_open:
            continue
        for hour, close in zip(day_df["hour"], day_df["Close"]):
            rows.append({"date": date, "hour": hour, "change_pct": (close - day_open) / day_open * 100})

    if not rows:
        return {"hours": [], "days_used": 0}

    rows_df = pd.DataFrame(rows)
    agg = rows_df.groupby("hour")["change_pct"].agg(["mean", "std", "count"]).reset_index()
    agg = agg.sort_values("hour")
    hours = [
        {
            "hour": r["hour"],
            "avg_pct": round(r["mean"], 3),
            "std_pct": round(r["std"], 3) if pd.notna(r["std"]) else 0.0,
            "n": int(r["count"]),
        }
        for _, r in agg.iterrows()
    ]

    # 시간대별 누적분포(히트맵용) — 0.5%p 고정 폭 구간. 극단 이상치가 구간 수를
    # 과도하게 늘리지 않도록 1~99 퍼센타일 범위만 0.5 단위로 반올림해서 사용한다.
    BIN_STEP = 0.5
    lo_raw, hi_raw = rows_df["change_pct"].quantile([0.01, 0.99])
    if lo_raw == hi_raw:
        lo_raw, hi_raw = lo_raw - BIN_STEP, hi_raw + BIN_STEP
    lo = np.floor(lo_raw / BIN_STEP) * BIN_STEP
    hi = np.ceil(hi_raw / BIN_STEP) * BIN_STEP
    n_bins = max(1, round((hi - lo) / BIN_STEP))
    edges = lo + np.arange(n_bins + 1) * BIN_STEP
    rows_df["bin"] = pd.cut(rows_df["change_pct"], bins=edges, include_lowest=True, labels=False)
    rows_df["bin"] = rows_df["bin"].clip(0, n_bins - 1)

    hour_order = sorted(rows_df["hour"].unique())
    bin_labels = [f"{edges[i]:.1f}~{edges[i+1]:.1f}%" for i in range(n_bins)]
    counts = rows_df.groupby(["hour", "bin"]).size().unstack(fill_value=0)
    counts = counts.reindex(index=hour_order, columns=range(n_bins), fill_value=0)
    grid = counts.values.tolist()  # grid[hour_idx][bin_idx]

    distribution = {
        "hours": hour_order,
        "bins": bin_labels,
        "grid": grid,
        "max_count": int(counts.values.max()) if counts.size else 0,
    }

    # 하루하루의 실제 궤적을 그대로 겹쳐 그리기 위한 일자별 시계열(스파게티 차트용).
    # 날짜별로 시간대(hour_order) 순서에 맞춰 변화율을 나열하고, 그 시간에 값이
    # 없는 날은 null로 채운다(요일별 조기 폐장 등으로 누락될 수 있음).
    pivot = rows_df.pivot_table(index="date", columns="hour", values="change_pct", aggfunc="last")
    pivot = pivot.reindex(columns=hour_order)
    daily_series = [
        {
            "date": str(date),
            "values": [round(v, 3) if pd.notna(v) else None for v in row],
        }
        for date, row in pivot.iterrows()
    ]

    return {
        "hours": hours,
        "days_used": int(df["date"].nunique()),
        "distribution": distribution,
        "daily_series": daily_series,
    }


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


_NAVER_FRGN_ROW_RE = re.compile(
    r'<tr onMouseOver="mouseOver\(this\)"[^>]*>(.*?)</tr>', re.S
)
_NAVER_FRGN_FIELD_RE = re.compile(r'class="tah[^"]*">\s*([^<]+?)\s*</span>')


def get_kr_fund_flow(ticker: str, days: int = 30) -> pd.DataFrame:
    """개인/외국인/기관 순매매 수량(주) 조회.

    KRX_ID/KRX_PW 환경변수가 설정되어 있으면 pykrx(투자자별 매매동향, 수량 기준,
    3주체 전부 포함)를 우선 사용한다. 로그인 세션이 없거나 실패하면 네이버 금융
    스크래핑(거래량(주) 기준, 외국인·기관만)으로 폴백한다 — 단, 2026-09-11 네이버
    금융이 클라이언트 렌더링 SPA로 전면 개편되어 현재는 이 폴백이 항상 빈 결과를
    반환한다(향후 사이트가 복구되거나 API를 다시 찾으면 자동으로 살아난다). 두
    경로 모두 단위가 주(株)로 일치한다(예전엔 pykrx만 금액 기준이라 폴백과 단위가
    어긋났었음).
    """
    end = datetime.now().strftime("%Y%m%d")
    start = (datetime.now() - timedelta(days=days)).strftime("%Y%m%d")
    try:
        df = krx.get_market_trading_volume_by_date(start, end, ticker)
        if not df.empty:
            return df
    except Exception:
        pass

    return _get_kr_fund_flow_naver_fallback(ticker, days)


def _get_kr_fund_flow_naver_fallback(ticker: str, days: int = 30) -> pd.DataFrame:
    cutoff = datetime.now() - timedelta(days=days)
    rows: list[dict] = []
    seen_dates: set[str] = set()

    for page in range(1, 7):  # 페이지당 약 20거래일 → 최대 6페이지(~4개월)면 충분
        try:
            resp = requests.get(
                "https://finance.naver.com/item/frgn.naver",
                params={"code": ticker, "page": page},
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=5,
            )
            resp.encoding = "euc-kr"
            html = resp.text
        except Exception:
            break

        trs = _NAVER_FRGN_ROW_RE.findall(html)
        if not trs:
            break

        page_has_new = False
        oldest_date = None
        for tr in trs:
            fields = _NAVER_FRGN_FIELD_RE.findall(tr)
            if len(fields) < 7:
                continue
            date_str = fields[0].strip()
            if not re.match(r"^\d{4}\.\d{2}\.\d{2}$", date_str):
                continue
            oldest_date = date_str
            if date_str in seen_dates:
                continue
            seen_dates.add(date_str)
            try:
                inst = float(fields[5].replace(",", ""))
                frgn = float(fields[6].replace(",", ""))
            except ValueError:
                continue
            page_has_new = True
            rows.append({"날짜": date_str.replace(".", "-"), "기관합계": inst, "외국인합계": frgn})

        if not page_has_new:
            break
        if oldest_date and datetime.strptime(oldest_date, "%Y.%m.%d") < cutoff:
            break

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    df["날짜"] = pd.to_datetime(df["날짜"])
    df = df[df["날짜"] >= cutoff].sort_values("날짜").set_index("날짜")
    return df


def _safe(v) -> float | None:
    import math
    if v is None:
        return None
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except Exception:
        return None


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
            def _spark(series) -> list[float]:
                vals = [_safe(v) for v in series.values]
                return [v for v in vals if v is not None]

            if trend_period == "1d":
                hist = yf.Ticker(etf).history(period="5d", interval="1d")
                if len(hist) < 2:
                    return None
                start_price = _safe(hist["Close"].iloc[-2])
                end_price   = _safe(hist["Close"].iloc[-1])
                if not start_price or not end_price:
                    return None
                trend_pct   = (end_price - start_price) / start_price * 100
                daily_pct   = trend_pct
                sparkline   = _spark(hist["Close"])
            elif trend_period == "1w":
                hist = yf.Ticker(etf).history(period="5d", interval="1d")
                if len(hist) < 2:
                    return None
                start_price = _safe(hist["Close"].iloc[0])
                end_price   = _safe(hist["Close"].iloc[-1])
                prev_price  = _safe(hist["Close"].iloc[-2])
                if not start_price or not end_price or not prev_price:
                    return None
                trend_pct   = (end_price - start_price) / start_price * 100
                daily_pct   = (end_price - prev_price) / prev_price * 100
                sparkline   = _spark(hist["Close"])
            else:
                yf_period = {"1m": "1mo", "3m": "3mo", "6m": "6mo", "1y": "1y"}.get(trend_period, "3mo")
                hist = yf.Ticker(etf).history(period=yf_period)
                if len(hist) < 2:
                    return None
                start_price = _safe(hist["Close"].iloc[0])
                end_price   = _safe(hist["Close"].iloc[-1])
                prev_price  = _safe(hist["Close"].iloc[-2])
                if not start_price or not end_price or not prev_price:
                    return None
                trend_pct   = (end_price - start_price) / start_price * 100
                daily_pct   = (end_price - prev_price) / prev_price * 100
                step = max(1, len(hist) // 30)
                sampled = hist["Close"].iloc[::step]
                if sampled.index[-1] != hist.index[-1]:
                    sampled = pd.concat([sampled, hist["Close"].iloc[[-1]]])
                sparkline = _spark(sampled)
            t = _safe(trend_pct)
            d = _safe(daily_pct)
            if t is None or d is None:
                return None
            return t, d, sparkline
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
                t = _safe((closes[-1] - closes[0]) / closes[0] * 100)
                d = _safe((closes[-1] - closes[-2]) / closes[-2] * 100)
                if t is None or d is None:
                    continue
                trend_pcts.append(t)
                daily_pcts.append(d)
                if not sparkline:
                    step = max(1, len(closes) // 30)
                    sparkline = [v for v in [_safe(x) for x in closes[::step]] if v is not None]
            except Exception:
                continue
        if not trend_pcts:
            return None
        t_avg = _safe(sum(trend_pcts) / len(trend_pcts))
        d_avg = _safe(sum(daily_pcts) / len(daily_pcts))
        if t_avg is None or d_avg is None:
            return None
        return t_avg, d_avg, sparkline

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
