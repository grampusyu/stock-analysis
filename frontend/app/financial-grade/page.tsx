"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import FundFlowChart from "@/components/FundFlowChart";
import { api, FinancialGradeRow, FinancialTier, UpsideLabel } from "@/lib/api";

type MarketFilter = "ALL" | "KOSPI" | "KOSDAQ";
type TierFilter = "ALL" | FinancialTier;
type ViewMode = "all" | "favorites";

const TIERS: FinancialTier[] = ["최상", "상", "중", "하", "최하"];

const favKey = (r: { market: string; code: string }) => `${r.market}-${r.code}`;

const FUND_FLOW_DAYS_OPTIONS = [30, 60, 90] as const;
type FundFlowDays = (typeof FUND_FLOW_DAYS_OPTIONS)[number];
const fundFlowKey = (code: string, days: number) => `${code}:${days}`;

const TIER_COLOR: Record<FinancialTier, string> = {
  최상: "#10b981",
  상: "#3b82f6",
  중: "#f59e0b",
  하: "#f97316",
  최하: "#ef4444",
};

const UPSIDE_STYLE: Record<UpsideLabel, { bg: string; fg: string }> = {
  높음: { bg: "#10b98122", fg: "#10b981" },
  보통: { bg: "#64748b22", fg: "#94a3b8" },
  낮음: { bg: "#64748b15", fg: "#64748b" },
};

function pct(v: number | null, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return `${v.toFixed(digits)}%`;
}

function num(v: number | null, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return v.toFixed(digits);
}

