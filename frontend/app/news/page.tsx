"use client";
import { useState, useEffect, useCallback } from "react";
import Navbar from "@/components/Navbar";
import { api, NewsArticle, Market } from "@/lib/api";

const MARKETS: { value: Market; label: string }[] = [
  { value: "KR", label: "한국" },
  { value: "US", label: "미국" },
];

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

  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNews = useCallback(async () => {
    setLoading(true);
    setError(null);
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

  function handleSearch() {
    const t = inputTicker.trim().toUpperCase();
    if (!t) return;
    setTicker(t);
    setMode("stock");
  }

  function handleMarketMode() {
    setMode("market");
    setTicker("");
    setInputTicker("");
  }

  useEffect(() => {
    if (mode === "stock" && ticker) fetchNews();
  }, [ticker, mode, fetchNews]);

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
          <input
            type="text"
            value={inputTicker}
            onChange={(e) => setInputTicker(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder={market === "KR" ? "종목코드 (예: 005930)" : "티커 (예: AAPL)"}
            className="flex-1 px-3 py-2 rounded text-sm"
            style={{
              background: "var(--background)",
              border: "1px solid var(--card-border)",
              color: "var(--foreground)",
            }}
          />
          <button
            onClick={handleSearch}
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
        <div
          className="card text-sm"
          style={{ color: "#ef4444", border: "1px solid #ef444440" }}
        >
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
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {articles.length}개 기사
          </p>
          {articles.map((a, i) => (
            <ArticleCard key={i} article={a} />
          ))}
        </div>
      )}
    </div>
    </>
  );
}
