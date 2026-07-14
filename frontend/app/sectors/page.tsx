"use client";
import { useState, useEffect } from "react";
import Navbar from "@/components/Navbar";
import SectorStocksPanel from "@/components/SectorStocksPanel";
import { api, Market } from "@/lib/api";

type TrendPeriod = "1d" | "1w" | "1m" | "3m" | "6m" | "1y";

const PERIOD_LABEL: Record<TrendPeriod, string> = {
  "1d": "하루", "1w": "1주일", "1m": "1개월", "3m": "3개월", "6m": "6개월", "1y": "1년",
};

interface SectorItem {
  sector?: string;
  etf?: string;
  change_pct?: number;
  trend_pct?: number;
  trend?: string;
  sparkline?: number[];
  [key: string]: unknown;
}

function SectorBarChart({ data, selectedSector }: { data: SectorItem[]; selectedSector: string | null }) {
  if (data.length === 0) return null;

  const rawMax = Math.max(...data.map((s) => Math.abs(s.trend_pct ?? 0)), 1);
  const niceMax = rawMax <= 10 ? 10 : rawMax <= 20 ? 20 : rawMax <= 30 ? 30 : rawMax <= 50 ? 50 : rawMax <= 80 ? 80 : 100;

  // Grid lines every 20 percentage points
  const gridTicks: number[] = [];
  for (let t = -niceMax; t <= niceMax; t += 20) gridTicks.push(t);

  // Label slot: "+78.3%" = 7 chars × ~7px = ~50px
  const LABEL_W = 50;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {/* Bar rows */}
      {data.map((s, i) => {
        const name = String(s.sector || s.etf || "");
        const pct = Number(s.trend_pct ?? 0);
        const barPct = Math.min((Math.abs(pct) / niceMax) * 100, 100);
        const isUp = pct >= 0;
        const isSelected = selectedSector === name;
        const fill = isSelected ? "#6366f1" : isUp ? "#10b981" : "#ef4444";
        const label = (isUp ? "+" : "") + pct.toFixed(1) + "%";

        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {/* Sector name */}
            <div style={{ width: 76, flexShrink: 0, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#cbd5e1", fontSize: 12 }}>
              {name}
            </div>

            {/* Negative label */}
            <div style={{ width: LABEL_W, flexShrink: 0, textAlign: "right", fontFamily: "monospace", fontSize: 11, color: !isUp ? fill : "transparent" }}>
              {!isUp ? label : ""}
            </div>

            {/* Bar area with grid lines */}
            <div style={{ flex: 1, position: "relative", height: 14, display: "flex", alignItems: "center" }}>
              {/* Vertical grid lines */}
              {gridTicks.map((tick) => {
                const pos = ((tick + niceMax) / (2 * niceMax)) * 100;
                return (
                  <div key={tick} style={{
                    position: "absolute",
                    left: `${pos}%`,
                    top: 0,
                    height: "100%",
                    width: 1,
                    background: tick === 0 ? "#475569" : "#1e293b",
                    pointerEvents: "none",
                  }} />
                );
              })}
              {/* Left half – negative bar */}
              <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
                {!isUp && <div style={{ width: `${barPct}%`, height: 12, background: fill, borderRadius: "3px 0 0 3px", position: "relative", zIndex: 1 }} />}
              </div>
              <div style={{ width: 1, flexShrink: 0 }} />
              {/* Right half – positive bar */}
              <div style={{ flex: 1 }}>
                {isUp && <div style={{ width: `${barPct}%`, height: 12, background: fill, borderRadius: "0 3px 3px 0", position: "relative", zIndex: 1 }} />}
              </div>
            </div>

            {/* Positive label */}
            <div style={{ width: LABEL_W, flexShrink: 0, fontFamily: "monospace", fontSize: 11, color: isUp ? fill : "transparent" }}>
              {isUp ? label : ""}
            </div>
          </div>
        );
      })}

      {/* X-axis tick labels */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4, paddingTop: 5, borderTop: "1px solid #1e293b" }}>
        <div style={{ width: 76, flexShrink: 0 }} />
        <div style={{ width: LABEL_W, flexShrink: 0 }} />
        <div style={{ flex: 1, position: "relative", height: 14 }}>
          {gridTicks.map((tick) => {
            const pos = ((tick + niceMax) / (2 * niceMax)) * 100;
            const label = tick === 0 ? "0" : (tick > 0 ? `+${tick}` : `${tick}`) + "%";
            return (
              <span key={tick} style={{
                position: "absolute",
                left: `${pos}%`,
                transform: "translateX(-50%)",
                fontSize: 10,
                color: tick === 0 ? "#94a3b8" : "#64748b",
                whiteSpace: "nowrap",
              }}>
                {label}
              </span>
            );
          })}
        </div>
        <div style={{ width: LABEL_W, flexShrink: 0 }} />
      </div>
    </div>
  );
}

