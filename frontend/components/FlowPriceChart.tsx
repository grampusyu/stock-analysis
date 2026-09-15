"use client";
import { useState } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";

const SERIES = [
  { key: "close", label: "종가", color: "#facc15" },
  { key: "외국인", label: "외국인 순매수(증가량)", color: "#10b981" },
  { key: "기관", label: "기관 순매수(증가량)", color: "#f59e0b" },
  { key: "평균", label: "외국인+기관 평균(증가량)", color: "#a855f7" },
  { key: "외국인미분", label: "외국인 미분(증가량의 변화)", color: "#34d399" },
  { key: "기관미분", label: "기관 미분(증가량의 변화)", color: "#fbbf24" },
  { key: "외국인누적", label: "외국인 누적", color: "#0ea5e9" },
  { key: "기관누적", label: "기관 누적", color: "#ec4899" },
  { key: "누적평균", label: "외국인+기관 누적 평균", color: "#c084fc" },
] as const;
type SeriesKey = (typeof SERIES)[number]["key"];

interface FundRecord {
  index?: string;
  날짜?: string;
  외국인합계?: number;
  기관합계?: number;
  [key: string]: unknown;
}

interface PriceRecord {
  date: string;
  close: number;
}

interface Props {
  priceData: PriceRecord[];
  flowData: FundRecord[];
}

const fmtFlow = (v: number) => {
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(1)}억원`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(0)}만원`;
  return `${v.toFixed(0)}원`;
};

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? null : num / denom;
}

