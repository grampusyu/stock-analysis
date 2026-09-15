"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { api, ShapeSearchResult } from "@/lib/api";

const CANVAS_W = 700;
const CANVAS_H = 260;
const SEND_POINTS = 60;
const HISTORY_KEY = "pattern_search_history";
const MAX_HISTORY = 10;

type RawPoint = { x: number; y: number };
type WindowOpt = 20 | 60 | 120;
type MarketFilter = "ALL" | "KOSPI" | "KOSDAQ";
type HistoryEntry = { id: string; points: number[]; window: WindowOpt; market: MarketFilter };

function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]"); } catch { return []; }
}

function resampleByX(points: RawPoint[], n: number): number[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const minX = sorted[0].x;
  const maxX = sorted[sorted.length - 1].x;
  if (maxX - minX < 1e-6) return Array(n).fill(sorted[0].y);

  const out: number[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const x = minX + ((maxX - minX) * i) / (n - 1);
    while (j < sorted.length - 2 && sorted[j + 1].x < x) j++;
    const p0 = sorted[j];
    const p1 = sorted[Math.min(j + 1, sorted.length - 1)];
    const t = p1.x === p0.x ? 0 : (x - p0.x) / (p1.x - p0.x);
    out.push(p0.y + (p1.y - p0.y) * t);
  }
  return out;
}

