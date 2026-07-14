const BASE = "http://localhost:8000/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
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

  getPredict: (market: Market, ticker: string, days = 7) =>
    get<PredictionResult>(`/stocks/predict/${market}/${ticker}?days=${days}`),

  getSectors: (market: Market, period: "1d" | "1w" | "1m" | "3m" | "6m" | "1y" = "3m") =>
    get<{ data: unknown[] }>(`/stocks/sectors/${market}?period=${period}`),

  getPortfolio: () =>
    get<{ holdings: Holding[] }>("/portfolio/"),

  addHolding: (h: Omit<Holding, "current_price" | "profit_pct" | "total_value" | "name">) =>
    fetch(`${BASE}/portfolio/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(h),
    }).then((r) => r.json()),

  removeHolding: (market: Market, ticker: string) =>
    fetch(`${BASE}/portfolio/remove/${market}/${ticker}`, { method: "DELETE" }).then((r) => r.json()),

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
};
