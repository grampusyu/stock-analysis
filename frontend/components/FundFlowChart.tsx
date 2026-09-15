"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";

interface FundRecord {
  index?: string;
  날짜?: string;
  개인?: number;
  외국인합계?: number;
  기관합계?: number;
  [key: string]: unknown;
}

interface Props {
  data: FundRecord[];
}

// KRX 투자자별 매매동향 기준 순매매 "금액"(원)
const fmt = (v: number) => {
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(1)}억원`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(0)}만원`;
  return `${v.toFixed(0)}원`;
};

// 일반적인 종목은 이 범위(±100억원)로 축을 고정해 종목 간 비교가 쉽도록 하고,
// 이 범위를 벗어나는 대형주나 지나치게 작은 초소형주는 실제 변동폭에 맞춘
// 동적 범위로 전환한다. 두 경우를 축 글자색으로 구분해 표시.
// (임시 기준값 — 실데이터 확인 후 조정 필요할 수 있음)
const STATIC_DOMAIN = 10_000_000_000;
const LOW_VOLUME_RATIO = 0.1; // 정적 범위의 10% 미만이면 그래프가 거의 안 보여 동적 전환
const STATIC_AXIS_COLOR = "#64748b";
const HIGH_VOLUME_AXIS_COLOR = "#ef4444"; // 대형주(범위 초과)
const LOW_VOLUME_AXIS_COLOR = "#a855f7"; // 초소형주(범위 미달)

export default function FundFlowChart({ data }: Props) {
  if (!data || data.length === 0) return <p className="muted text-sm">데이터 없음</p>;

  const formatted = data.map((d) => ({
    date: (d.index || d.날짜 || "").toString().slice(0, 10),
    개인: Number(d["개인"] ?? 0),
    외국인: Number(d["외국인합계"] ?? 0),
    기관: Number(d["기관합계"] ?? 0),
  }));

  const maxAbs = Math.max(
    ...formatted.map((d) => Math.max(Math.abs(d.개인), Math.abs(d.외국인), Math.abs(d.기관)))
  );
  const isHigh = maxAbs > STATIC_DOMAIN;
  const isLow = maxAbs > 0 && maxAbs < STATIC_DOMAIN * LOW_VOLUME_RATIO;
  const isDynamic = isHigh || isLow;
  const domain: [number, number] = isDynamic
    ? [-maxAbs * 1.1, maxAbs * 1.1]
    : [-STATIC_DOMAIN, STATIC_DOMAIN];
  const axisColor = isHigh ? HIGH_VOLUME_AXIS_COLOR : isLow ? LOW_VOLUME_AXIS_COLOR : STATIC_AXIS_COLOR;

  return (
    <div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={formatted} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} />
          <YAxis
            domain={domain}
            tickFormatter={fmt}
            tick={{ fill: axisColor, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{ background: "#1a1f2e", border: "1px solid #2d3748", borderRadius: 8 }}
            formatter={(v: unknown) => fmt(Number(v ?? 0))}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine y={0} stroke="#2d3748" />
          <Line type="monotone" dataKey="개인" stroke="#3b82f6" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="외국인" stroke="#10b981" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="기관" stroke="#f59e0b" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-right pr-2" style={{ color: axisColor }}>
        {isHigh
          ? "● 동적 축 (대형주 - 변동폭 기준)"
          : isLow
          ? "● 동적 축 (초소형주 - 변동폭 기준)"
          : "● 고정 축 (±100억원)"}
      </p>
    </div>
  );
}
