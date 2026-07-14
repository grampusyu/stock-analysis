"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";

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

const fmt = (v: number) => {
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(1)}억`;
  return `${(v / 1e4).toFixed(0)}만`;
};

export default function FundFlowChart({ data }: Props) {
  if (!data || data.length === 0) return <p className="muted text-sm">데이터 없음</p>;

  const formatted = data.map((d) => ({
    date: (d.index || d.날짜 || "").toString().slice(0, 10),
    개인: Number(d["개인"] ?? 0),
    외국인: Number(d["외국인합계"] ?? 0),
    기관: Number(d["기관합계"] ?? 0),
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={formatted} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} />
        <YAxis tickFormatter={fmt} tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ background: "#1a1f2e", border: "1px solid #2d3748", borderRadius: 8 }}
          formatter={(v: unknown) => fmt(Number(v ?? 0))}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <ReferenceLine y={0} stroke="#2d3748" />
        <Bar dataKey="개인" fill="#3b82f6" radius={[2, 2, 0, 0]} />
        <Bar dataKey="외국인" fill="#10b981" radius={[2, 2, 0, 0]} />
        <Bar dataKey="기관" fill="#f59e0b" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
