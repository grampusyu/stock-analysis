"use client";
import { useEffect, useRef } from "react";
import { createChart, ColorType, CrosshairMode, AreaSeries } from "lightweight-charts";
import type { OHLCVRecord } from "@/lib/api";

interface Props {
  data: OHLCVRecord[];
  height?: number;
  market?: string;
}

export default function MiniSparkChart({ data, height = 110, market }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || data.length === 0) return;

    const lastClose  = data[data.length - 1].close;
    const firstClose = data[0].close;
    const isUp = lastClose >= firstClose;
    // KR: 빨강=상승, 파랑=하락 / US: 초록=상승, 빨강=하락
    const color = market === "US"
      ? (isUp ? "#10b981" : "#ef4444")
      : (isUp ? "#ef4444" : "#3b82f6");

    const chart = createChart(ref.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "transparent",
      },
      grid:       { vertLines: { visible: false }, horzLines: { visible: false } },
      crosshair:  { mode: CrosshairMode.Hidden },
      rightPriceScale: { visible: false },
      leftPriceScale:  { visible: false },
      timeScale:  { visible: false, borderVisible: false },
      watermark:    { visible: false },
      handleScroll: false,
      handleScale:  false,
      width:  ref.current.clientWidth,
      height,
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor:   color,
      topColor:    color + "33",
      bottomColor: color + "00",
      lineWidth:   2,
      priceLineVisible:      false,
      lastValueVisible:      false,
      crosshairMarkerVisible: false,
    });

    series.setData(data.map((d) => ({ time: d.date as string, value: d.close })));
    chart.timeScale().fitContent();

    const observer = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth });
    });
    observer.observe(ref.current);

    return () => {
      observer.disconnect();
      try { chart.remove(); } catch { /* already disposed */ }
    };
  }, [data, height]);

  return <div ref={ref} className="w-full [&_a]:!hidden" />;
}
