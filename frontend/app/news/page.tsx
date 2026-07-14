"use client";
import { useState, useEffect, useCallback } from "react";
import Navbar from "@/components/Navbar";
import { api, NewsArticle, Market } from "@/lib/api";

const MARKETS: { value: Market; label: string }[] = [
  { value: "KR", label: "한국" },
  { value: "US", label: "미국" },
];

const HISTORY_KEY = "news_ticker_history";
const MAX_HISTORY = 10;

type HistoryItem = { market: Market; ticker: string };

function loadHistory(): HistoryItem[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]"); } catch { return []; }
}

function saveHistory(market: Market, ticker: string) {
  const next = [
    { market, ticker },
    ...loadHistory().filter((h) => !(h.market === market && h.ticker === ticker)),
  ].slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

function ArticleCard({ article }: { article: NewsArticle }) {
  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="card block hover:opacity-80 transition-opacity"
      style={{ textDecoration: "none" }}
    >
      <p className="text-sm font-medium leading-snug mb-2" style={{ color: "var(--foreground)" }}>
        {article.title}
      </p>
      <div className="flex items-center gap-3 text-xs" style={{ color: "var(--muted)" }}>
        {article.source && <span>{article.source}</span>}
        {article.published && <span>{article.published}</span>}
      </div>
    </a>
  );
}

