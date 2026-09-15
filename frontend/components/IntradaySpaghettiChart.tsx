"use client";
import { useState } from "react";
import { ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { IntradayHourStat, IntradayDailySeries } from "@/lib/api";

interface Props {
  hours: IntradayHourStat[];
  dailySeries: IntradayDailySeries[];
}

const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const Y_MIN = -10;
const Y_MAX = 10;
const clamp = (v: number | null) => (v === null ? null : Math.min(Y_MAX, Math.max(Y_MIN, v)));

function ChartTooltip({ active, payload, label, selectedDate }: { active?: boolean; payload?: { payload: Record<string, number | null | string> }[]; label?: string; selectedDate: string | null }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const avg = row.avg as number;
  const selectedVal = selectedDate ? (row[selectedDate] as number | null) : null;
  return (
    <div style={{ background: "#1a1f2e", border: "1px solid #2d3748", borderRadius: 8, padding: "6px 10px", fontSize: 12 }}>
      <div style={{ color: "#94a3b8" }}>{label}</div>
      <div style={{ color: "#e2e8f0", fontWeight: 600 }}>평균 {fmtPct(avg)}</div>
      {selectedDate && selectedVal != null && (
        <div style={{ color: "#ef4444", fontWeight: 600 }}>{selectedDate} {fmtPct(selectedVal)}</div>
      )}
      {!selectedDate && <div style={{ color: "#64748b", fontSize: 10 }}>얇은 선 = 개별 거래일 (아래에서 날짜 선택 가능)</div>}
    </div>
  );
}

export default function IntradaySpaghettiChart({ hours, dailySeries }: Props) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  if (!hours.length || !dailySeries.length) return <p className="muted text-sm">데이터 없음</p>;

  const avgByHour = hours.map((h) => clamp(h.avg_pct));
  const data = hours.map((h, i) => {
    const row: Record<string, number | null | string> = { hour: h.hour, avg: avgByHour[i] };
    dailySeries.forEach((d) => {
      row[d.date] = clamp(d.values[i]);
    });
    return row;
  });

  const otherSeries = dailySeries.filter((d) => d.date !== selectedDate);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-xs" style={{ color: "var(--muted)" }}>날짜 선택:</label>
        <select
          value={selectedDate ?? ""}
          onChange={(e) => setSelectedDate(e.target.value || null)}
          className="text-xs rounded px-2 py-1"
          style={{ background: "var(--card)", border: "1px solid var(--card-border)", color: "var(--foreground)" }}
        >
          <option value="">선택 안 함</option>
          {dailySeries.map((d) => (
            <option key={d.date} value={d.date}>{d.date}</option>
          ))}
        </select>
        {selectedDate && (
          <button
            onClick={() => setSelectedDate(null)}
            className="text-xs transition-colors"
            style={{ color: "var(--accent)" }}
          >
            해제
          </button>
        )}
      </div>

      <ResponsiveContainer width="100%" height={480}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="hour"
            tick={{ fill: "#64748b", fontSize: 11 }}
            tickLine={false}
            interval="preserveStartEnd"
            tickFormatter={(v: string) => (v.endsWith(":00") ? v : "")}
          />
          <YAxis
            domain={[Y_MIN, Y_MAX]}
            tickFormatter={fmtPct}
            tick={{ fill: "#64748b", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={64}
          />
          <Tooltip content={<ChartTooltip selectedDate={selectedDate} />} />
          <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
          {otherSeries.map((d) => (
            <Line
              key={d.date}
              type="monotone"
              dataKey={d.date}
              stroke="#94a3b8"
              strokeWidth={1}
              strokeOpacity={selectedDate ? 0.08 : 0.18}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ))}
          <Line type="monotone" dataKey="avg" stroke="#3b82f6" strokeWidth={2.5} dot={false} isAnimationActive={false} />
          {selectedDate && (
            <Line
              type="monotone"
              dataKey={selectedDate}
              stroke="#ef4444"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
