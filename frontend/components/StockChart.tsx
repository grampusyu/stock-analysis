"use client";
import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  IChartApi,
  CandlestickSeries,
  HistogramSeries,
} from "lightweight-charts";
import type { OHLCVRecord } from "@/lib/api";

interface Props {
  data: OHLCVRecord[];
  height?: number;
  priceFormatter?: (price: number) => string;
  market?: string;
}

export default function StockChart({ data, height = 400, priceFormatter, market }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!ref.current || data.length === 0) return;

    if (chartRef.current) {
      try { chartRef.current.remove(); } catch { /* already disposed */ }
      chartRef.current = null;
    }

    const chart = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: "#1a1f2e" }, textColor: "#94a3b8" },
      grid: { vertLines: { color: "#2d3748" }, horzLines: { color: "#2d3748" } },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: "#2d3748" },
      timeScale: { borderColor: "#2d3748", timeVisible: true },
      localization: priceFormatter ? { priceFormatter } : undefined,
      width: ref.current.clientWidth,
      height,
    });

    chartRef.current = chart;

    // 한국: 빨강=상승, 파랑=하락 / 미국: 초록=상승, 빨강=하락
    const upColor   = market === "KR" ? "#ef4444" : "#10b981";
    const downColor = market === "KR" ? "#3b82f6" : "#ef4444";

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor,
      downColor,
      borderUpColor: upColor,
      borderDownColor: downColor,
      wickUpColor: upColor,
      wickDownColor: downColor,
    });

    candleSeries.setData(
      data.map((d) => ({
        time: d.date as string,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }))
    );

    const volSeries = chart.addSeries(HistogramSeries, {
      color: "#3b82f680",
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volSeries.setData(data.map((d) => ({ time: d.date as string, value: d.volume })));

    chart.timeScale().fitContent();

    const observer = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth });
    });
    observer.observe(ref.current);

    return () => {
      observer.disconnect();
      try { chart.remove(); } catch { /* already disposed */ }
      chartRef.current = null;
    };
  }, [data]);

  return <div ref={ref} className="w-full" />;
}