function UpsideBadge({ label, title }: { label: UpsideLabel | null; title: string }) {
  const style = label ? UPSIDE_STYLE[label] : { bg: "#64748b10", fg: "#475569" };
  return (
    <div className="flex flex-col items-center gap-0.5 flex-1 min-w-0">
      <span className="text-[10px]" style={{ color: "var(--muted)" }}>{title}</span>
      <span
        className="text-xs font-semibold rounded-full px-2 py-0.5 w-full text-center truncate"
        style={{ background: style.bg, color: style.fg }}
      >
        {label ?? "데이터 없음"}
      </span>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (!values || values.length < 2) {
    return <div className="h-10 flex items-center justify-center text-[10px]" style={{ color: "var(--muted)" }}>차트 데이터 없음</div>;
  }
  const W = 240, H = 40;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const isUp = values[values.length - 1] >= values[0];
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - ((v - min) / range) * (H - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const color = isUp ? "#10b981" : "#ef4444";
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <defs>
        <linearGradient id={`spark-${isUp ? "up" : "dn"}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill={`url(#spark-${isUp ? "up" : "dn"})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function FinancialGradePage() {
  const [view, setView] = useState<ViewMode>("all");
  const [market, setMarket] = useState<MarketFilter>("ALL");
  const [tier, setTier] = useState<TierFilter>("ALL");
  const [sector, setSector] = useState<string>("ALL");
  const [undervaluedOnly, setUndervaluedOnly] = useState(false);
  const [chartOnly, setChartOnly] = useState(true);
  const [results, setResults] = useState<FinancialGradeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [date, setDate] = useState<string | null>(null);
  const [tierCounts, setTierCounts] = useState<Record<string, number>>({});
  const [themeSectorCounts, setThemeSectorCounts] = useState<Record<string, number>>({});
  const [industrySectorCounts, setIndustrySectorCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [fundFlowDays, setFundFlowDays] = useState<FundFlowDays>(30);
  const [fundFlowCache, setFundFlowCache] = useState<Record<string, unknown[]>>({});
  const [fundFlowLoading, setFundFlowLoading] = useState<string | null>(null);

  useEffect(() => {
    api.getFinancialGradeFavorites()
      .then((data) => setFavorites(new Set((data.items ?? []).map((it) => `${it.market}-${it.code}`))))
      .catch(() => setFavorites(new Set()));
  }, []);

  const toggleFavorite = async (r: FinancialGradeRow) => {
    const key = favKey(r);
    const wasFavorite = favorites.has(key);
    setFavorites((prev) => {
      const next = new Set(prev);
      if (wasFavorite) next.delete(key);
      else next.add(key);
      return next;
    });
    try {
      if (wasFavorite) await api.removeFinancialGradeFavorite(r.market, r.code);
      else await api.addFinancialGradeFavorite(r.market, r.code);
    } catch {
      // 서버 반영 실패 시 낙관적 업데이트 되돌리기
      setFavorites((prev) => {
        const next = new Set(prev);
        if (wasFavorite) next.add(key);
        else next.delete(key);
        return next;
      });
    }
  };

  const loadFundFlow = async (code: string, days: FundFlowDays) => {
    const key = fundFlowKey(code, days);
    if (fundFlowCache[key]) return;
    setFundFlowLoading(key);
    try {
      const res = await api.getFundFlow(code, days);
      setFundFlowCache((prev) => ({ ...prev, [key]: res.data }));
    } catch {
      setFundFlowCache((prev) => ({ ...prev, [key]: [] }));
    } finally {
      setFundFlowLoading(null);
    }
  };

  const toggleFundFlow = async (code: string) => {
    if (expandedCode === code) {
      setExpandedCode(null);
      return;
    }
    setExpandedCode(code);
    await loadFundFlow(code, fundFlowDays);
  };

  const changeFundFlowDays = async (days: FundFlowDays) => {
    setFundFlowDays(days);
    if (expandedCode) await loadFundFlow(expandedCode, days);
  };

  const load = async () => {
    setLoading(true);
    try {
      // 관심카드 탭은 등급/저평가 필터와 무관하게 즐겨찾기한 종목을 놓치지 않도록
      // tier/undervalued 필터를 해제하고 전체 유니버스를 가져와 클라이언트에서 걸러낸다.
      const opts =
        view === "favorites"
          ? { market, tier: "ALL" as const, sector: "ALL", undervaluedOnly: false, limit: 5000 }
          : { market, tier, sector, undervaluedOnly, limit: 200 };
      const data = await api.getFinancialGrade(opts);
      setResults(data.results ?? []);
      setTotal(data.total ?? 0);
      setDate(data.date ?? null);
      setTierCounts(data.tier_counts ?? {});
      setThemeSectorCounts(data.theme_sector_counts ?? {});
      setIndustrySectorCounts(data.industry_sector_counts ?? {});
    } catch {
      setResults([]);
      setTotal(0);
      setDate(null);
      setTierCounts({});
      setThemeSectorCounts({});
      setIndustrySectorCounts({});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, tier, sector, undervaluedOnly, view]);

  const base = view === "favorites" ? results.filter((r) => favorites.has(favKey(r))) : results;
  const filtered = chartOnly ? base.filter((r) => r.sparkline && r.sparkline.length >= 2) : base;

  return (
    <>
      <Navbar />
      <main className="p-6 space-y-6 max-w-7xl mx-auto w-full">
        <div>
          <h1 className="text-2xl font-bold">재무 등급</h1>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            KOSPI+KOSDAQ 전종목을 DART 재무제표(수익성·안정성·성장성) 기준 5단계로 평가하고,
            상위 3단계 중 업종 평균보다 PER·PBR이 낮은 종목을 저평가로 표시합니다
            {date && <> · 기준일 {date}</>}
          </p>
          <p className="text-xs mt-2 rounded-lg px-3 py-2" style={{ background: "#f59e0b1a", color: "#f59e0b" }}>
            ⚠️ 매매 신호가 아닌 스크리닝 참고용입니다. 단기(1주)·중기(1개월) 상승여력은 가격
            모멘텀 기반, 장기(3개월)는 밸류에이션 갭·성장성 기반 참고 지표이며 예측이 아닙니다.
            데이터를 구하지 못한 종목은 목록에서 제외됩니다.
          </p>
        </div>

        <div className="card space-y-4">
          <div className="flex rounded-lg overflow-hidden border w-fit" style={{ borderColor: "var(--card-border)" }}>
            {(["all", "favorites"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="px-4 py-1.5 text-xs font-medium transition-colors"
                style={{
                  background: view === v ? "var(--accent)" : "transparent",
                  color: view === v ? "#fff" : "var(--muted)",
                }}
              >
                {v === "all" ? "전체 목록" : `⭐ 관심카드 (${favorites.size})`}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
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

            {view === "all" && (
              <div className="flex rounded-lg overflow-hidden border w-fit" style={{ borderColor: "var(--card-border)" }}>
                <button
                  onClick={() => setTier("ALL")}
                  className="px-3 py-1.5 text-xs font-medium transition-colors"
                  style={{
                    background: tier === "ALL" ? "var(--accent)" : "transparent",
                    color: tier === "ALL" ? "#fff" : "var(--muted)",
                  }}
                >
                  전체
                </button>
                {TIERS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTier(t)}
                    className="px-3 py-1.5 text-xs font-medium transition-colors"
                    style={{
                      background: tier === t ? TIER_COLOR[t] : "transparent",
                      color: tier === t ? "#fff" : "var(--muted)",
                    }}
                  >
                    {t} {tierCounts[t] !== undefined && <span className="opacity-70">({tierCounts[t]})</span>}
                  </button>
                ))}
              </div>
            )}

            {view === "all" && (
              <select
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                className="text-xs font-medium rounded-lg border px-2 py-1.5"
                style={{ borderColor: "var(--card-border)", background: "var(--card)", color: "var(--foreground)" }}
              >
                <option value="ALL">업종 전체</option>
                <optgroup label="테마">
                  {Object.entries(themeSectorCounts).map(([name, count]) => (
                    <option key={name} value={name}>
                      {name} ({count})
                    </option>
                  ))}
                </optgroup>
                <optgroup label="업종(KSIC)">
                  {Object.entries(industrySectorCounts).map(([name, count]) => (
                    <option key={name} value={name}>
                      {name} ({count})
                    </option>
                  ))}
                </optgroup>
              </select>
            )}

            {view === "all" && (
              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none" style={{ color: "var(--muted)" }}>
                <input
                  type="checkbox"
                  checked={undervaluedOnly}
                  onChange={(e) => setUndervaluedOnly(e.target.checked)}
                  className="accent-current"
                />
                저평가만 보기
              </label>
            )}

            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none" style={{ color: "var(--muted)" }}>
              <input
                type="checkbox"
                checked={chartOnly}
                onChange={(e) => setChartOnly(e.target.checked)}
                className="accent-current"
              />
              그래프 있는 종목만
            </label>
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
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-sm" style={{ color: "var(--muted)" }}>
              {view === "favorites"
                ? "관심카드로 등록한 종목이 없습니다. 카드의 ☆ 버튼을 눌러 추가하세요."
                : "결과가 없습니다. 매일 새벽 자동 생성됩니다."}
            </div>
          ) : (
            <>
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                총 <span className="font-semibold" style={{ color: "var(--foreground)" }}>{total.toLocaleString()}</span>개 종목
                {" · "}{filtered.length}개 표시
                {chartOnly && results.length !== filtered.length && (
                  <> (그래프 없는 {results.length - filtered.length}개 제외)</>
                )}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {filtered.map((r) => (
                  <div
                    key={`${r.market}-${r.code}`}
                    className="rounded-xl p-3 space-y-2"
                    style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}
                  >
                    {/* 헤더: 이름/코드/시장 + 등급/저평가 뱃지 */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-sm truncate">{r.name}</span>
                          <span className="text-xs px-1.5 py-0.5 rounded font-mono shrink-0" style={{ background: "#3b82f620", color: "#60a5fa" }}>
                            {r.market}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs" style={{ color: "var(--muted)" }}>{r.code}</span>
                          <span className="text-xs truncate" style={{ color: "var(--muted)" }}>· {r.sector}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => toggleFavorite(r)}
                          aria-label="관심카드 등록"
                          className="text-base leading-none px-0.5"
                          style={{ color: favorites.has(favKey(r)) ? "#f59e0b" : "var(--muted)" }}
                        >
                          {favorites.has(favKey(r)) ? "★" : "☆"}
                        </button>
                        {r.undervalued && (
                          <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: "#10b98120", color: "#10b981" }}>
                            저평가
                          </span>
                        )}
                        <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: `${TIER_COLOR[r.tier]}20`, color: TIER_COLOR[r.tier] }}>
                          {r.tier}
                        </span>
                      </div>
                    </div>

                    {/* 스파크라인 */}
                    <Sparkline values={r.sparkline ?? []} />

                    {/* 단기/중기/장기 상승여력 */}
                    <div className="flex items-stretch gap-1">
                      <UpsideBadge label={r.short_term_label} title="단기(1주)" />
                      <UpsideBadge label={r.mid_term_label} title="중기(1개월)" />
                      <UpsideBadge label={r.long_term_label} title="장기(3개월)" />
                    </div>

                    {/* 핵심 재무 지표 */}
                    <div className="grid grid-cols-4 gap-1 text-center text-xs pt-1" style={{ borderTop: "1px solid var(--card-border)" }}>
                      <div>
                        <div style={{ color: "var(--muted)" }}>ROE</div>
                        <div className="font-mono">{pct(r.roe)}</div>
                      </div>
                      <div>
                        <div style={{ color: "var(--muted)" }}>영업이익률</div>
                        <div className="font-mono">{pct(r.op_margin)}</div>
                      </div>
                      <div>
                        <div style={{ color: "var(--muted)" }}>PER</div>
                        <div className="font-mono">{num(r.per)}</div>
                      </div>
                      <div>
                        <div style={{ color: "var(--muted)" }}>PBR</div>
                        <div className="font-mono">{num(r.pbr, 2)}</div>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => toggleFundFlow(r.code)}
                        className="text-xs px-2 py-1 rounded-lg transition-colors"
                        style={{
                          color: expandedCode === r.code ? "#fff" : "var(--accent)",
                          background: expandedCode === r.code ? "var(--accent)" : "transparent",
                          border: "1px solid var(--accent)",
                        }}
                      >
                        {expandedCode === r.code ? "닫기" : "수급 보기"}
                      </button>
                      <Link href={`/stock?market=KR&ticker=${r.code}`} className="text-xs transition-colors" style={{ color: "var(--accent)" }}>
                        분석 →
                      </Link>
                    </div>

                    {expandedCode === r.code && (
                      <div className="pt-2" style={{ borderTop: "1px solid var(--card-border)" }}>
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs" style={{ color: "var(--muted)" }}>개인·외국인·기관 순매매 수량</p>
                          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--card-border)" }}>
                            {FUND_FLOW_DAYS_OPTIONS.map((d) => (
                              <button
                                key={d}
                                onClick={() => changeFundFlowDays(d)}
                                className="px-2 py-0.5 text-[10px] font-medium transition-colors"
                                style={{
                                  background: fundFlowDays === d ? "var(--accent)" : "transparent",
                                  color: fundFlowDays === d ? "#fff" : "var(--muted)",
                                }}
                              >
                                {d}일
                              </button>
                            ))}
                          </div>
                        </div>
                        {fundFlowLoading === fundFlowKey(r.code, fundFlowDays) ? (
                          <p className="text-xs py-3" style={{ color: "var(--muted)" }}>수급 데이터 불러오는 중...</p>
                        ) : (
                          <FundFlowChart
                            data={(fundFlowCache[fundFlowKey(r.code, fundFlowDays)] ?? []) as Parameters<typeof FundFlowChart>[0]["data"]}
                          />
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
