"use client";
import { useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";

interface ScreenerResult {
  ticker: string;
  name: string;
  market_type: string;
  price: number;
  volume: number;
  change_pct: number;
  per: number | null;
  pbr: number | null;
}

type SortBy = "volume" | "change_pct" | "change_pct_asc" | "per" | "price";

interface Filters {
  market_type: "KOSPI" | "KOSDAQ" | "ALL";
  change_min: string;
  change_max: string;
  volume_min: string;
  per_min: string;
  per_max: string;
  sort_by: SortBy;
}

const DEFAULT_FILTERS: Filters = {
  market_type: "KOSPI",
  change_min: "-30",
  change_max: "30",
  volume_min: "0",
  per_min: "",
  per_max: "",
  sort_by: "volume",
};

const PRESETS = [
  { label: "전체", desc: "거래량순", filters: { ...DEFAULT_FILTERS } },
  {
    label: "🚀 급등주",
    desc: "등락률 +3% 이상",
    filters: { ...DEFAULT_FILTERS, change_min: "3", change_max: "30", sort_by: "change_pct" as SortBy },
  },
  {
    label: "📉 급락주",
    desc: "등락률 -3% 이하",
    filters: { ...DEFAULT_FILTERS, change_min: "-30", change_max: "-3", sort_by: "change_pct_asc" as SortBy },
  },
  {
    label: "💰 거래량 상위",
    desc: "오늘 거래량 많은 순",
    filters: { ...DEFAULT_FILTERS, sort_by: "volume" as SortBy },
  },
  {
    label: "📊 저PER",
    desc: "PER 1~15 우량주",
    filters: { ...DEFAULT_FILTERS, per_min: "1", per_max: "15", sort_by: "per" as SortBy },
  },
];

const SORT_LABELS: Record<SortBy, string> = {
  volume: "거래량 많은순",
  change_pct: "등락률 높은순",
  change_pct_asc: "등락률 낮은순",
  per: "PER 낮은순",
  price: "주가 높은순",
};

export default function ScreenerPage() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [activePreset, setActivePreset] = useState(0);
  const [results, setResults] = useState<ScreenerResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const applyPreset = (idx: number) => {
    setActivePreset(idx);
    setFilters(PRESETS[idx].filters);
  };

  const buildQuery = (f: Filters) => {
    const p = new URLSearchParams();
    p.set("market_type", f.market_type);
    p.set("change_min", f.change_min || "-30");
    p.set("change_max", f.change_max || "30");
    p.set("volume_min", f.volume_min || "0");
    if (f.per_min) p.set("per_min", f.per_min);
    if (f.per_max) p.set("per_max", f.per_max);
    p.set("sort_by", f.sort_by);
    p.set("limit", "50");
    return p.toString();
  };

  const search = async (f = filters) => {
    setLoading(true);
    setSearched(false);
    const start = Date.now();
    try {
      const res = await fetch(`http://localhost:8000/api/screener/kr?${buildQuery(f)}`);
      const data = await res.json();
      setResults(data.results ?? []);
      setTotal(data.total ?? 0);
      setElapsed(Math.round((Date.now() - start) / 100) / 10);
      setSearched(true);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const set = (key: keyof Filters, val: string) =>
    setFilters((prev) => ({ ...prev, [key]: val }));

  return (
    <>
      <Navbar />
      <main className="p-6 space-y-6 max-w-7xl mx-auto w-full">
        <div>
          <h1 className="text-2xl font-bold">종목 스크리너</h1>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            조건으로 한국 주식을 필터링하세요 · 최초 조회 시 30초 내외 소요됩니다
          </p>
        </div>

        <div className="card space-y-5">
          {/* 프리셋 */}
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: "var(--muted)" }}>프리셋</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p, i) => (
                <button
                  key={i}
                  onClick={() => applyPreset(i)}
                  className="px-3 py-1.5 rounded-lg text-sm transition-colors"
                  style={{
                    background: activePreset === i ? "var(--accent)" : "var(--card-border)",
                    color: activePreset === i ? "#fff" : "var(--muted)",
                  }}
                >
                  <span>{p.label}</span>
                  <span className="ml-1.5 text-xs opacity-70">{p.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 필터 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* 시장 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{ color: "var(--muted)" }}>시장</label>
              <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--card-border)" }}>
                {(["KOSPI", "KOSDAQ", "ALL"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => set("market_type", m)}
                    className="flex-1 py-1.5 text-xs font-medium transition-colors"
                    style={{
                      background: filters.market_type === m ? "var(--accent)" : "transparent",
                      color: filters.market_type === m ? "#fff" : "var(--muted)",
                    }}
                  >
                    {m === "ALL" ? "전체" : m}
                  </button>
                ))}
              </div>
            </div>

            {/* 등락률 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{ color: "var(--muted)" }}>등락률 범위 (%)</label>
              <div className="flex gap-1 items-center">
                <input
                  type="number"
                  value={filters.change_min}
                  onChange={(e) => set("change_min", e.target.value)}
                  className="w-full px-2 py-1.5 rounded text-sm text-center"
                  style={{ background: "var(--background)", border: "1px solid var(--card-border)", color: "var(--foreground)" }}
                  placeholder="-30"
                />
                <span className="text-xs" style={{ color: "var(--muted)" }}>~</span>
                <input
                  type="number"
                  value={filters.change_max}
                  onChange={(e) => set("change_max", e.target.value)}
                  className="w-full px-2 py-1.5 rounded text-sm text-center"
                  style={{ background: "var(--background)", border: "1px solid var(--card-border)", color: "var(--foreground)" }}
                  placeholder="30"
                />
              </div>
            </div>

            {/* PER */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{ color: "var(--muted)" }}>PER 범위</label>
              <div className="flex gap-1 items-center">
                <input
                  type="number"
                  value={filters.per_min}
                  onChange={(e) => set("per_min", e.target.value)}
                  className="w-full px-2 py-1.5 rounded text-sm text-center"
                  style={{ background: "var(--background)", border: "1px solid var(--card-border)", color: "var(--foreground)" }}
                  placeholder="최소"
                />
                <span className="text-xs" style={{ color: "var(--muted)" }}>~</span>
                <input
                  type="number"
                  value={filters.per_max}
                  onChange={(e) => set("per_max", e.target.value)}
                  className="w-full px-2 py-1.5 rounded text-sm text-center"
                  style={{ background: "var(--background)", border: "1px solid var(--card-border)", color: "var(--foreground)" }}
                  placeholder="최대"
                />
              </div>
            </div>

            {/* 정렬 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{ color: "var(--muted)" }}>정렬 기준</label>
              <select
                value={filters.sort_by}
                onChange={(e) => set("sort_by", e.target.value as SortBy)}
                className="w-full px-2 py-1.5 rounded text-sm"
                style={{ background: "var(--background)", border: "1px solid var(--card-border)", color: "var(--foreground)" }}
              >
                {(Object.entries(SORT_LABELS) as [SortBy, string][]).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={() => search()}
            disabled={loading}
            className="px-6 py-2 rounded-lg text-sm font-medium text-white transition-colors"
            style={{ background: loading ? "var(--muted)" : "var(--accent)" }}
          >
            {loading ? "조회 중..." : "🔍 조회"}
          </button>
        </div>

        {/* 로딩 */}
        {loading && (
          <div className="card text-center py-12 space-y-3">
            <div className="flex justify-center gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-full animate-bounce"
                  style={{ background: "var(--accent)", animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              전체 종목 데이터 조회 중... 최초 조회 시 30초 내외 소요됩니다
            </p>
          </div>
        )}

        {/* 결과 */}
        {!loading && searched && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                총 <span className="font-semibold" style={{ color: "var(--foreground)" }}>{total.toLocaleString()}</span>개 종목
                {" · "}상위 50개 표시
                {" · "}
                <span>{elapsed}초 소요</span>
              </p>
            </div>

            {results.length === 0 ? (
              <div className="card text-center py-10 text-sm" style={{ color: "var(--muted)" }}>
                조건에 맞는 종목이 없습니다
              </div>
            ) : (
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                      {["#", "종목명", "코드", "시장", "현재가", "등락률", "거래량", "PER", "PBR", ""].map((h) => (
                        <th key={h} className="text-left py-2 px-3 font-medium" style={{ color: "var(--muted)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => {
                      const isUp = r.change_pct >= 0;
                      return (
                        <tr
                          key={`${r.market_type}-${r.ticker}`}
                          style={{ borderBottom: "1px solid var(--card-border)" }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--card-alt, #1e293b10)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                        >
                          <td className="py-2.5 px-3 font-mono text-xs" style={{ color: "var(--muted)" }}>{i + 1}</td>
                          <td className="py-2.5 px-3 font-medium">{r.name}</td>
                          <td className="py-2.5 px-3 font-mono text-xs" style={{ color: "var(--muted)" }}>{r.ticker}</td>
                          <td className="py-2.5 px-3">
                            <span
                              className="text-xs px-1.5 py-0.5 rounded font-mono"
                              style={{ background: "#3b82f620", color: "#60a5fa" }}
                            >
                              {r.market_type}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono">{r.price.toLocaleString()}</td>
                          <td className={`py-2.5 px-3 font-medium font-mono ${isUp ? "positive" : "negative"}`}>
                            {isUp ? "▲" : "▼"} {Math.abs(r.change_pct).toFixed(2)}%
                          </td>
                          <td className="py-2.5 px-3 font-mono text-xs" style={{ color: "var(--muted)" }}>
                            {r.volume.toLocaleString()}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-xs" style={{ color: "var(--muted)" }}>
                            {r.per != null ? r.per : "-"}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-xs" style={{ color: "var(--muted)" }}>
                            {r.pbr != null ? r.pbr : "-"}
                          </td>
                          <td className="py-2.5 px-3">
                            <Link
                              href={`/stock?market=KR&ticker=${r.ticker}`}
                              className="text-xs transition-colors"
                              style={{ color: "var(--accent)" }}
                            >
                              분석 →
                            </Link>
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