function Sparkline({ values, color = "var(--accent)" }: { values: number[]; color?: string }) {
  if (values.length < 2) return null;
  const w = 140;
  const h = 40;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

export default function PatternSearchPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const pointsRef = useRef<RawPoint[]>([]);

  const [hasDrawing, setHasDrawing] = useState(false);
  const [windowSel, setWindowSel] = useState<WindowOpt>(20);
  const [market, setMarket] = useState<MarketFilter>("ALL");
  const [results, setResults] = useState<ShapeSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => { setHistory(loadHistory()); }, []);

  const ctx = () => canvasRef.current?.getContext("2d") ?? null;

  const clearCanvas = () => {
    const c = ctx();
    if (c) c.clearRect(0, 0, CANVAS_W, CANVAS_H);
  };

  const drawPolyline = (values: number[]) => {
    const c = ctx();
    if (!c || values.length < 2) return;
    clearCanvas();
    c.strokeStyle = "#60a5fa";
    c.lineWidth = 2.5;
    c.lineJoin = "round";
    c.lineCap = "round";
    c.beginPath();
    values.forEach((v, i) => {
      const x = (i / (values.length - 1)) * CANVAS_W;
      const y = CANVAS_H - v;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    });
    c.stroke();
  };

  const saveToHistory = (points: number[], win: WindowOpt, mkt: MarketFilter) => {
    const entry: HistoryEntry = { id: `${Date.now()}`, points, window: win, market: mkt };
    const next = [entry, ...loadHistory()].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    setHistory(next);
  };

  const removeFromHistory = (id: string) => {
    const next = loadHistory().filter((h) => h.id !== id);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    setHistory(next);
  };

  const clearHistory = () => {
    localStorage.removeItem(HISTORY_KEY);
    setHistory([]);
  };

  const reset = () => {
    clearCanvas();
    pointsRef.current = [];
    setHasDrawing(false);
    setResults([]);
    setSearched(false);
  };

  const posFromEvent = (e: React.MouseEvent | React.TouchEvent): RawPoint => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    const clientX = "touches" in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    reset();
    drawingRef.current = true;
    const p = posFromEvent(e);
    pointsRef.current = [p];
    const c = ctx();
    if (c) {
      c.strokeStyle = "#60a5fa";
      c.lineWidth = 2.5;
      c.lineJoin = "round";
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(p.x, p.y);
    }
  };

  const moveDraw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const p = posFromEvent(e);
    pointsRef.current.push(p);
    const c = ctx();
    if (c) {
      c.lineTo(p.x, p.y);
      c.stroke();
    }
  };

  const endDraw = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    setHasDrawing(pointsRef.current.length >= 2);
  };

  const runSearch = async (points: number[], win: WindowOpt, mkt: MarketFilter) => {
    setLoading(true);
    setSearched(false);
    try {
      const data = await api.searchShape(points, win, mkt, 20);
      setResults(data.results ?? []);
      setTotal(data.total ?? 0);
      setSearched(true);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const search = async () => {
    if (pointsRef.current.length < 2) return;
    // 캔버스 y는 아래로 갈수록 커지므로 반전(위로 그린 구간 = 높은 값)
    const rawValues = resampleByX(pointsRef.current, SEND_POINTS).map((y) => CANVAS_H - y);
    saveToHistory(rawValues, windowSel, market);
    await runSearch(rawValues, windowSel, market);
  };

  const restoreFromHistory = async (entry: HistoryEntry) => {
    reset();
    pointsRef.current = entry.points.map((v, i) => ({
      x: (i / (entry.points.length - 1)) * CANVAS_W,
      y: CANVAS_H - v,
    }));
    drawPolyline(entry.points);
    setHasDrawing(true);
    setWindowSel(entry.window);
    setMarket(entry.market);
    await runSearch(entry.points, entry.window, entry.market);
  };

  return (
    <>
      <Navbar />
      <main className="p-6 space-y-6 max-w-5xl mx-auto w-full">
        <div>
          <h1 className="text-2xl font-bold">패턴 검색</h1>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            원하는 가격 흐름 모양을 캔버스에 그리면, 최근 종가 흐름이 비슷한 종목을 찾아드립니다
          </p>
          <p className="text-xs mt-2 rounded-lg px-3 py-2" style={{ background: "#f59e0b1a", color: "#f59e0b" }}>
            ⚠️ 모양 유사도만 계산하는 참고용 도구입니다. 매매 신호가 아닙니다.
          </p>
        </div>

        <div className="card space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4">
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: "var(--muted)" }}>비교 기간</label>
                <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--card-border)" }}>
                  {([20, 60, 120] as WindowOpt[]).map((w) => (
                    <button
                      key={w}
                      onClick={() => setWindowSel(w)}
                      className="px-3 py-1.5 text-xs font-medium transition-colors"
                      style={{
                        background: windowSel === w ? "var(--accent)" : "transparent",
                        color: windowSel === w ? "#fff" : "var(--muted)",
                      }}
                    >
                      {w}일
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: "var(--muted)" }}>시장</label>
                <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--card-border)" }}>
                  {(["ALL", "KOSPI", "KOSDAQ"] as MarketFilter[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMarket(m)}
                      className="px-3 py-1.5 text-xs font-medium transition-colors"
                      style={{
                        background: market === m ? "var(--accent)" : "transparent",
                        color: market === m ? "#fff" : "var(--muted)",
                      }}
                    >
                      {m === "ALL" ? "전체" : m}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button
              onClick={reset}
              className="text-xs px-3 py-1.5 rounded-lg transition-colors"
              style={{ color: "var(--muted)", border: "1px solid var(--card-border)" }}
            >
              지우기
            </button>
          </div>

          <div
            className="rounded-lg overflow-hidden relative"
            style={{ border: "1px solid var(--card-border)", background: "#0f172a" }}
          >
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              className="w-full block cursor-crosshair touch-none"
              style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
              onMouseDown={startDraw}
              onMouseMove={moveDraw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              onTouchStart={startDraw}
              onTouchMove={moveDraw}
              onTouchEnd={endDraw}
            />
            {!hasDrawing && (
              <div
                className="absolute inset-0 flex items-center justify-center text-sm pointer-events-none"
                style={{ color: "var(--muted)" }}
              >
                여기에 마우스로 가격 흐름 모양을 그려보세요 (왼쪽=과거 → 오른쪽=최근)
              </div>
            )}
          </div>

          <button
            onClick={search}
            disabled={!hasDrawing || loading}
            className="px-6 py-2 rounded-lg text-sm font-medium text-white transition-colors"
            style={{ background: !hasDrawing || loading ? "var(--muted)" : "var(--accent)" }}
          >
            {loading ? "검색 중..." : "🔍 비슷한 종목 검색"}
          </button>
        </div>

        {history.length > 0 && (
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">최근 그림 ({history.length}/{MAX_HISTORY})</p>
              <button
                onClick={clearHistory}
                className="text-xs px-2 py-1 rounded-lg transition-colors"
                style={{ color: "var(--muted)", border: "1px solid var(--card-border)" }}
              >
                전체 삭제
              </button>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="relative shrink-0 rounded-lg overflow-hidden cursor-pointer group"
                  style={{ border: "1px solid var(--card-border)", background: "#0f172a" }}
                  onClick={() => restoreFromHistory(h)}
                  title={`${h.window}일 · ${h.market === "ALL" ? "전체" : h.market}`}
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFromHistory(h.id); }}
                    className="absolute top-1 right-1 w-4 h-4 rounded-full text-[10px] leading-4 text-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                    style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}
                  >
                    ×
                  </button>
                  <div className="p-2">
                    <Sparkline values={h.points} />
                  </div>
                  <div className="px-2 pb-1.5 text-[10px]" style={{ color: "var(--muted)" }}>
                    {h.window}일 · {h.market === "ALL" ? "전체" : h.market}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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
          </div>
        )}

        {!loading && searched && (
          <div className="card space-y-4">
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              비교 대상 <span className="font-semibold" style={{ color: "var(--foreground)" }}>{total.toLocaleString()}</span>개 종목 중 상위 {results.length}개
            </p>
            {results.length === 0 ? (
              <div className="text-center py-10 text-sm" style={{ color: "var(--muted)" }}>
                비교할 데이터가 없습니다. 매일 오전 7시 자동 생성됩니다.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                      {["#", "종목명", "코드", "시장", `최근 ${windowSel}일 추이`, "유사도(거리)", ""].map((h) => (
                        <th key={h} className="text-left py-2 px-3 font-medium" style={{ color: "var(--muted)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={`${r.market}-${r.code}`} style={{ borderBottom: "1px solid var(--card-border)" }}>
                        <td className="py-2.5 px-3 font-mono text-xs" style={{ color: "var(--muted)" }}>{i + 1}</td>
                        <td className="py-2.5 px-3 font-medium">{r.name}</td>
                        <td className="py-2.5 px-3 font-mono text-xs" style={{ color: "var(--muted)" }}>{r.code}</td>
                        <td className="py-2.5 px-3">
                          <span className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ background: "#3b82f620", color: "#60a5fa" }}>
                            {r.market}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <Sparkline values={r.preview} />
                        </td>
                        <td className="py-2.5 px-3 font-mono text-xs" style={{ color: "var(--muted)" }}>
                          {r.distance.toFixed(3)}
                        </td>
                        <td className="py-2.5 px-3">
                          <Link href={`/stock?market=KR&ticker=${r.code}`} className="text-xs transition-colors" style={{ color: "var(--accent)" }}>
                            분석 →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );
}
