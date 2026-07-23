"use client";
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { api, Market, OHLCVRecord, Period } from "@/lib/api";

const StockChart = dynamic(() => import("@/components/StockChart"), { ssr: false });

interface SectorStock {
  ticker: string;
  name: string;
  price: number;
  change_pct: number;
}

type TrendPeriod = "1d" | "1w" | "1m" | "3m" | "6m" | "1y";

function toChartPeriod(p: TrendPeriod): Period {
  if (p === "1d" || p === "1w") return "1m";
  return p as Period;
}

interface Props {
  market: Market;
  sector: string;
  period?: TrendPeriod;
  onClose: () => void;
}

export default function SectorStocksPanel({ market, sector, period = "1y", onClose }: Props) {
  const [stocks, setStocks] = useState<SectorStock[]>([]);
  const [charts, setCharts] = useState<Record<string, OHLCVRecord[]>>({});
  const [stocksLoading, setStocksLoading] = useState(false);
  const [chartsLoading, setChartsLoading] = useState(false);

  // 섹터 종목 목록
  useEffect(() => {
    let cancelled = false;
    setStocksLoading(true);
    setStocks([]);
    setCharts({});

    api.getSectorStocks(market, sector)
      .then((res) => {
        if (cancelled) return;
        const raw = Array.isArray(res.data) ? res.data : [];
        setStocks(
          raw.map((s) => ({
            ticker: String(s.ticker ?? ""),
            name: String(s.name ?? s.ticker ?? ""),
            price: Number(s.price ?? 0),
            change_pct: Number(s.change_pct ?? 0),
          }))
        );
      })
      .catch(() => { if (!cancelled) setStocks([]); })
      .finally(() => { if (!cancelled) setStocksLoading(false); });

    return () => { cancelled = true; };
  }, [market, sector]);

  // 종목별 차트 데이터
  useEffect(() => {
    if (stocks.length === 0) return;

    let cancelled = false;
    setChartsLoading(true);
    setCharts({});

    const chartPeriod = toChartPeriod(period);
    Promise.all(
      stocks.map((s) =>
        api.getChart(market, s.ticker, chartPeriod, "daily")
          .then((res) => ({ ticker: s.ticker, data: Array.isArray(res.data) ? res.data : [] }))
          .catch(() => ({ ticker: s.ticker, data: [] as OHLCVRecord[] }))
      )
    ).then((results) => {
      if (cancelled) return;
      const map: Record<string, OHLCVRecord[]> = {};
      results.forEach((r) => { map[r.ticker] = r.data; });
      setCharts(map);
    }).finally(() => {
      if (!cancelled) setChartsLoading(false);
    });

    return () => { cancelled = true; };
  }, [stocks, market, period]);

  return (
    <div className="card space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold text-base">
          {String(sector)} {market === "KR" ? "" : "Sector"} 종목
          {!stocksLoading && stocks.length > 0 && (
            <span className="muted text-xs font-normal ml-2">({stocks.length}개)</span>
          )}
        </h2>
        <button
          onClick={onClose}
          className="text-xs muted px-2 py-1 rounded-lg"
          style={{ border: "1px solid var(--card-border)" }}
        >
          닫기
        </button>
      </div>

      {stocksLoading && <p className="text-sm muted animate-pulse">종목 불러오는 중...</p>}
      {!stocksLoading && stocks.length === 0 && <p className="text-sm muted">섹터 종목 데이터가 없습니다.</p>}

      {/* 종목 카드 그리드 */}
      {!stocksLoading && stocks.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {stocks.map((s) => {
            const isUp = s.change_pct >= 0;
            const chartData = Array.isArray(charts[s.ticker]) ? charts[s.ticker] : [];

            return (
              <div
                key={s.ticker}
                className="rounded-xl p-3 space-y-2"
                style={{ background: "var(--card-alt, #1e293b)", border: "1px solid var(--card-border)" }}
              >
                {/* 종목 정보 */}
                <div className="flex justify-between items-start">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{s.name}</p>
                    <p className="text-xs muted">{s.ticker}</p>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <p className="text-sm font-bold font-mono">
                      {market === "KR"
                        ? s.price.toLocaleString() + "원"
                        : "$" + s.price.toLocaleString()}
                    </p>
                    <p className="text-xs font-medium" style={{ color: isUp ? "#10b981" : "#ef4444" }}>
                      {isUp ? "▲" : "▼"} {Math.abs(s.change_pct).toFixed(2)}%
                    </p>
                  </div>
                </div>

                {/* 미니 캔들차트 */}
                {chartsLoading ? (
                  <div className="flex items-center justify-center text-xs muted animate-pulse" style={{ height: 160 }}>
                    차트 로딩 중...
                  </div>
                ) : chartData.length > 0 ? (
                  <StockChart
                    data={chartData}
                    height={160}
                    market={market}
                    priceFormatter={market === "KR" ? (p) => Math.round(p).toLocaleString() : undefined}
                  />
                ) : (
                  <div className="flex items-center justify-center text-xs muted" style={{ height: 160 }}>
                    데이터 없음
                  </div>
                )}

                {/* 상세 분석 링크 */}
                <Link
                  href={`/stock?market=${market}&ticker=${s.ticker}`}
                  className="block text-center text-xs py-1.5 rounded-lg transition-colors"
                  style={{ background: "var(--card)", border: "1px solid var(--card-border)", color: "var(--muted)" }}
                >
                  상세 분석 →
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