export default function FlowPriceChart({ priceData, flowData }: Props) {
  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>({
    close: true, 외국인: true, 기관: true, 평균: true, 외국인미분: true, 기관미분: true,
    외국인누적: true, 기관누적: true, 누적평균: true,
  });

  if (!flowData || flowData.length === 0) return <p className="muted text-sm">데이터 없음</p>;

  const toggle = (key: SeriesKey) =>
    setVisible((prev) => ({ ...prev, [key]: !prev[key] }));

  const priceByDate = new Map(priceData.map((d) => [d.date, d.close]));

  const sortedFlow = [...flowData].sort((a, b) => {
    const da = (a.index || a.날짜 || "").toString();
    const db = (b.index || b.날짜 || "").toString();
    return da.localeCompare(db);
  });

  const merged: {
    date: string; close: number | null;
    외국인: number; 기관: number; 평균: number;
    외국인미분: number | null; 기관미분: number | null;
    외국인누적: number; 기관누적: number; 누적평균: number;
  }[] = [];

  let prevForeign: number | null = null;
  let prevInst: number | null = null;
  let cumForeign = 0;
  let cumInst = 0;
  for (const d of sortedFlow) {
    const date = (d.index || d.날짜 || "").toString().slice(0, 10);
    const foreign = Number(d["외국인합계"] ?? 0);
    const inst = Number(d["기관합계"] ?? 0);
    const total = (foreign + inst) / 2;
    cumForeign += foreign;
    cumInst += inst;
    merged.push({
      date,
      close: priceByDate.get(date) ?? null,
      외국인: foreign,
      기관: inst,
      평균: total,
      외국인미분: prevForeign === null ? null : foreign - prevForeign,
      기관미분: prevInst === null ? null : inst - prevInst,
      외국인누적: cumForeign,
      기관누적: cumInst,
      누적평균: (cumForeign + cumInst) / 2,
    });
    prevForeign = foreign;
    prevInst = inst;
  }

  // 상관계수: 가격 데이터가 존재하는 연속 구간만으로 일간 수익률 vs 당일 순매매 비교
  const matched = merged.filter((d) => d.close !== null) as (typeof merged[number] & { close: number })[];
  const returns: number[] = [];
  const foreignAtRet: number[] = [];
  const instAtRet: number[] = [];
  const totalAtRet: number[] = [];
  for (let i = 1; i < matched.length; i++) {
    const prev = matched[i - 1].close;
    if (!prev) continue;
    returns.push((matched[i].close - prev) / prev);
    foreignAtRet.push(matched[i].외국인);
    instAtRet.push(matched[i].기관);
    totalAtRet.push(matched[i].평균);
  }
  const rForeign = pearson(returns, foreignAtRet);
  const rInst = pearson(returns, instAtRet);
  const rTotal = pearson(returns, totalAtRet);

  const hasPrice = matched.length > 0;

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-2">
        {SERIES.map((s) => (
          <label key={s.key} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={visible[s.key]}
              onChange={() => toggle(s.key)}
              className="cursor-pointer"
            />
            <span style={{ color: s.color }}>{s.label}</span>
          </label>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={merged} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} />
          <YAxis
            yAxisId="price"
            orientation="left"
            domain={["auto", "auto"]}
            tick={{ fill: "#facc15", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => v.toLocaleString()}
          />
          <YAxis
            yAxisId="flow"
            orientation="right"
            tick={{ fill: "#64748b", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={fmtFlow}
          />
          <Tooltip
            contentStyle={{ background: "#1a1f2e", border: "1px solid #2d3748", borderRadius: 8 }}
            formatter={(v: unknown, name?: unknown) =>
              name === "종가" ? Number(v ?? 0).toLocaleString() : fmtFlow(Number(v ?? 0))
            }
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine yAxisId="flow" y={0} stroke="#2d3748" />
          {hasPrice && visible.close && (
            <Line yAxisId="price" type="monotone" dataKey="close" name="종가" stroke="#facc15" strokeWidth={3} dot={false} connectNulls />
          )}
          {visible.외국인 && (
            <Line yAxisId="flow" type="monotone" dataKey="외국인" name="외국인 순매수(증가량)" stroke="#10b981" strokeWidth={2} dot={false} />
          )}
          {visible.기관 && (
            <Line yAxisId="flow" type="monotone" dataKey="기관" name="기관 순매수(증가량)" stroke="#f59e0b" strokeWidth={2} dot={false} />
          )}
          {visible.평균 && (
            <Line yAxisId="flow" type="monotone" dataKey="평균" name="외국인+기관 평균(증가량)" stroke="#a855f7" strokeWidth={2} strokeDasharray="4 2" dot={false} />
          )}
          {visible.외국인미분 && (
            <Line yAxisId="flow" type="monotone" dataKey="외국인미분" name="외국인 미분(증가량의 변화)" stroke="#34d399" strokeWidth={1.5} strokeDasharray="2 2" dot={false} connectNulls />
          )}
          {visible.기관미분 && (
            <Line yAxisId="flow" type="monotone" dataKey="기관미분" name="기관 미분(증가량의 변화)" stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="2 2" dot={false} connectNulls />
          )}
          {visible.외국인누적 && (
            <Line yAxisId="flow" type="monotone" dataKey="외국인누적" name="외국인 누적" stroke="#0ea5e9" strokeWidth={2} dot={false} />
          )}
          {visible.기관누적 && (
            <Line yAxisId="flow" type="monotone" dataKey="기관누적" name="기관 누적" stroke="#ec4899" strokeWidth={2} dot={false} />
          )}
          {visible.누적평균 && (
            <Line yAxisId="flow" type="monotone" dataKey="누적평균" name="외국인+기관 누적 평균" stroke="#c084fc" strokeWidth={2} strokeDasharray="4 2" dot={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      <div className="text-[11px] text-right pr-2 muted space-y-0.5 mt-1">
        {hasPrice ? (
          <p>
            일간 상관계수(참고용, 예측 아님): 외국인 r=
            {rForeign === null ? "N/A" : rForeign.toFixed(3)} · 기관 r=
            {rInst === null ? "N/A" : rInst.toFixed(3)} · 평균 r=
            {rTotal === null ? "N/A" : rTotal.toFixed(3)} (vs 당일 수익률)
          </p>
        ) : (
          <p>이 기간의 가격 데이터가 없어 상관계수를 계산할 수 없습니다.</p>
        )}
        <p>※ 전종목 대규모 분석 결과 수급이 향후 주가를 예측하는 효과는 거의 없음(r≈0)으로 확인됨 — 위 수치는 이 종목의 동시적 관찰용 참고 지표입니다.</p>
      </div>
    </div>
  );
}
