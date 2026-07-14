"use client";
import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { FinancialData, CompanyOverview } from "@/lib/api";

type Tab = "overview" | "ratios" | "income" | "balance" | "cashflow";

const TAB_LABELS: Record<Tab, string> = {
  overview: "기업개요",
  ratios: "핵심지표",
  income: "손익계산서",
  balance: "재무상태표",
  cashflow: "현금흐름표",
};

function toChartRows(
  years: string[],
  series: Record<string, Record<string, number | null>>,
): Record<string, number | string>[] {
  return years.map((y) => {
    const row: Record<string, number | string> = { year: y };
    for (const [key, vals] of Object.entries(series)) {
      row[key] = vals[y] ?? 0;
    }
    return row;
  });
}

function fmt(v: number | null | undefined, suffix = "") {
  if (v == null) return "N/A";
  return `${v.toLocaleString()}${suffix}`;
}

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444"];

export default function FinancialsPanel({
  data,
  overview,
  overviewLoading,
}: {
  data?: FinancialData | null;
  overview?: CompanyOverview | null;
  overviewLoading?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("overview");

  const years = data ? Object.keys(data.income.revenue).sort() : [];
  const unit = data?.unit ?? "";
  const curr = data?.currency === "USD" ? "$" : "₩";

  const incomeRows = data ? toChartRows(years, {
    "매출액": data.income.revenue,
    "영업이익": data.income.operating_income,
    "순이익": data.income.net_income,
  }) : [];

  const balanceRows = data ? toChartRows(years, {
    "자산총계": data.balance.total_assets,
    "부채총계": data.balance.total_liabilities,
    "자본총계": data.balance.equity,
  }) : [];

  const cashflowRows = data ? toChartRows(years, {
    "영업활동": data.cashflow.operating,
    "투자활동": data.cashflow.investing,
    "재무활동": data.cashflow.financing,
  }) : [];

  const r = data?.ratios;
  const ratioCards = r ? [
    { label: "PER", value: fmt(r.per, "배") },
    { label: "PBR", value: fmt(r.pbr, "배") },
    { label: "ROE", value: fmt(r.roe, "%") },
    { label: "ROA", value: fmt(r.roa, "%") },
    { label: "EPS", value: r.eps != null ? `${curr}${r.eps.toLocaleString()}` : "N/A" },
    { label: "배당수익률", value: fmt(r.dividend_yield, "%") },
  ] : [];

  const visibleTabs = (Object.keys(TAB_LABELS) as Tab[]).filter(
    (t) => t === "overview" || data != null
  );

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">재무제표 분석</h2>
        <span className="text-xs muted">(단위: {unit})</span>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 flex-wrap">
        {visibleTabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-3 py-1.5 text-xs rounded-lg transition-colors"
            style={{
              background: tab === t ? "var(--accent)" : "var(--card)",
              border: "1px solid var(--card-border)",
              color: tab === t ? "#fff" : "var(--muted)",
            }}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* 기업개요 */}
      {tab === "overview" && (
        <div className="space-y-4">
          {overviewLoading ? (
            <p className="text-sm muted animate-pulse">기업 정보를 분석 중입니다...</p>
          ) : overview?.error ? (
            <div className="space-y-1">
              <p className="text-sm muted">{overview.error}</p>
              {overview.error.includes("GEMINI_API_KEY") && (
                <p className="text-xs muted">
                  Google AI Studio(<code>aistudio.google.com/apikey</code>)에서 무료 발급 후{" "}
                  backend <code>.env</code> 파일에 <code>GEMINI_API_KEY=키</code> 를 설정하세요.
                </p>
              )}
            </div>
          ) : overview ? (
            <>
              {/* 섹터 배지 */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium px-2.5 py-1 rounded-full"
                  style={{ background: "var(--accent)22", color: "var(--accent)", border: "1px solid var(--accent)44" }}>
                  {overview.sector}
                </span>
              </div>

              {/* 회사 설명 */}
              {overview.description && (
                <div className="rounded-xl p-4 space-y-1.5" style={{ background: "var(--card-alt, #1e293b)" }}>
                  <p className="text-xs font-semibold muted uppercase tracking-wide">회사 소개</p>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--foreground)" }}>
                    {overview.description}
                  </p>
                </div>
              )}

              {/* 전망 */}
              {overview.outlook && (
                <div className="rounded-xl p-4 space-y-1.5" style={{ background: "var(--card-alt, #1e293b)" }}>
                  <p className="text-xs font-semibold muted uppercase tracking-wide">전망</p>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--foreground)" }}>
                    {overview.outlook}
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm muted">기업 개요를 불러오는 중입니다...</p>
          )}
        </div>
      )}

      {/* 핵심지표 */}
      {tab === "ratios" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {ratioCards.map(({ label, value }) => (
            <div key={label} className="rounded-lg p-3" style={{ background: "var(--card-alt, #1e293b)" }}>
              <p className="text-xs muted mb-1">{label}</p>
              <p className="text-base font-bold font-mono">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* 손익계산서 */}
      {tab === "income" && (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={incomeRows} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v.toLocaleString()} />
            <Tooltip formatter={(v) => [`${Number(v).toLocaleString()} ${unit}`]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {["매출액", "영업이익", "순이익"].map((k, i) => (
              <Bar key={k} dataKey={k} fill={COLORS[i]} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}

      {/* 재무상태표 */}
      {tab === "balance" && (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={balanceRows} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v.toLocaleString()} />
            <Tooltip formatter={(v) => [`${Number(v).toLocaleString()} ${unit}`]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {["자산총계", "부채총계", "자본총계"].map((k, i) => (
              <Bar key={k} dataKey={k} fill={COLORS[i]} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}

      {/* 현금흐름표 */}
      {tab === "cashflow" && (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={cashflowRows} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v.toLocaleString()} />
            <Tooltip formatter={(v) => [`${Number(v).toLocaleString()} ${unit}`]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {["영업활동", "투자활동", "재무활동"].map((k, i) => (
              <Bar key={k} dataKey={k} fill={COLORS[i]} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
