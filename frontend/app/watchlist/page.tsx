"use client";
import { Fragment, useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { api, Market, API_BASE, NGROK_HEADER } from "@/lib/api";
import type { OHLCVRecord } from "@/lib/api";

const MiniSparkChart = dynamic(() => import("@/components/MiniSparkChart"), { ssr: false });

const CHART_PERIODS = [
  { value: "1m", label: "1개월" },
  { value: "3m", label: "3개월" },
  { value: "6m", label: "6개월" },
  { value: "1y", label: "1년" },
] as const;
type ChartPeriod = typeof CHART_PERIODS[number]["value"];

interface WatchItem {
  market: Market;
  ticker: string;
  name?: string;
  price?: number;
  change_pct?: number;
  volume?: number;
  added_at?: string;
}

interface SentimentArticle {
  title: string;
  url: string;
  source: string;
  published: string;
  sentiment: "긍정" | "중립" | "부정";
  reason: string;
}

interface SentimentResult {
  overall: "긍정" | "중립" | "부정";
  counts: { 긍정: number; 중립: number; 부정: number };
  articles: SentimentArticle[];
}

const SENTIMENT_COLOR: Record<string, { bg: string; text: string }> = {
  긍정: { bg: "#10b98120", text: "#10b981" },
  중립: { bg: "#64748b20", text: "#94a3b8" },
  부정: { bg: "#ef444420", text: "#ef4444" },
};

const SENTIMENT_ICON: Record<string, string> = {
  긍정: "😊",
  중립: "😐",
  부정: "😞",
};

const getColor = (s: string) => SENTIMENT_COLOR[s] ?? SENTIMENT_COLOR["중립"];
const getIcon  = (s: string) => SENTIMENT_ICON[s]  ?? "😐";

function isValidSentiment(data: unknown): data is SentimentResult {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return typeof d.overall === "string" && d.counts != null && Array.isArray(d.articles);
}

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [market, setMarket] = useState<Market>("KR");
  const [input, setInput] = useState("");
  const [displayValue, setDisplayValue] = useState("");
  const [suggestions, setSuggestions] = useState<{ ticker: string; name: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [adding, setAdding] = useState(false);

  // 감성 분석: ticker → 결과 or "loading"
  const [sentimentMap, setSentimentMap] = useState<Record<string, SentimentResult | "loading" | "error">>({});
  // 열린 감성 패널
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [chartPeriod, setChartPeriod]       = useState<ChartPeriod>("3m");
  const [miniCharts, setMiniCharts]         = useState<Record<string, OHLCVRecord[]>>({});
  const [chartsLoading, setChartsLoading]   = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/watchlist`, { headers: NGROK_HEADER });
      const data = await res.json();
      setItems(data.items ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);

  useEffect(() => {
    if (items.length === 0) return;
    setChartsLoading(true);
    setMiniCharts({});
    Promise.all(
      items.map(async (item) => {
        const key = `${item.market}:${item.ticker}`;
        try {
          const res = await fetch(
            `${API_BASE}/stocks/chart/${item.market}/${item.ticker}?period=${chartPeriod}&interval=daily`,
            { headers: NGROK_HEADER }
          );
          if (!res.ok) return [key, []] as [string, OHLCVRecord[]];
          const data = await res.json();
          return [key, data.data ?? []] as [string, OHLCVRecord[]];
        } catch {
          return [key, []] as [string, OHLCVRecord[]];
        }
      })
    ).then((entries) => {
      setMiniCharts(Object.fromEntries(entries));
      setChartsLoading(false);
    });
  }, [items, chartPeriod]);

  const handleInputChange = (val: string) => {
    setDisplayValue(val);
    setInput(val);
    if (market !== "KR") return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.trim().length < 1) { setSuggestions([]); setShowSuggestions(false); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.searchStocks("KR", val);
        setSuggestions(res.results ?? []);
        setShowSuggestions((res.results ?? []).length > 0);
      } catch { setSuggestions([]); }
    }, 300);
  };

  const selectSuggestion = (s: { ticker: string; name: string }) => {
    setInput(s.ticker);
    setDisplayValue(s.name);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const submitAdd = async (tickerCode: string) => {
    if (!tickerCode) return;
    if (market === "KR" && !/^\d{6}$/.test(tickerCode)) return;
    setAdding(true);
    try {
      await fetch(`${API_BASE}/watchlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...NGROK_HEADER },
        body: JSON.stringify({ market, ticker: tickerCode }),
      });
      setInput("");
      setDisplayValue("");
      setSuggestions([]);
      await fetchList();
    } finally {
      setAdding(false);
    }
  };

  const add = async () => {
    // KR: 자동완성 목록이 있으면 첫 번째 항목 자동 선택
    if (market === "KR" && suggestions.length > 0) {
      const s = suggestions[0];
      selectSuggestion(s);
      await submitAdd(s.ticker);
      return;
    }
    const ticker = market === "US" ? input.trim().toUpperCase() : input.trim();
    await submitAdd(ticker);
  };

  const remove = async (item: WatchItem) => {
    await fetch(`${API_BASE}/watchlist/${item.market}/${item.ticker}`, {
      method: "DELETE",
      headers: NGROK_HEADER,
    });
    setSentimentMap((prev) => {
      const next = { ...prev };
      delete next[`${item.market}:${item.ticker}`];
      return next;
    });
    if (expandedTicker === `${item.market}:${item.ticker}`) setExpandedTicker(null);
    await fetchList();
  };

  const fetchSentiment = async (item: WatchItem) => {
    const key = `${item.market}:${item.ticker}`;
    setSentimentMap((prev) => ({ ...prev, [key]: "loading" }));
    try {
      const res = await fetch(
        `${API_BASE}/news/sentiment/${item.market}/${item.ticker}`,
        { headers: NGROK_HEADER }
      );
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
      const data = await res.json();
      if (!isValidSentiment(data)) throw new Error("invalid response");
      setSentimentMap((prev) => ({ ...prev, [key]: data }));
    } catch {
      setSentimentMap((prev) => ({ ...prev, [key]: "error" }));
    }
  };

  const analyzeSentiment = async (item: WatchItem) => {
    const key = `${item.market}:${item.ticker}`;
    if (expandedTicker === key) {
      setExpandedTicker(null);
      return;
    }
    setExpandedTicker(key);
    if (sentimentMap[key] === "loading") return;
    if (sentimentMap[key] && sentimentMap[key] !== "error") return;
    fetchSentiment(item);
  };

  return (
    <>
      <Navbar />
      <main className="p-6 space-y-6 max-w-7xl mx-auto w-full">
        <div>
          <h1 className="text-2xl font-bold">관심종목</h1>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            주시할 종목을 등록하고 현재가 및 뉴스 감성을 확인하세요
          </p>
        </div>

        {/* 종목 추가 */}
        <div className="card space-y-3">
          <h2 className="font-semibold text-sm">종목 추가</h2>
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--card-border)" }}>
              {(["KR", "US"] as Market[]).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMarket(m); setInput(""); setDisplayValue(""); setSuggestions([]); }}
                  className="px-4 py-2 text-sm font-medium transition-colors"
                  style={{ background: market === m ? "var(--accent)" : "transparent", color: market === m ? "#fff" : "var(--muted)" }}
                >
                  {m === "KR" ? "한국" : "미국"}
                </button>
              ))}
            </div>

            <div className="relative flex-1 min-w-48">
              <input
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{ background: "var(--card)", border: "1px solid var(--card-border)", color: "var(--foreground)" }}
                placeholder={market === "KR" ? "종목명 또는 코드 (예: 삼성전자, 005930)" : "티커 (예: AAPL)"}
                value={displayValue}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (market === "KR" && showSuggestions && suggestions.length > 0) {
                      const s = suggestions[0];
                      selectSuggestion(s);
                      submitAdd(s.ticker);
                    } else {
                      setShowSuggestions(false);
                      add();
                    }
                  }
                  if (e.key === "Escape") setShowSuggestions(false);
                }}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                autoComplete="off"
              />
              {showSuggestions && suggestions.length > 0 && (
                <ul
                  className="absolute z-50 w-full mt-1 rounded-lg overflow-hidden text-sm"
                  style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}
                >
                  {suggestions.map((s) => (
                    <li
                      key={s.ticker}
                      onMouseDown={() => selectSuggestion(s)}
                      className="px-3 py-2 cursor-pointer flex justify-between items-center"
                      style={{ borderBottom: "1px solid var(--card-border)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--card-alt, #1e293b)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                    >
                      <span>{s.name}</span>
                      <span className="muted text-xs font-mono ml-2">{s.ticker}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button
              onClick={add}
              disabled={adding || !input.trim()}
              className="px-5 py-2 rounded-lg text-sm font-medium text-white transition-colors"
              style={{ background: adding || !input.trim() ? "var(--muted)" : "var(--accent)" }}
            >
              {adding ? "추가 중..." : "+ 추가"}
            </button>
          </div>
        </div>

        {/* 목록 */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card animate-pulse h-14" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="card text-center py-16">
            <p className="text-3xl mb-3">⭐</p>
            <p className="font-medium mb-1">관심종목이 없습니다</p>
            <p className="text-sm" style={{ color: "var(--muted)" }}>위에서 종목을 추가해보세요</p>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <div className="flex justify-end pb-3">
              <select
                value={chartPeriod}
                onChange={(e) => setChartPeriod(e.target.value as ChartPeriod)}
                className="text-xs px-2 py-1.5 rounded-lg"
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--card-border)",
                  color: "var(--foreground)",
                  outline: "none",
                }}
              >
                {CHART_PERIODS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                  {["종목명", "코드", "시장", "현재가", "등락률", "거래량", "뉴스 감성", "차트", ""].map((h) => (
                    <th key={h} className="text-left py-2 px-3 font-medium" style={{ color: "var(--muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const key = `${item.market}:${item.ticker}`;
                  const chg = item.change_pct ?? 0;
                  const isUp = chg >= 0;
                  const sentiment = sentimentMap[key];
                  const isExpanded = expandedTicker === key;

                  return (
                    <Fragment key={key}>
                      <tr
                        style={{ borderBottom: isExpanded ? "none" : "1px solid var(--card-border)" }}
                      >
                        <td className="py-3 px-3 font-medium">
                          <Link
                            href={`/stock?market=${item.market}&ticker=${item.ticker}`}
                            className="hover:underline"
                            style={{ color: "var(--foreground)" }}
                          >
                            {item.name || item.ticker}
                          </Link>
                        </td>
                        <td className="py-3 px-3 font-mono text-xs" style={{ color: "var(--muted)" }}>
                          {item.ticker}
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className="text-xs px-2 py-0.5 rounded font-mono"
                            style={{
                              background: item.market === "KR" ? "#3b82f620" : "#f59e0b20",
                              color: item.market === "KR" ? "#60a5fa" : "#f59e0b",
                            }}
                          >
                            {item.market}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-mono">
                          {item.price != null ? item.price.toLocaleString() : "-"}
                        </td>
                        <td className={`py-3 px-3 font-medium font-mono ${isUp ? "positive" : "negative"}`}>
                          {item.price != null ? `${isUp ? "▲" : "▼"} ${Math.abs(chg).toFixed(2)}%` : "-"}
                        </td>
                        <td className="py-3 px-3 font-mono" style={{ color: "var(--muted)" }}>
                          {item.volume != null ? item.volume.toLocaleString() : "-"}
                        </td>
                        <td className="py-3 px-3">
                          {sentiment && sentiment !== "loading" && sentiment !== "error" ? (
                            <button
                              onClick={() => analyzeSentiment(item)}
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
                              style={{
                                background: getColor(sentiment.overall).bg,
                                color: getColor(sentiment.overall).text,
                                border: isExpanded ? `1px solid ${getColor(sentiment.overall).text}` : "1px solid transparent",
                              }}
                            >
                              <span>{getIcon(sentiment.overall)}</span>
                              <span>{sentiment.overall}</span>
                              <span className="opacity-70">
                                {sentiment.counts.긍정}✓ {sentiment.counts.부정}✗
                              </span>
                            </button>
                          ) : sentiment === "loading" ? (
                            <span className="text-xs px-2.5 py-1 rounded-full animate-pulse"
                              style={{ background: "var(--card-border)", color: "var(--muted)" }}>
                              ⏳ 분석 중...
                            </span>
                          ) : sentiment === "error" ? (
                            <button
                              onClick={() => fetchSentiment(item)}
                              className="text-xs px-2.5 py-1 rounded-full transition-colors"
                              style={{ background: "#ef444420", color: "#ef4444" }}
                            >
                              ⚠ 실패 · 재시도
                            </button>
                          ) : (
                            <button
                              onClick={() => analyzeSentiment(item)}
                              className="text-xs px-2.5 py-1 rounded-full transition-colors"
                              style={{ background: "var(--card-border)", color: "var(--muted)" }}
                              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--foreground)")}
                              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
                            >
                              🔍 뉴스 분석
                            </button>
                          )}
                        </td>
                        {/* 차트 */}
                        <td className="py-2 px-3" style={{ width: 140, maxWidth: 140, overflow: "hidden" }}>
                          {chartsLoading || !(miniCharts[key]?.length) ? (
                            <div className="rounded animate-pulse"
                              style={{ height: 75, background: "var(--card-border)" }} />
                          ) : (
                            <MiniSparkChart data={miniCharts[key]} height={75} market={item.market} />
                          )}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="flex gap-3 items-center">
                            <Link
                              href={`/stock?market=${item.market}&ticker=${item.ticker}`}
                              className="text-xs"
                              style={{ color: "var(--accent)" }}
                            >
                              분석 →
                            </Link>
                            <button
                              onClick={() => remove(item)}
                              className="text-xs transition-colors"
                              style={{ color: "var(--muted)" }}
                              onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
                            >
                              삭제
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* 감성 분석 펼침 패널 */}
                      {isExpanded && sentiment && sentiment !== "loading" && sentiment !== "error" && (
                        <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                          <td colSpan={9} className="px-4 pb-4 pt-1">
                            <div className="rounded-lg p-4 space-y-3" style={{ background: "var(--background)", border: "1px solid var(--card-border)" }}>
                              {/* 요약 헤더 */}
                              <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium" style={{ color: "var(--muted)" }}>전체 감성</span>
                                  <span
                                    className="px-2.5 py-0.5 rounded-full text-sm font-semibold"
                                    style={{
                                      background: getColor(sentiment.overall).bg,
                                      color: getColor(sentiment.overall).text,
                                    }}
                                  >
                                    {getIcon(sentiment.overall)} {sentiment.overall}
                                  </span>
                                </div>
                                <div className="flex gap-3 text-xs">
                                  {(["긍정", "중립", "부정"] as const).map((s) => (
                                    <span key={s} style={{ color: getColor(s).text }}>
                                      {SENTIMENT_ICON[s]} {s} {sentiment.counts[s]}건
                                    </span>
                                  ))}
                                </div>
                              </div>

                              {/* 기사 목록 */}
                              <div className="space-y-2">
                                {sentiment.articles.map((a, i) => (
                                  <div
                                    key={i}
                                    className="flex gap-3 items-start rounded-lg px-3 py-2"
                                    style={{ background: "var(--card)" }}
                                  >
                                    <span
                                      className="shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-xs font-semibold"
                                      style={{
                                        background: getColor(a.sentiment).bg,
                                        color: getColor(a.sentiment).text,
                                      }}
                                    >
                                      {getIcon(a.sentiment)} {a.sentiment}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <a
                                        href={a.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-sm font-medium leading-snug hover:underline block"
                                        style={{ color: "var(--foreground)" }}
                                      >
                                        {a.title}
                                      </a>
                                      <div className="flex gap-2 mt-1 text-xs" style={{ color: "var(--muted)" }}>
                                        {a.source && <span>{a.source}</span>}
                                        {a.published && <span>· {a.published}</span>}
                                        {a.reason && <span>· {a.reason}</span>}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
