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

// KRX 투자자별 매매동향 기준 순매매 "수량"(주)
const fmt = (v: number) => {
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(1)}억주`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(0)}만주`;
  return `${v.toFixed(0)}주`;
};

// 종목을 순매매 수량 변동폭 기준 소형/중형/대형 3단계로 나눈다. 중형(5만~15만주)만
// 축을 ±15만주로 고정해 종목 간 비교가 쉽도록 하고, 그 밖(소형/대형)은 실제
// 변동폭에 맞춘 동적 범위로 전환한다. 세 경우를 축 글자색으로 구분해 표시.
const MID_MIN_VOLUME = 50_000; // 소형/중형 경계
const MID_MAX_VOLUME = 150_000; // 중형/대형 경계 (중형 고정 축 범위이기도 함)
const STATIC_AXIS_COLOR = "#64748b";
const HIGH_VOLUME_AXIS_COLOR = "#ef4444"; // 대형주(범위 초과)
const LOW_VOLUME_AXIS_COLOR = "#a855f7"; // 소형주(범위 미달)

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
  const isHigh = maxAbs > MID_MAX_VOLUME;
  const isLow = maxAbs > 0 && maxAbs < MID_MIN_VOLUME;
  const isDynamic = isHigh || isLow;
  const domain: [number, number] = isDynamic
    ? [-maxAbs * 1.1, maxAbs * 1.1]
    : [-MID_MAX_VOLUME, MID_MAX_VOLUME];
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
          ? "● 동적 축 (소형주 - 변동폭 기준)"
          : "● 고정 축 (중형주 ±15만주)"}
      </p>
    </div>
  );
}
