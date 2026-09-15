"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import StockChart from "@/components/StockChart";
import { api, OHLCVRecord, PatternScanRow } from "@/lib/api";

type MarketFilter = "ALL" | "KOSPI" | "KOSDAQ";

export default function PatternScanPage() {
  const [market, setMarket] = useState<MarketFilter>("ALL");
  const [results, setResults] = useState<PatternScanRow[]>([]);
  const [total, setTotal] = useState(0);
  const [date, setDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [chartTarget, setChartTarget] = useState<PatternScanRow | null>(null);
  const [chartData, setChartData] = useState<OHLCVRecord[]>([]);
  const [chartLoading, setChartLoading] = useState(false);

  const openChart = async (row: PatternScanRow) => {
    setChartTarget(row);
    setChartLoading(true);
    setChartData([]);
    try {
      const res = await api.getChart("KR", row.code, "3m");
      setChartData(res.data ?? []);
    } catch {
      setChartData([]);
    } finally {
      setChartLoading(false);
    }
  };

  const closeChart = () => {
    setChartTarget(null);
    setChartData([]);
  };

  useEffect(() => {
    if (!chartTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeChart();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chartTarget]);

  const load = async (m: MarketFilter) => {
    setLoading(true);
    try {
      const data = await api.getPatternScan(m, 50);
      setResults(data.results ?? []);
      setTotal(data.total ?? 0);
      setDate(data.date ?? null);
    } catch {
      setResults([]);
      setTotal(0);
      setDate(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(market);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market]);

  return (
    <>
      <Navbar />
      <main className="p-6 space-y-6 max-w-7xl mx-auto w-full">
        <div>
          <h1 className="text-2xl font-bold">패턴 스캔</h1>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            KOSPI+KOSDAQ 전종목의 최근 20거래일 가격/수급 패턴을 매일 오전 스캔한 결과입니다
            {date && <> · 기준일 {date}</>}
          </p>
          <p className="text-xs mt-2 rounded-lg px-3 py-2" style={{ background: "#f59e0b1a", color: "#f59e0b" }}>
            ⚠️ 참고용입니다. 원 통계 분석의 상관계수는 r=0.002~0.04 수준(거의 무의미)이라 매매 신호로 사용하지 마세요.
          </p>
        </div>

        <div className="card space-y-4">
          <div className="flex rounded-lg overflow-hidden border w-fit" style={{ borderColor: "var(--card-border)" }}>
            {(["ALL", "KOSPI", "KOSDAQ"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMarket(m)}
                className="px-4 py-1.5 text-xs font-medium transition-colors"
                style={{
                  background: market === m ? "var(--accent)" : "transparent",
                  color: market === m ? "#fff" : "var(--muted)",
                }}
              >
                {m === "ALL" ? "전체" : m}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="text-center py-12 space-y-3">
              <div className="flex justify-center gap-1">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-2 h-2 rounded-full animate-bounce"
                    style={{ background: "var(--accent)", animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
              <p className="text-sm" style={{ color: "var(--muted)" }}>불러오는 중...</p>
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-10 text-sm" style={{ color: "var(--muted)" }}>
              스캔 결과가 없습니다. 매일 오전 7시 자동 생성됩니다.
            </div>
          ) : (
            <>
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                총 <span className="font-semibold" style={{ color: "var(--foreground)" }}>{total.toLocaleString()}</span>개 종목
                {" · "}상위 {results.length}개 표시
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                      {["#", "종목명", "코드", "시장", "score", "mom20", "vol20", "외인비중", "기관비중", ""].map((h) => (
                        <th key={h} className="text-left py-2 px-3 font-medium" style={{ color: "var(--muted)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => {
                      const isUp = r.mom_20 >= 0;
                      return (
                        <tr key={`${r.market}-${r.code}`} style={{ borderBottom: "1px solid var(--card-border)" }}>
                          <td className="py-2.5 px-3 font-mono text-xs" style={{ color: "var(--muted)" }}>{i + 1}</td>
                          <td className="py-2.5 px-3 font-medium">{r.name}</td>
                          <td className="py-2.5 px-3 font-mono text-xs" style={{ color: "var(--muted)" }}>{r.code}</td>
                          <td className="py-2.5 px-3">
                            <span className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ background: "#3b82f620", color: "#60a5fa" }}>
                              {r.market}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono">{r.score.toFixed(2)}</td>
                          <td className={`py-2.5 px-3 font-mono ${isUp ? "positive" : "negative"}`}>
                            {isUp ? "▲" : "▼"} {(Math.abs(r.mom_20) * 100).toFixed(1)}%
                          </td>
                          <td className="py-2.5 px-3 font-mono text-xs" style={{ color: "var(--muted)" }}>
                            {(r.vol_20 * 100).toFixed(1)}%
                          </td>
                          <td className="py-2.5 px-3 font-mono text-xs" style={{ color: "var(--muted)" }}>
                            {(r.foreign_ratio * 100).toFixed(2)}%
                          </td>
                          <td className="py-2.5 px-3 font-mono text-xs" style={{ color: "var(--muted)" }}>
                            {(r.inst_ratio * 100).toFixed(2)}%
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => openChart(r)}
                                className="text-xs transition-colors"
                                style={{ color: "var(--accent)" }}
                                title="일간 차트 보기"
                              >
                                📈 차트
                              </button>
                              <Link href={`/stock?market=KR&ticker=${r.code}`} className="text-xs transition-colors" style={{ color: "var(--accent)" }}>
                                분석 →
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </main>

      {chartTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={closeChart}
        >
          <div
            className="card w-full max-w-3xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">
                  {chartTarget.name} <span className="text-xs font-mono" style={{ color: "var(--muted)" }}>{chartTarget.code}</span>
                </h2>
                <p className="text-xs" style={{ color: "var(--muted)" }}>최근 3개월 일간 차트</p>
              </div>
              <button
                onClick={closeChart}
                className="text-sm px-2 py-1 rounded transition-colors"
                style={{ color: "var(--muted)" }}
              >
                ✕
              </button>
            </div>

            {chartLoading ? (
              <div className="text-center py-16 space-y-3">
                <div className="flex justify-center gap-1">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="w-2 h-2 rounded-full animate-bounce"
                      style={{ background: "var(--accent)", animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            ) : chartData.length === 0 ? (
              <div className="text-center py-16 text-sm" style={{ color: "var(--muted)" }}>
                차트 데이터를 불러오지 못했습니다.
              </div>
            ) : (
              <StockChart data={chartData} market="KR" height={320} />
            )}

            <div className="flex justify-end">
              <Link
                href={`/stock?market=KR&ticker=${chartTarget.code}`}
                className="text-xs transition-colors"
                style={{ color: "var(--accent)" }}
              >
                상세 분석 페이지로 이동 →
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