export default function NewsPage() {
  const [market, setMarket] = useState<Market>("KR");
  const [ticker, setTicker] = useState("");
  const [inputTicker, setInputTicker] = useState("");
  const [mode, setMode] = useState<"market" | "stock">("market");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setHistory(loadHistory()); }, []);

  const fetchNews = useCallback(async () => {
    setLoading(true);
    setError(null);
    setArticles([]);
    try {
      if (mode === "stock" && ticker) {
        const res = await api.getStockNews(market, ticker);
        setArticles(res.articles);
      } else {
        const res = await api.getMarketNews(market);
        setArticles(res.articles);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "뉴스를 불러오지 못했습니다.");
      setArticles([]);
    } finally {
      setLoading(false);
    }
  }, [market, ticker, mode]);

  useEffect(() => {
    if (mode === "market") fetchNews();
  }, [market, mode, fetchNews]);

  useEffect(() => {
    if (mode === "stock" && ticker) fetchNews();
  }, [ticker, mode, fetchNews]);

  function handleSearch(t?: string, m?: Market) {
    const searchTicker = (t ?? inputTicker).trim().toUpperCase();
    const searchMarket = m ?? market;
    if (!searchTicker) return;
    if (m) setMarket(m);
    setInputTicker(searchTicker);
    setTicker(searchTicker);
    setMode("stock");
    setShowHistory(false);
    setHistory(saveHistory(searchMarket, searchTicker));
  }

  function handleMarketMode() {
    setMode("market");
    setTicker("");
    setInputTicker("");
    setShowHistory(false);
  }

  function clearInput() {
    setInputTicker("");
    setTicker("");
    setMode("market");
    setShowHistory(history.length > 0);
  }

  function deleteHistory(item: HistoryItem) {
    const next = loadHistory().filter(
      (h) => !(h.market === item.market && h.ticker === item.ticker)
    );
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    setHistory(next);
  }

  function clearAllHistory() {
    localStorage.removeItem(HISTORY_KEY);
    setHistory([]);
    setShowHistory(false);
  }

  return (
    <>
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">주식 뉴스</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            국내외 증시 및 종목별 최신 뉴스
          </p>
        </div>

        {/* 컨트롤 */}
        <div className="card space-y-4">
          {/* 시장 선택 */}
          <div className="flex gap-2">
            {MARKETS.map((m) => (
              <button
                key={m.value}
                onClick={() => setMarket(m.value)}
                className="px-4 py-1.5 rounded text-sm font-medium transition-colors"
                style={{
                  background: market === m.value ? "var(--accent)" : "var(--card-border)",
                  color: market === m.value ? "#fff" : "var(--muted)",
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* 종목 검색 */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={inputTicker}
                onChange={(e) => {
                  const val = e.target.value;
                  setInputTicker(val);
                  if (!val) setShowHistory(history.length > 0);
                  else setShowHistory(false);
                }}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                onFocus={() => { if (!inputTicker && history.length > 0) setShowHistory(true); }}
                onBlur={() => setTimeout(() => setShowHistory(false), 150)}
                placeholder={market === "KR" ? "종목코드 (예: 005930)" : "티커 (예: AAPL)"}
                className="w-full py-2 rounded text-sm"
                style={{
                  background: "var(--background)",
                  border: "1px solid var(--card-border)",
                  color: "var(--foreground)",
                  paddingLeft: "0.75rem",
                  paddingRight: inputTicker ? "2rem" : "0.75rem",
                }}
              />
              {/* X 버튼 */}
              {inputTicker && (
                <button
                  onClick={clearInput}
                  tabIndex={-1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-4 h-4 rounded-full transition-colors"
                  style={{ color: "var(--muted)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--foreground)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
                  aria-label="지우기"
                >
                  ✕
                </button>
              )}

              {/* 히스토리 드롭다운 */}
              {showHistory && history.length > 0 && (
                <ul
                  className="absolute z-50 w-full mt-1 rounded-lg overflow-hidden text-sm"
                  style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}
                >
                  <li
                    className="px-3 py-1.5 flex justify-between items-center"
                    style={{ borderBottom: "1px solid var(--card-border)" }}
                  >
                    <span className="text-xs" style={{ color: "var(--muted)" }}>최근 검색</span>
                    <button
                      onMouseDown={(e) => { e.preventDefault(); clearAllHistory(); }}
                      className="text-xs transition-colors"
                      style={{ color: "var(--muted)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
                    >
                      전체 삭제
                    </button>
                  </li>
                  {history.map((h, i) => (
                    <li
                      key={`${h.market}-${h.ticker}`}
                      className="flex items-center justify-between px-3 py-2 cursor-pointer"
                      style={{ borderBottom: i < history.length - 1 ? "1px solid var(--card-border)" : undefined }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--card-alt, #1e293b)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                    >
                      <div
                        className="flex items-center gap-2 flex-1 min-w-0"
                        onMouseDown={() => handleSearch(h.ticker, h.market)}
                      >
                        <span
                          className="shrink-0 text-xs font-mono px-1.5 py-0.5 rounded"
                          style={{
                            background: h.market === "KR" ? "#3b82f620" : "#f59e0b20",
                            color: h.market === "KR" ? "#60a5fa" : "#f59e0b",
                          }}
                        >
                          {h.market}
                        </span>
                        <span className="font-mono text-sm">{h.ticker}</span>
                      </div>
                      <button
                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); deleteHistory(h); }}
                        className="text-xs ml-2 shrink-0 transition-colors"
                        style={{ color: "var(--muted)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button
              onClick={() => handleSearch()}
              className="px-4 py-2 rounded text-sm font-medium"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              종목 뉴스
            </button>
            <button
              onClick={handleMarketMode}
              className="px-4 py-2 rounded text-sm font-medium"
              style={{
                background: mode === "market" ? "var(--accent)" : "var(--card-border)",
                color: mode === "market" ? "#fff" : "var(--muted)",
              }}
            >
              시장 뉴스
            </button>
          </div>

          {/* 현재 모드 표시 */}
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {mode === "stock" && ticker
              ? `${market} · ${ticker} 관련 뉴스`
              : `${market === "KR" ? "한국" : "미국"} 증시 종합 뉴스`}
          </p>
        </div>

        {/* 결과 */}
        {loading && (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="card animate-pulse">
                <div className="h-4 rounded mb-2" style={{ background: "var(--card-border)", width: "90%" }} />
                <div className="h-3 rounded" style={{ background: "var(--card-border)", width: "40%" }} />
              </div>
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="card text-sm" style={{ color: "#ef4444", border: "1px solid #ef444440" }}>
            {error}
          </div>
        )}

        {!loading && !error && articles.length === 0 && (
          <div className="card text-sm text-center" style={{ color: "var(--muted)" }}>
            뉴스가 없습니다.
          </div>
        )}

        {!loading && !error && articles.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs" style={{ color: "var(--muted)" }}>{articles.length}개 기사</p>
            {articles.map((a, i) => (
              <ArticleCard key={i} article={a} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
