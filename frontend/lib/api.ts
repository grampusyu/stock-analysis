const isServer = typeof window === "undefined";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL
  ? process.env.NEXT_PUBLIC_API_URL + "/api"
  : isServer
    ? (process.env.BACKEND_URL || "http://localhost:8000") + "/api"
    : "/api";
export const WS_BASE = process.env.NEXT_PUBLIC_WS_URL ?? "";

export const NGROK_HEADER: HeadersInit = { "ngrok-skip-browser-warning": "true" };

const BASE = API_BASE;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store", headers: NGROK_HEADER });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...NGROK_HEADER },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export type Market = "US" | "KR";
export type Period = "1m" | "3m" | "6m" | "1y" | "3y";

export interface StockInfo {
  ticker: string;
  name: string;
  market: Market;
  price: number;
  change_pct: number;
  market_cap?: number;
  per?: number;
  pbr?: number;
  volume: number;
  sector?: string;
}

export interface OHLCVRecord {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IntradayHourStat {
  hour: string;
  avg_pct: number;
  std_pct: number;
  n: number;
}

export interface IntradayDistribution {
  hours: string[];
  bins: string[];
  grid: number[][];
  max_count: number;
}

export interface IntradayDailySeries {
  date: string;
  values: (number | null)[];
}

export interface IntradayPattern {
  hours: IntradayHourStat[];
  days_used: number;
  distribution: IntradayDistribution;
  daily_series: IntradayDailySeries[];
}

export interface TechnicalSummary {
  price: number;
  ma5: number;
  ma20: number;
  ma60: number;
  rsi: number;
  macd: number;
  bb_upper: number;
  bb_lower: number;
  signals: { indicator: string; signal: string; desc: string }[];
}

export interface PredictionResult {
  predictions: { date: string; price: number }[];
  trend: string;
  model?: string;
}

export interface CompanyOverview {
  ticker: string;
  name: string;
  sector: string;
  description: string | null;
  outlook: string | null;
  error: string | null;
}

export interface FinancialData {
  income: {
    revenue: Record<string, number | null>;
    operating_income: Record<string, number | null>;
    net_income: Record<string, number | null>;
  };
  balance: {
    total_assets: Record<string, number | null>;
    total_liabilities: Record<string, number | null>;
    equity: Record<string, number | null>;
  };
  cashflow: {
    operating: Record<string, number | null>;
    investing: Record<string, number | null>;
    financing: Record<string, number | null>;
  };
  ratios: {
    per?: number | null;
    pbr?: number | null;
    roe?: number | null;
    roa?: number | null;
    eps?: number | null;
    dividend_yield?: number | null;
  };
  currency: string;
  unit: string;
}

export interface NewsArticle {
  title: string;
  url: string;
  source: string;
  published: string;
}

export interface PatternScanRow {
  code: string;
  name: string;
  market: string;
  score: number;
  mom_20: number;
  vol_20: number;
  foreign_ratio: number;
  inst_ratio: number;
  foreign_trend: number;
  inst_trend: number;
  last_close: number;
  avg_trading_value: number;
}

export type FinancialTier = "최상" | "상" | "중" | "하" | "최하";
export type UpsideLabel = "높음" | "보통" | "낮음";

export interface FinancialGradeRow {
  code: string;
  name: string;
  market: string;
  induty_code: string;
  sector: string;
  score: number;
  tier: FinancialTier;
  roe: number | null;
  op_margin: number | null;
  debt_ratio: number | null;
  revenue_growth: number | null;
  op_income_growth: number | null;
  per: number | null;
  pbr: number | null;
  sector_avg_per: number | null;
  sector_avg_pbr: number | null;
  undervalued: boolean;
  sparkline: number[] | null;
  mom_5: number | null;
  mom_20: number | null;
  short_term_score: number | null;
  short_term_label: UpsideLabel | null;
  mid_term_score: number | null;
  mid_term_label: UpsideLabel | null;
  long_term_score: number | null;
  long_term_label: UpsideLabel | null;
}

export interface ShapeSearchResult {
  code: string;
  name: string;
  market: string;
  distance: number;
  preview: number[];
}

export interface Holding {
  ticker: string;
  market: Market;
  quantity: number;
  avg_price: number;
  current_price?: number;
  profit_pct?: number;
  total_value?: number;
  name?: string;
}

export const api = {
  getStockInfo: (market: Market, ticker: string) =>
    get<StockInfo>(`/stocks/info/${market}/${ticker}`),

  getChart: (market: Market, ticker: string, period: Period = "1y", interval = "daily") =>
    get<{ data: OHLCVRecord[] }>(`/stocks/chart/${market}/${ticker}?period=${period}&interval=${interval}`),

  getSectorStocks: (market: Market, sector: string) =>
    get<{ data: { ticker: string; name: string; price: number; change_pct: number }[] }>(
      `/stocks/sector-stocks/${market}/${encodeURIComponent(sector)}`
    ),

  getTechnical: (market: Market, ticker: string) =>
    get<TechnicalSummary>(`/stocks/technical/${market}/${ticker}`),

  getIntradayPattern: (market: Market, ticker: string) =>
    get<IntradayPattern>(`/stocks/intraday-pattern/${market}/${ticker}`),

  getPredict: (market: Market, ticker: string, days = 7) =>
    get<PredictionResult>(`/stocks/predict/${market}/${ticker}?days=${days}`),

  getSectors: (market: Market, period: "1d" | "1w" | "1m" | "3m" | "6m" | "1y" = "3m") =>
    get<{ data: unknown[] }>(`/stocks/sectors/${market}?period=${period}`),

  getPortfolio: () =>
    get<{ holdings: Holding[] }>("/portfolio/"),

  addHolding: (h: Omit<Holding, "current_price" | "profit_pct" | "total_value" | "name">) =>
    fetch(`${BASE}/portfolio/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...NGROK_HEADER },
      body: JSON.stringify(h),
    }).then((r) => r.json()),

  removeHolding: (market: Market, ticker: string) =>
    fetch(`${BASE}/portfolio/remove/${market}/${ticker}`, { method: "DELETE", headers: NGROK_HEADER }).then((r) => r.json()),

  getMarketSummary: () =>
    get<{ KOSPI: { close: number; change_pct: number }; KOSDAQ: { close: number; change_pct: number } }>(
      "/analysis/kr-market-summary"
    ),

  getFundFlow: (ticker: string, days = 30) =>
    get<{ data: unknown[] }>(`/analysis/fund-flow/${ticker}?days=${days}`),

  getTopMovers: (market: Market) =>
    get<{ gainers: unknown[]; losers: unknown[] }>(`/analysis/top-movers/${market}`),

  getFinancials: (market: Market, ticker: string) =>
    get<FinancialData>(`/financials/${market}/${ticker}`),

  getOverview: (market: Market, ticker: string) =>
    get<CompanyOverview>(`/stocks/overview/${market}/${ticker}`),

  searchStocks: (market: Market, q: string) =>
    get<{ results: { ticker: string; name: string }[] }>(`/stocks/search/${market}?q=${encodeURIComponent(q)}`),

  getStockNews: (market: Market, ticker: string) =>
    get<{ articles: NewsArticle[]; ticker: string; market: string }>(`/news/stock/${market}/${ticker}`),

  getMarketNews: (market: Market) =>
    get<{ articles: NewsArticle[]; market: string }>(`/news/market?market=${market}`),

  getPatternScan: (market: "ALL" | "KOSPI" | "KOSDAQ" = "ALL", limit = 50) =>
    get<{ results: PatternScanRow[]; total: number; date: string | null }>(
      `/pattern-scan?market=${market}&limit=${limit}`
    ),

  searchShape: (points: number[], window: 20 | 60 | 120, market: "ALL" | "KOSPI" | "KOSDAQ", limit = 20) =>
    post<{ results: ShapeSearchResult[]; total: number }>("/shape-search", { points, window, market, limit }),

  getFinancialGrade: (opts: {
    market?: "ALL" | "KOSPI" | "KOSDAQ";
    tier?: "ALL" | FinancialTier;
    sector?: string;
    undervaluedOnly?: boolean;
    limit?: number;
  } = {}) => {
    const { market = "ALL", tier = "ALL", sector = "ALL", undervaluedOnly = false, limit = 200 } = opts;
    return get<{
      results: FinancialGradeRow[];
      total: number;
      date: string | null;
      tier_counts: Record<string, number>;
      sector_counts: Record<string, number>;
    }>(
      `/financial-grade?market=${market}&tier=${encodeURIComponent(tier)}&sector=${encodeURIComponent(sector)}` +
        `&undervalued_only=${undervaluedOnly}&limit=${limit}`
    );
  },

  getFinancialGradeByCode: (code: string) =>
    get<{ results: FinancialGradeRow[]; total: number }>(`/financial-grade?code=${code}`),

  getFinancialGradeFavorites: () =>
    get<{ items: { market: string; code: string }[] }>("/financial-grade/favorites"),

  addFinancialGradeFavorite: (market: string, code: string) =>
    fetch(`${BASE}/financial-grade/favorites`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...NGROK_HEADER },
      body: JSON.stringify({ market, code }),
    }).then((r) => r.json()),

  removeFinancialGradeFavorite: (market: string, code: string) =>
    fetch(`${BASE}/financial-grade/favorites/${market}/${code}`, {
      method: "DELETE",
      headers: NGROK_HEADER,
    }).then((r) => r.json()),
};
