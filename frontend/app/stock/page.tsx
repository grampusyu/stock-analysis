"use client";
import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import StockChart from "@/components/StockChart";
import FundFlowChart from "@/components/FundFlowChart";
import FinancialsPanel from "@/components/FinancialsPanel";
import { api, Market, Period, OHLCVRecord, TechnicalSummary, PredictionResult, FinancialData, CompanyOverview } from "@/lib/api";

const PERIODS: Period[] = ["1m", "3m", "6m", "1y", "3y"];
const PERIOD_LABEL: Record<Period, string> = { "1m": "1개월", "3m": "3개월", "6m": "6개월", "1y": "1년", "3y": "3년" };

const RECENT_KEY = "stock_recent_searches";
const MAX_RECENT = 10;

type RecentSearch = { market: Market; ticker: string; name: string };

function StockContent() {
  const searchParams = useSearchParams();
  const initMarket = (searchParams.get("market") as Market) || "KR";
  const initTicker = searchParams.get("ticker") || "";

  const [market, setMarket] = useState<Market>(initMarket);
  const [ticker, setTicker] = useState(initTicker);       // API용 실제 코드
  const [displayValue, setDisplayValue] = useState(initTicker); // 입력창 표시값
  const [period, setPeriod] = useState<Period>("1y");
  const [suggestions, setSuggestions] = useState<{ ticker: string; name: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loading, setLoading] = useState(false);
  const [chartData, setChartData] = useState<OHLCVRecord[]>([]);
  const [technical, setTechnical] = useState<TechnicalSummary | null>(null);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [predLoading, setPredLoading] = useState(false);
  const [predStatus, setPredStatus] = useState("");
  const [predProgress, setPredProgress] = useState<{ epoch: number; total: number; val_loss?: number | null } | null>(null);
  const predSourceRef = useRef<EventSource | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [livePrice, setLivePrice] = useState<{ price: number; change_pct: number; volume?: number } | null>(null);
  const [wsStatus, setWsStatus] = useState<"connecting" | "open" | "closed">("closed");
  const [fundFlow, setFundFlow] = useState<unknown[]>([]);
  const [info, setInfo] = useState<{ name?: string; price?: number; change_pct?: number; per?: number; pbr?: number } | null>(null);
  const [financials, setFinancials] = useState<FinancialData | null>(null);
  const [financialsError, setFinancialsError] = useState("");
  const [overview, setOverview] = useState<CompanyOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [error, setError] = useState("");
  const [krMapStatus, setKrMapStatus] = useState<{ fullMapReady: boolean; fullMapBuilding: boolean; totalTickers: number | null } | null>(null);
  const krMapPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 최근 검색 관리
  const loadRecent = (): RecentSearch[] => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; }
  };
  const saveRecent = (mkt: Market, tkr: string, name: string) => {
    const next = [{ market: mkt, ticker: tkr, name },
      ...loadRecent().filter((r) => !(r.market === mkt && r.ticker === tkr))
    ].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    setRecentSearches(next);
  };
  const clearRecent = () => {
    localStorage.removeItem(RECENT_KEY);
    setRecentSearches([]);
    setShowRecent(false);
  };
  const selectRecent = (r: RecentSearch) => {
    setMarket(r.market);
    setTicker(r.ticker);
    setDisplayValue(r.name);
    setShowRecent(false);
    search(r.market, r.ticker, period);
  };

  // 종목명 → 티커코드 변환 (KR: 6자리 숫자가 아닌 경우)
  const resolveTickerCode = async (searchMarket: Market, input: string): Promise<string | null> => {
    if (searchMarket !== "KR") return input.trim().toUpperCase();
    const trimmed = input.trim();
    if (/^\d{6}$/.test(trimmed)) return trimmed;  // 이미 코드
    // 현재 로드된 suggestions에서 먼저 찾기
    const fromSuggestions = suggestions.find(
      (s) => s.name === trimmed || s.ticker === trimmed
    ) || suggestions[0];
    if (fromSuggestions) return fromSuggestions.ticker;
    // 없으면 API 호출
    try {
      const res = await fetch(`http://localhost:8000/api/stocks/search/KR?q=${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      if (data.results?.length > 0) return data.results[0].ticker;
    } catch { /* ignore */ }
    return null;
  };

  const startPriceWs = (searchMarket: Market, resolvedTicker: string) => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setLivePrice(null);
    setWsStatus("connecting");

    const ws = new WebSocket(
      `ws://localhost:8000/api/realtime/ws/price/${searchMarket}/${resolvedTicker}`
    );
    wsRef.current = ws;

    ws.onopen = () => setWsStatus("open");
    ws.onmessage = (e) => {
      const d = JSON.parse(e.data) as { price: number; change_pct: number; volume?: number };
      if (d.price != null) setLivePrice({ price: d.price, change_pct: d.change_pct, volume: d.volume });
    };
    ws.onerror = () => setWsStatus("closed");
    ws.onclose = () => setWsStatus("closed");
  };

  const startPredStream = (searchMarket: Market, resolvedTicker: string) => {
    if (predSourceRef.current) {
      predSourceRef.current.close();
      predSourceRef.current = null;
    }
    setPrediction(null);
    setPredProgress(null);
    setPredStatus("");
    setPredLoading(true);

    const es = new EventSource(
      `http://localhost:8000/api/stocks/predict-stream/${searchMarket}/${resolvedTicker}?days=7`
    );
    predSourceRef.current = es;

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data) as {
        type: string;
        message?: string;
        epoch?: number;
        total?: number;
        val_loss?: number | null;
        data?: PredictionResult;
      };
      if (msg.type === "status") {
        setPredStatus(msg.message ?? "");
      } else if (msg.type === "progress") {
        setPredProgress({ epoch: msg.epoch!, total: msg.total!, val_loss: msg.val_loss });
        setPredStatus("모델 학습 중...");
      } else if (msg.type === "result") {
        const pred = msg.data;
        setPrediction(pred?.predictions ? pred : null);
        setPredLoading(false);
        es.close();
        predSourceRef.current = null;
      } else if (msg.type === "error") {
        setPredLoading(false);
        es.close();
        predSourceRef.current = null;
      }
    };
    es.onerror = () => {
      setPredLoading(false);
      if (predSourceRef.current) {
        predSourceRef.current.close();
        predSourceRef.current = null;
      }
    };
  };

  const search = async (searchMarket = market, searchTicker = ticker, searchPeriod = period) => {
    if (!searchTicker.trim()) return;
    setLoading(true);
    setShowSuggestions(false);
    setError("");
    setFinancials(null);
    setFinancialsError("");
    setOverview(null);
    setOverviewLoading(false);
    setLivePrice(null);
    setWsStatus("closed");
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }

    // 종목명 입력 시 티커코드로 자동 변환
    const resolvedTicker = await resolveTickerCode(searchMarket, searchTicker);
    if (!resolvedTicker) {
      setError(`"${searchTicker.trim()}" 종목을 찾을 수 없습니다`);
      setLoading(false);
      return;
    }
    // 코드로 확정 (이후 search() 재호출 시 코드로 검색)
    setTicker(resolvedTicker);
    try {
      const [chartRes, techRes, infoRes] = await Promise.all([
        api.getChart(searchMarket, resolvedTicker, searchPeriod).catch((e) => { throw new Error(`차트: ${e.message}`); }),
        api.getTechnical(searchMarket, resolvedTicker).catch((e) => { throw new Error(`기술지표: ${e.message}`); }),
        api.getStockInfo(searchMarket, resolvedTicker).catch((e) => { throw new Error(`종목정보: ${e.message}`); }),
      ]);
      setChartData(chartRes.data);
      const tech = techRes as TechnicalSummary;
      setTechnical(tech?.signals ? tech : null);
      setInfo(infoRes);
      const resolvedName = (infoRes as { name?: string })?.name ?? resolvedTicker;
      setDisplayValue(resolvedName);  // 입력창에 종목명 표시
      saveRecent(searchMarket, resolvedTicker, resolvedName);
      startPriceWs(searchMarket, resolvedTicker);
      startPredStream(searchMarket, resolvedTicker);

      // 자금흐름은 별도 try-catch — 실패해도 나머지 데이터는 유지
      if (searchMarket === "KR") {
        try {
          const ff = await api.getFundFlow(resolvedTicker, 30);
          setFundFlow(ff.data);
        } catch {
          setFundFlow([]);
        }
      } else {
        setFundFlow([]);
      }

      // 재무제표 — 비동기 별도 조회
      api.getFinancials(searchMarket, resolvedTicker)
        .then((fin) => setFinancials(fin))
        .catch((e) => setFinancialsError(e instanceof Error ? e.message : "재무 데이터 조회 실패"));

      // 기업개요 — Claude API 호출 (별도 비동기)
      setOverviewLoading(true);
      api.getOverview(searchMarket, resolvedTicker)
        .then((ov) => setOverview(ov))
        .catch(() => setOverview(null))
        .finally(() => setOverviewLoading(false));
    } catch (e) {
      setError(e instanceof Error ? e.message : "조회 실패");
    } finally {
      setLoading(false);
    }
  };

  const handleTickerChange = (value: string) => {
    setTicker(value);
    setDisplayValue(value);
    setShowSuggestions(false);
    setShowRecent(false);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (value.trim().length < 1) {
      setSuggestions([]);
      if (recentSearches.length > 0) setShowRecent(true);
      return;
    }
    searchDebounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`http://localhost:8000/api/stocks/search/${market}?q=${encodeURIComponent(value)}`);
        const data = await res.json();
        setSuggestions(data.results ?? []);
        setShowSuggestions((data.results ?? []).length > 0);
      } catch { setSuggestions([]); }
    }, 300);
  };

  const selectSuggestion = (s: { ticker: string; name: string }) => {
    setTicker(s.ticker);
    setDisplayValue(s.name);
    setSuggestions([]);
    setShowSuggestions(false);
    search(market, s.ticker, period);
  };

  // KRX 전종목 맵 상태 조회 (KR 마켓 선택 시)
  useEffect(() => {
    if (market !== "KR") return;
    const fetchStatus = async () => {
      try {
        const res = await fetch("http://localhost:8000/api/stocks/search-status");
        const data = await res.json();
        setKrMapStatus({
          fullMapReady: data.full_map_ready,
          fullMapBuilding: data.full_map_building,
          totalTickers: data.total_tickers,
        });
        // 전종목 맵이 완성되면 폴링 중단
        if (data.full_map_ready && krMapPollRef.current) {
          clearInterval(krMapPollRef.current);
          krMapPollRef.current = null;
        }
      } catch { /* ignore */ }
    };
    fetchStatus();
    // 빌드 중이면 5초마다 폴링
    if (krMapPollRef.current) clearInterval(krMapPollRef.current);
    krMapPollRef.current = setInterval(fetchStatus, 5000);
    return () => {
      if (krMapPollRef.current) { clearInterval(krMapPollRef.current); krMapPollRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market]);

  // localStorage에서 최근 검색 초기화
  useEffect(() => { setRecentSearches(loadRecent()); }, []);

  // 컴포넌트 언마운트 시 SSE·WebSocket 정리
  useEffect(() => {
    return () => {
      predSourceRef.current?.close();
      wsRef.current?.close();
    };
  }, []);

  // URL 파라미터로 진입 시 자동 조회 (섹터 패널 "상세 분석 →" 링크 등)
  useEffect(() => {
    if (initTicker.trim()) {
      search(initMarket, initTicker, "1y");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="p-6 space-y-6 max-w-7xl mx-auto w-full">
      <h1 className="text-2xl font-bold">종목 분석</h1>

      {/* 검색 */}
      <div className="card flex flex-wrap gap-3 items-center">
        <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--card-border)" }}>
          {(["KR", "US"] as Market[]).map((m) => (
            <button
              key={m}
              onClick={() => setMarket(m)}
              className="px-4 py-2 text-sm font-medium transition-colors"
              style={{ background: market === m ? "var(--accent)" : "transparent", color: market === m ? "#fff" : "var(--muted)" }}
            >
              {m === "KR" ? "한국" : "미국"}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-48">
          <input
            className="w-full py-2 rounded-lg text-sm"
            style={{ background: "var(--card)", border: "1px solid var(--card-border)", color: "var(--foreground)", paddingLeft: "0.75rem", paddingRight: displayValue ? "2rem" : "0.75rem" }}
            placeholder={market === "KR" ? "종목명 또는 코드 (예: 삼성전자, 005930)" : "티커 (예: AAPL)"}
            value={displayValue}
            onChange={(e) => handleTickerChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { setShowSuggestions(false); setShowRecent(false); search(); } if (e.key === "Escape") { setShowSuggestions(false); setShowRecent(false); } }}
            onBlur={() => setTimeout(() => { setShowSuggestions(false); setShowRecent(false); }, 150)}
            onFocus={() => {
              if (ticker.trim() === "" && recentSearches.length > 0) setShowRecent(true);
              else if (suggestions.length > 0) setShowSuggestions(true);
            }}
            autoComplete="off"
          />
          {displayValue && (
            <button
              onClick={() => { setTicker(""); setDisplayValue(""); setSuggestions([]); setShowSuggestions(false); setShowRecent(recentSearches.length > 0); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-4 h-4 rounded-full transition-colors"
              style={{ color: "var(--muted)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--foreground)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
              tabIndex={-1}
              aria-label="검색어 지우기"
            >
              ✕
            </button>
          )}
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
          {showRecent && recentSearches.length > 0 && (
            <ul
              className="absolute z-50 w-full mt-1 rounded-lg overflow-hidden text-sm"
              style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}
            >
              <li
                className="px-3 py-1.5 flex justify-between items-center"
                style={{ borderBottom: "1px solid var(--card-border)" }}
              >
                <span className="text-xs muted">최근 검색</span>
                <button
                  onMouseDown={(e) => { e.preventDefault(); clearRecent(); }}
                  className="text-xs muted transition-colors"
                  style={{ color: "var(--muted)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
                >
                  전체 삭제
                </button>
              </li>
              {recentSearches.map((r, i) => (
                <li
                  key={`${r.market}-${r.ticker}`}
                  onMouseDown={() => selectRecent(r)}
                  className="px-3 py-2 cursor-pointer flex justify-between items-center"
                  style={{ borderBottom: i < recentSearches.length - 1 ? "1px solid var(--card-border)" : undefined }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--card-alt, #1e293b)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="shrink-0 text-xs font-mono px-1.5 py-0.5 rounded"
                      style={{
                        background: r.market === "KR" ? "#3b82f620" : "#f59e0b20",
                        color: r.market === "KR" ? "#60a5fa" : "#f59e0b",
                      }}
                    >
                      {r.market}
                    </span>
                    <span className="truncate">{r.name}</span>
                  </div>
                  <span className="muted text-xs font-mono ml-2 shrink-0">{r.ticker}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className="px-3 py-2 text-xs rounded-lg transition-colors"
              style={{ background: period === p ? "var(--accent)" : "var(--card)", border: "1px solid var(--card-border)", color: period === p ? "#fff" : "var(--muted)" }}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
        <button
          onClick={() => search()}
          disabled={loading}
          className="px-5 py-2 rounded-lg text-sm font-medium text-white transition-colors"
          style={{ background: loading ? "var(--muted)" : "var(--accent)" }}
        >
          {loading ? "조회 중..." : "조회"}
        </button>
        {market === "KR" && krMapStatus && (
          <span
            className="text-xs px-2 py-1 rounded-full"
            style={
              krMapStatus.fullMapReady
                ? { background: "#10b98120", color: "#10b981" }
                : { background: "#f59e0b20", color: "#f59e0b" }
            }
          >
            {krMapStatus.fullMapReady
              ? `전종목 ${krMapStatus.totalTickers?.toLocaleString()}개`
              : krMapStatus.fullMapBuilding
              ? "전종목 로드 중..."
              : "KRX 인증 대기"}
          </span>
        )}
      </div>

      {error && <p className="negative text-sm">{error}</p>}

      {/* 종목 정보 */}
      {info && (() => {
        const displayPrice = livePrice?.price ?? info.price;
        const displayChangePct = livePrice?.change_pct ?? info.change_pct ?? 0;
        const isLive = wsStatus === "open";
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* 종목명 */}
            <div className="card">
              <p className="muted text-xs mb-1">종목명</p>
              <p className="text-lg font-bold">{info.name}</p>
            </div>
            {/* 현재가 — LIVE 배지 */}
            <div className="card">
              <div className="flex items-center justify-between mb-1">
                <p className="muted text-xs">현재가</p>
                {isLive && (
                  <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: "#10b981" }}>
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#10b981" }} />
                    LIVE
                  </span>
                )}
              </div>
              <p className="text-lg font-bold">{displayPrice?.toLocaleString()}</p>
            </div>
            {/* 등락률 */}
            <div className="card">
              <p className="muted text-xs mb-1">등락률</p>
              <p className={`text-lg font-bold ${displayChangePct >= 0 ? "positive" : "negative"}`}>
                {displayChangePct >= 0 ? "▲" : "▼"} {Math.abs(displayChangePct).toFixed(2)}%
              </p>
            </div>
            {/* PER */}
            <div className="card">
              <p className="muted text-xs mb-1">PER</p>
              <p className="text-lg font-bold">{info.per?.toFixed(1) ?? "N/A"}</p>
            </div>
          </div>
        );
      })()}

      {/* 차트 */}
      {chartData.length > 0 && (
        <div className="card">
          <h2 className="font-semibold mb-3">가격 차트</h2>
          <StockChart data={chartData} />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 기술적 분석 */}
        {technical && (
          <div className="card space-y-3">
            <h2 className="font-semibold">기술적 지표</h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                ["MA5", technical.ma5], ["MA20", technical.ma20], ["MA60", technical.ma60],
                ["RSI", technical.rsi], ["MACD", technical.macd],
                ["BB상단", technical.bb_upper], ["BB하단", technical.bb_lower],
              ].map(([label, val]) => (
                <div key={label as string} className="flex justify-between">
                  <span className="muted">{label}</span>
                  <span className="font-mono">{Number(val).toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1 mt-2">
              {technical.signals.map((s) => (
                <div key={s.indicator} className="flex items-center gap-2 text-sm">
                  <span
                    className="px-2 py-0.5 rounded text-xs font-medium"
                    style={{ background: s.signal === "매수" ? "#10b98130" : s.signal === "매도" ? "#ef444430" : "#64748b30", color: s.signal === "매수" ? "#10b981" : s.signal === "매도" ? "#ef4444" : "#64748b" }}
                  >
                    {s.signal}
                  </span>
                  <span className="muted">{s.desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI 예측 */}
        {(prediction || predLoading) && (
          <div className="card space-y-3">
            <h2 className="font-semibold">
              AI 가격 예측 (7일)
              {prediction?.model && (
                <span className="ml-2 text-xs font-normal px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                  {prediction.model}
                </span>
              )}
            </h2>

            {predLoading && (
              <div className="space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="muted animate-pulse">
                    {predProgress
                      ? `학습 중... (${predProgress.epoch} / ${predProgress.total} 에폭)`
                      : predStatus || "준비 중..."}
                  </span>
                  {predProgress && (
                    <span className="muted text-xs font-mono">
                      {Math.round((predProgress.epoch / predProgress.total) * 100)}%
                    </span>
                  )}
                </div>
                <div className="w-full rounded-full h-1.5" style={{ background: "var(--card-border)" }}>
                  <div
                    className="h-1.5 rounded-full transition-all duration-300"
                    style={{
                      width: predProgress
                        ? `${Math.min(100, (predProgress.epoch / predProgress.total) * 100)}%`
                        : "5%",
                      background: "var(--accent)",
                    }}
                  />
                </div>
              </div>
            )}

            {prediction && (
              <>
                <p className="text-sm">
                  예측 트렌드:{" "}
                  <span className={prediction.trend === "상승" ? "positive" : "negative"} style={{ fontWeight: 600 }}>
                    {prediction.trend}
                  </span>
                </p>
                <div className="space-y-1">
                  {prediction.predictions.map((p) => (
                    <div key={p.date} className="flex justify-between text-sm">
                      <span className="muted">{p.date}</span>
                      <span className="font-mono">
                        {market === "KR"
                          ? Math.round(p.price).toLocaleString()
                          : p.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 자금 흐름 */}
      {market === "KR" && fundFlow.length > 0 && (
        <div className="card">
          <h2 className="font-semibold mb-3">자금 유입 흐름 (30일)</h2>
          <FundFlowChart data={fundFlow as Parameters<typeof FundFlowChart>[0]["data"]} />
        </div>
      )}

      {/* 기업개요 + 재무제표 패널 */}
      {(overview || overviewLoading || financials || (financialsError && chartData.length > 0)) && (
        <div className="space-y-0">
          {/* 재무 데이터 없을 때도 기업개요는 표시 */}
          <FinancialsPanel
            data={financials}
            overview={overview}
            overviewLoading={overviewLoading}
          />
          {financialsError && !financials && (
            <div className="card text-sm space-y-1 mt-4">
              <p className="font-semibold">재무제표</p>
              <p className="muted">{financialsError}</p>
              {market === "KR" && financialsError.includes("DART") && (
                <p className="text-xs muted">
                  한국 재무제표는 OpenDART API 키가 필요합니다.{" "}
                  <span className="underline cursor-pointer">dart.fss.or.kr</span>에서 무료 발급 후{" "}
                  <code>DART_API_KEY</code> 환경변수로 설정하세요.
                </p>
              )}
            </div>
          )}
          {!financials && !financialsError && chartData.length > 0 && (
            <p className="text-xs muted mt-2 animate-pulse">재무제표 불러오는 중...</p>
          )}
        </div>
      )}
    </main>
  );
}

export default function StockPage() {
  return (
    <>
      <Navbar />
      <Suspense fallback={<main className="p-6 max-w-7xl mx-auto"><p className="muted text-sm animate-pulse">로딩 중...</p></main>}>
        <StockContent />
      </Suspense>
    </>
  );
}
