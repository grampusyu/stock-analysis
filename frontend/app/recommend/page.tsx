"use client";
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { API_BASE, NGROK_HEADER } from "@/lib/api";
import type { OHLCVRecord } from "@/lib/api";

const MiniSparkChart = dynamic(() => import("@/components/MiniSparkChart"), { ssr: false });

interface PatternSignals {
  MA?: string;
  RSI?: string;
  MACD?: string;
  BB?: string;
  VOL?: string;
}

interface Stock {
  rank: number;
  ticker: string;
  name: string;
  market: string;
  price: number;
  volume: number;
  change: number;
  sectors: string[];
  sect_avg: number;
  marcap: number;
  score: number;
  sentiment: string;
  pattern?: string;
  pattern_score?: number;
  pattern_signals?: PatternSignals;
}

interface RecommendResult {
  stocks: Stock[];
  generated_at: string;
  valid_until: string;
  cached: boolean;
}

const CACHE_KEY = "recommend_result";
const CHART_PERIODS = [
  { value: "1m", label: "1개월" },
  { value: "3m", label: "3개월" },
  { value: "6m", label: "6개월" },
  { value: "1y", label: "1년" },
] as const;
type ChartPeriod = typeof CHART_PERIODS[number]["value"];

export default function RecommendPage() {
  const [result, setResult] = useState<RecommendResult | null>(() => {
    try {
      const saved = localStorage.getItem(CACHE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [loading, setLoading]             = useState(false);
  const [phase, setPhase]                 = useState("");
  const [error, setError]                 = useState("");
  const [chartPeriod, setChartPeriod]     = useState<ChartPeriod>("3m");
  const [miniCharts, setMiniCharts]       = useState<Record<string, OHLCVRecord[]>>({});
  const [chartsLoading, setChartsLoading] = useState(false);

  const PHASES = [
    "KOSPI·KOSDAQ 전종목 시세 조회 중...",
    "섹터 등락률 계산 중...",
    "상승 섹터 종목 필터링 중...",
    "상위 후보 뉴스 수집 중...",
    "Gemini 감성 분析 중 (1회 배치)...",
    "최종 순위 산정 중...",
  ];

  useEffect(() => {
    if (!result || result.stocks.length === 0) return;
    setChartsLoading(true);
    setMiniCharts({});
    Promise.all(
      result.stocks.map(async (s) => {
        try {
          const res = await fetch(
            `${API_BASE}/stocks/chart/KR/${s.ticker}?period=${chartPeriod}&interval=daily`,
            { headers: NGROK_HEADER }
          );
          if (!res.ok) return [s.ticker, []] as [string, OHLCVRecord[]];
          const data = await res.json();
          return [s.ticker, data.data ?? []] as [string, OHLCVRecord[]];
        } catch {
          return [s.ticker, []] as [string, OHLCVRecord[]];
        }
      })
    ).then((entries) => {
      setMiniCharts(Object.fromEntries(entries));
      setChartsLoading(false);
    });
  }, [result, chartPeriod]);

  const load = async (refresh = false) => {
    setLoading(true);
    setError("");
    setResult(null);
    setMiniCharts({});
    if (refresh) try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }

    let idx = 0;
    setPhase(PHASES[0]);
    const interval = setInterval(() => {
      idx = (idx + 1) % PHASES.length;
      setPhase(PHASES[idx]);
    }, 8000);

    try {
      const url = `${API_BASE}/recommend/kr${refresh ? "?refresh=true" : ""}`;
      const res = await fetch(url, { headers: NGROK_HEADER });
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
      const data = await res.json();
      setResult(data);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : "조회 실패");
    } finally {
      clearInterval(interval);
      setLoading(false);
      setPhase("");
    }
  };

  return (
    <>
      <Navbar />
      <main className="p-6 space-y-6 max-w-7xl mx-auto w-full">

        {/* 헤더 */}
        <div>
          <h1 className="text-2xl font-bold">추천종목</h1>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            섹터 상승 · 긍정 뉴스 · 거래량 충분 종목 상위 20선 (KOSPI+KOSDAQ) — 매주 목요일 업데이트
          </p>
        </div>

        {/* 기준 설명 */}
        <div className="card">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            {[
              { icon: "📈", label: "섹터 상승", desc: "당일 섹터 평균 등락률이 양수인 상승 섹터" },
              { icon: "📊", label: "당일 모멘텀", desc: "당일 급락(-5%) 제외, 상승 모멘텀" },
              { icon: "😊", label: "긍정 뉴스", desc: "Gemini 배치 감성 분析 통과" },
              { icon: "💧", label: "충분한 거래량", desc: "거래량 50,000주 이상 (유동성)" },
            ].map((c) => (
              <div key={c.label} className="flex gap-2 items-start">
                <span className="text-lg">{c.icon}</span>
                <div>
                  <p className="font-semibold">{c.label}</p>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>{c.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 조회 버튼 */}
        {!result && !loading && (
          <div className="flex justify-center py-8">
            <button
              onClick={() => load(false)}
              className="px-8 py-3 rounded-lg font-medium text-white text-sm"
              style={{ background: "var(--accent)" }}
            >
              🔍 추천종목 조회
            </button>
          </div>
        )}

        {/* 로딩 */}
        {loading && (
          <div className="card text-center py-16 space-y-4">
            <div className="flex justify-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="w-2.5 h-2.5 rounded-full animate-bounce"
                  style={{ background: "var(--accent)", animationDelay: `${i * 0.18}s` }} />
              ))}
            </div>
            <p className="text-sm font-medium" style={{ color: "var(--muted)" }}>{phase}</p>
            <p className="text-xs" style={{ color: "var(--muted)" }}>최초 조회 시 30~60초 소요됩니다</p>
          </div>
        )}

        {error && (
          <div className="card text-sm" style={{ color: "#ef4444", border: "1px solid #ef444440" }}>
            {error}
          </div>
        )}

        {/* 결과 */}
        {result && (
          <>
            {/* 메타 정보 */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-xs space-x-3" style={{ color: "var(--muted)" }}>
                <span>마지막 업데이트: <b style={{ color: "var(--foreground)" }}>{result.generated_at}</b></span>
                <span>다음 업데이트: <b style={{ color: "var(--foreground)" }}>{result.valid_until} (목요일)</b></span>
                {result.cached && (
                  <span className="px-1.5 py-0.5 rounded text-xs"
                    style={{ background: "#3b82f620", color: "#60a5fa" }}>캐시됨</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* 차트 기간 드롭다운 */}
                <select
                  value={chartPeriod}
                  onChange={(e) => setChartPeriod(e.target.value as ChartPeriod)}
                  className="text-xs px-2 py-1.5 rounded-lg"
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--card-border)",
                    color: "var(--foreground)",
                    outline: "none",
                  }}
                >
                  {CHART_PERIODS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                <button
                  onClick={() => load(true)}
                  className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                  style={{ background: "var(--card-border)", color: "var(--muted)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--foreground)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
                >
                  ↻ 새로고침
                </button>
              </div>
            </div>

            {result.stocks.length === 0 ? (
              <div className="card text-center py-10 text-sm" style={{ color: "var(--muted)" }}>
                조건에 맞는 종목이 없습니다. 나중에 다시 시도해주세요.
              </div>
            ) : (
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                      {["순위", "종목명", "코드", "시장", "현재가", "등락", "거래량", "섹터", "섹터 등락", "감성", "패턴", "차트"].map((h) => (
                        <th key={h} className="text-left py-2 px-3 text-xs font-medium"
                          style={{ color: "var(--muted)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.stocks.map((s) => {
                      const chartData = miniCharts[s.ticker] ?? [];
                      return (
                        <tr key={s.ticker}
                          style={{ borderBottom: "1px solid var(--card-border)" }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--card-alt,#1e293b10)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                        >
                          {/* 순위 */}
                          <td className="py-3 px-3">
                            <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                              style={{
                                background: s.rank <= 3 ? "var(--accent)" : "var(--card-border)",
                                color: s.rank <= 3 ? "#fff" : "var(--muted)",
                                display: "inline-flex",
                              }}>
                              {s.rank}
                            </span>
                          </td>
                          {/* 종목명 */}
                          <td className="py-3 px-3 font-medium">
                            <Link href={`/stock?market=KR&ticker=${s.ticker}`}
                              className="hover:underline" style={{ color: "var(--foreground)" }}>
                              {s.name}
                            </Link>
                          </td>
                          {/* 코드 */}
                          <td className="py-3 px-3 font-mono text-xs" style={{ color: "var(--muted)" }}>
                            {s.ticker}
                          </td>
                          {/* 시장 */}
                          <td className="py-3 px-3 text-xs" style={{ color: "var(--muted)" }}>
                            {s.market}
                          </td>
                          {/* 현재가 */}
                          <td className="py-3 px-3 font-mono">{s.price.toLocaleString()}</td>
                          {/* 등락 */}
                          <td className="py-3 px-3 font-mono text-xs font-medium"
                            style={{ color: s.change >= 0 ? "#ef4444" : "#3b82f6" }}>
                            {s.change >= 0 ? "▲" : "▼"} {Math.abs(s.change).toFixed(2)}%
                          </td>
                          {/* 거래량 */}
                          <td className="py-3 px-3 font-mono text-xs" style={{ color: "var(--muted)" }}>
                            {s.volume.toLocaleString()}
                          </td>
                          {/* 섹터 */}
                          <td className="py-3 px-3">
                            <div className="flex flex-wrap gap-1">
                              {s.sectors.slice(0, 2).map((sec) => (
                                <span key={sec} className="text-xs px-1.5 py-0.5 rounded"
                                  style={{ background: "#6366f120", color: "#818cf8" }}>
                                  {sec}
                                </span>
                              ))}
                            </div>
                          </td>
                          {/* 섹터 등락률 */}
                          <td className="py-3 px-3 font-mono text-xs font-medium"
                            style={{ color: s.sect_avg >= 0 ? "#ef4444" : "#3b82f6" }}>
                            {s.sect_avg >= 0 ? "▲" : "▼"} {Math.abs(s.sect_avg).toFixed(2)}%
                          </td>
                          {/* 감성 */}
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                              style={{ background: "#10b98120", color: "#10b981" }}>
                              😊 긍정
                            </span>
                          </td>
                          {/* 패턴 */}
                          <td className="py-3 px-3 whitespace-nowrap">
                            {s.pattern ? (
                              <div className="relative group inline-block">
                                <span
                                  className="text-xs px-2 py-0.5 rounded-full font-medium cursor-default"
                                  style={{
                                    background: s.pattern === "상승" ? "#ef444420" : s.pattern === "하락" ? "#3b82f620" : "#6b728020",
                                    color:      s.pattern === "상승" ? "#ef4444"   : s.pattern === "하락" ? "#3b82f6"   : "#9ca3af",
                                  }}
                                >
                                  {s.pattern === "상승" ? "📈" : s.pattern === "하락" ? "📉" : "➡️"} {s.pattern}
                                  {s.pattern_score !== undefined && (
                                    <span className="ml-1 opacity-60">({s.pattern_score > 0 ? "+" : ""}{s.pattern_score})</span>
                                  )}
                                </span>
                                {s.pattern_signals && Object.keys(s.pattern_signals).length > 0 && (
                                  <div
                                    className="absolute z-10 hidden group-hover:block bottom-full left-0 mb-1 w-40 rounded-lg p-2 text-xs shadow-lg"
                                    style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}
                                  >
                                    {Object.entries(s.pattern_signals).map(([k, v]) => (
                                      <div key={k} className="flex justify-between py-0.5">
                                        <span style={{ color: "var(--muted)" }}>{k}</span>
                                        <span style={{ color: "var(--foreground)" }}>{v as string}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs" style={{ color: "var(--muted)" }}>-</span>
                            )}
                          </td>
                          {/* 차트 */}
                          <td className="py-2 px-3" style={{ width: 140, maxWidth: 140, overflow: "hidden" }}>
                            {chartsLoading || chartData.length === 0 ? (
                              <div className="rounded animate-pulse"
                                style={{ height: 75, background: "var(--card-border)" }} />
                            ) : (
                              <MiniSparkChart data={chartData} height={75} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