function Sparkline({ values, isUp }: { values: number[]; isUp: boolean }) {
  if (!values || values.length < 2) return null;
  const W = 65, H = 38;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - ((v - min) / range) * (H - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const color = isUp ? "#10b981" : "#ef4444";
  const fillId = `sf-${isUp ? "up" : "dn"}`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${H} ${pts} ${W},${H}`}
        fill={`url(#${fillId})`}
      />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function SectorsPage() {
  const [market, setMarket] = useState<Market>("KR");
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>("3m");
  const [sectors, setSectors] = useState<SectorItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSector, setSelectedSector] = useState<string | null>(null);

  useEffect(() => {
    setSelectedSector(null);
  }, [market]);

  useEffect(() => {
    setLoading(true);
    api.getSectors(market, trendPeriod)
      .then((res) => setSectors(res.data as SectorItem[]))
      .catch(() => setSectors([]))
      .finally(() => setLoading(false));
  }, [market, trendPeriod]);

  const sorted = [...sectors]
    .filter((s) => s.sector != null || s.etf != null)
    .sort((a, b) => (b.trend_pct ?? 0) - (a.trend_pct ?? 0));

  return (
    <>
      <Navbar />
      <main className="p-6 space-y-6 max-w-7xl mx-auto w-full">
        <h1 className="text-2xl font-bold">섹터 분석</h1>

        {/* 컨트롤 */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--card-border)" }}>
            {(["KR", "US"] as Market[]).map((m) => (
              <button
                key={m}
                onClick={() => setMarket(m)}
                className="px-4 py-2 text-sm font-medium transition-colors"
                style={{
                  background: market === m ? "var(--accent)" : "transparent",
                  color: market === m ? "#fff" : "var(--muted)",
                }}
              >
                {m === "KR" ? "한국" : "미국"}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {(["1d", "1w", "1m", "3m", "6m", "1y"] as TrendPeriod[]).map((p) => (
              <button
                key={p}
                onClick={() => setTrendPeriod(p)}
                className="px-3 py-2 text-xs rounded-lg transition-colors"
                style={{
                  background: trendPeriod === p ? "var(--accent)" : "var(--card)",
                  border: "1px solid var(--card-border)",
                  color: trendPeriod === p ? "#fff" : "var(--muted)",
                }}
              >
                {PERIOD_LABEL[p]}
              </button>
            ))}
          </div>
          {loading && <span className="text-xs muted animate-pulse">로딩 중...</span>}
        </div>

        {!loading && sorted.length > 0 ? (
          <>
            {/* 바 차트 + 카드 2단 레이아웃 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">

              {/* 왼쪽: 등락률 바 차트 */}
              <div className="card flex flex-col">
                <h2 className="font-semibold mb-1">
                  {PERIOD_LABEL[trendPeriod]} 수익률 순위
                </h2>
                <p className="text-xs muted mb-3">카드를 클릭하면 구성 종목을 볼 수 있습니다</p>
                <SectorBarChart data={sorted} selectedSector={selectedSector} />
              </div>

              {/* 오른쪽: 스파크라인 카드 그리드 (5열) */}
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2">
                {sorted.map((s, i) => {
                  const name = String(s.sector || s.etf || "");
                  const isSelected = selectedSector === name;
                  const trendPct = s.trend_pct ?? 0;
                  const dailyPct = s.change_pct ?? 0;
                  const isUp = trendPct >= 0;

                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedSector((prev) => (prev === name ? null : name))}
                      className="text-left rounded-xl px-2 py-2 transition-all"
                      style={{
                        background: isSelected ? "var(--accent)18" : "var(--card)",
                        border: `1px solid ${isSelected ? "var(--accent)" : "var(--card-border)"}`,
                      }}
                    >
                      {/* 섹터명 + 뱃지 */}
                      <div className="flex items-center gap-1 mb-1">
                        <p className="text-xs font-semibold truncate leading-tight">{name}</p>
                        <span
                          className="shrink-0 font-bold rounded px-0.5"
                          style={{
                            background: isUp ? "#10b98122" : "#ef444422",
                            color: isUp ? "#10b981" : "#ef4444",
                            fontSize: "0.55rem",
                            lineHeight: 1.4,
                          }}
                        >
                          {isUp ? "▲" : "▼"}
                        </span>
                      </div>

                      {/* 스파크라인 */}
                      <div className="mb-1">
                        <Sparkline values={s.sparkline ?? []} isUp={isUp} />
                      </div>

                      {/* 수익률 */}
                      <p className={`text-sm font-bold font-mono leading-tight ${isUp ? "positive" : "negative"}`}>
                        {isUp ? "+" : ""}{trendPct.toFixed(2)}%
                      </p>
                      <p className="text-xs leading-tight" style={{ color: "var(--muted)", fontSize: "0.65rem" }}>
                        전일 {dailyPct >= 0 ? "+" : ""}{dailyPct.toFixed(2)}%
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 선택된 섹터 종목 패널 */}
            {selectedSector && (
              <SectorStocksPanel
                market={market}
                sector={selectedSector}
                period={trendPeriod}
                onClose={() => setSelectedSector(null)}
              />
            )}
          </>
        ) : !loading ? (
          <p className="muted text-sm">섹터 데이터가 없습니다</p>
        ) : null}
      </main>
    </>
  );
}
