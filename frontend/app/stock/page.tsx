"use client";
import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import StockChart from "@/components/StockChart";
import FlowPriceChart from "@/components/FlowPriceChart";
import FinancialsPanel from "@/components/FinancialsPanel";
import IntradaySpaghettiChart from "@/components/IntradaySpaghettiChart";
import { api, Market, Period, OHLCVRecord, TechnicalSummary, PredictionResult, FinancialData, CompanyOverview, NewsArticle, IntradayPattern, API_BASE, WS_BASE, NGROK_HEADER } from "@/lib/api";

const PERIODS: Period[] = ["1m", "3m", "6m", "1y", "3y"];
const PERIOD_LABEL: Record<Period, string> = { "1m": "1개월", "3m": "3개월", "6m": "6개월", "1y": "1년", "3y": "3년" };

const RECENT_KEY = "stock_recent_searches";
const PERIOD_KEY = "stock_period";
const MAX_RECENT = 10;

type RecentSearch = { market: Market; ticker: string; name: string };

function StockContent() {
  const searchParams = useSearchParams();
  const initMarket = (searchParams.get("market") as Market) || "KR";
  const initTicker = searchParams.get("ticker") || "";

  const [market, setMarket] = useState<Market>(initMarket);
  const [ticker, setTicker] = useState(initTicker);       // API용 실제 코드
  const [displayValue, setDisplayValue] = useState(initTicker); // 입력창 표시값
  const [period, setPeriod] = useState<Period>(() => {
    try {
      const saved = localStorage.getItem(PERIOD_KEY) as Period;
      return PERIODS.includes(saved) ? saved : "1y";
    } catch { return "1y"; }
  });
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
  const [flowPriceData, setFlowPriceData] = useState<OHLCVRecord[]>([]);
  const [info, setInfo] = useState<{ name?: string; price?: number; change_pct?: number; per?: number; pbr?: number } | null>(null);
  const [financials, setFinancials] = useState<FinancialData | null>(null);
  const [financialsError, setFinancialsError] = useState("");
  const [overview, setOverview] = useState<CompanyOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"chart" | "news" | "intraday">("chart");
  const [newsArticles, setNewsArticles] = useState<NewsArticle[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [intradayPattern, setIntradayPattern] = useState<IntradayPattern | null>(null);
  const [intradayLoading, setIntradayLoading] = useState(false);
  const [intradayError, setIntradayError] = useState("");
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteMarket, setFavoriteMarket] = useState<string | null>(null); // 재무등급 데이터 상의 실제 시장(KOSPI/KOSDAQ)
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
      const res = await fetch(`${API_BASE}/stocks/search/KR?q=${encodeURIComponent(trimmed)}`, { headers: NGROK_HEADER });
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

    const wsBase = WS_BASE || `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
    const ws = new WebSocket(
      `${wsBase}/api/realtime/ws/price/${searchMarket}/${resolvedTicker}`
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
      `${API_BASE}/stocks/predict-stream/${searchMarket}/${resolvedTicker}?days=7`
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
    setActiveTab("chart");
    setNewsArticles([]);
    setIntradayPattern(null);
    setIntradayError("");
    setIsFavorite(false);
    setFavoriteMarket(null);
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
    if (searchMarket === "KR") {
      // 재무등급 데이터의 market은 KOSPI/KOSDAQ 단위라서, 즐겨찾기 매칭을 위해 실제 시장을 먼저 확인
      api.getFinancialGradeByCode(resolvedTicker)
        .then((res) => {
          const realMarket = res.results?.[0]?.market ?? null;
          setFavoriteMarket(realMarket);
          if (!realMarket) { setIsFavorite(false); return; }
          return api.getFinancialGradeFavorites().then((favRes) =>
            setIsFavorite((favRes.items ?? []).some((it) => it.market === realMarket && it.code === resolvedTicker))
          );
        })
        .catch(() => { setFavoriteMarket(null); setIsFavorite(false); });
    }
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

      // 자금흐름은 별도 try-catch — 실패해도 나머지 데이터는 유지.
      // 종가는 위 차트 기간(searchPeriod)과 무관하게 수급 창(90일)과 항상 맞는
      // 별도 3개월 시세를 받아온다 — 안 그러면 사용자가 "1개월"을 선택했을 때
      // 종가가 최근 1개월분만 있어서 90일짜리 수급-가격 차트의 앞 60일은
      // 종가가 null이 되어 선이 끊겨 보인다.
      if (searchMarket === "KR") {
        try {
          const [ff, flowChart] = await Promise.all([
            api.getFundFlow(resolvedTicker, 90),
            api.getChart(searchMarket, resolvedTicker, "3m"),
          ]);
          setFundFlow(ff.data);
          setFlowPriceData(flowChart.data);
        } catch {
          setFundFlow([]);
          setFlowPriceData([]);
        }
      } else {
        setFundFlow([]);
        setFlowPriceData([]);
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

  const toggleFavorite = async () => {
    if (!favoriteMarket || !ticker) return;
    const next = !isFavorite;
    setIsFavorite(next); // 낙관적 업데이트
    try {
      if (next) await api.addFinancialGradeFavorite(favoriteMarket, ticker);
      else await api.removeFinancialGradeFavorite(favoriteMarket, ticker);
    } catch {
      setIsFavorite(!next); // 실패 시 되돌리기
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
        const res = await fetch(`${API_BASE}/stocks/search/${market}?q=${encodeURIComponent(value)}`, { headers: NGROK_HEADER });
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
        const res = await fetch(`${API_BASE}/stocks/search-status`, { headers: NGROK_HEADER });
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
      search(initMarket, initTicker, period);
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
              onClick={() => { setPeriod(p); localStorage.setItem(PERIOD_KEY, p); if (ticker) search(market, ticker, p); }}
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
          className="w-24 py-2 rounded-lg text-sm font-medium text-white transition-colors"
          style={{ background: loading ? "var(--muted)" : "var(--accent)" }}
        >
          {loading ? "조회 중" : "조회하기"}
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
              <div className="flex items-center justify-between mb-1">
                <p className="muted text-xs">종목명</p>
                {market === "KR" && (
                  <button
                    onClick={toggleFavorite}
                    disabled={!favoriteMarket}
                    title={
                      !favoriteMarket
                        ? "재무 등급 데이터가 없는 종목이라 관심 등록을 할 수 없습니다"
                        : isFavorite
                        ? "관심 종목에서 제거"
                        : "관심 종목으로 등록 (재무 등급 페이지의 관심카드에 표시)"
                    }
                    className="text-lg leading-none transition-colors"
                    style={{
                      color: !favoriteMarket ? "var(--card-border)" : isFavorite ? "#f59e0b" : "var(--muted)",
                      cursor: !favoriteMarket ? "not-allowed" : "pointer",
                    }}
                  >
                    {isFavorite ? "★" : "☆"}
                  </button>
                )}
              </div>
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

      {/* 탭 */}
      {chartData.length > 0 && (
        <div className="flex gap-1 border-b" style={{ borderColor: "var(--card-border)" }}>
          {(["chart", "intraday", "news"] as const).map((tab) => (
            <button
              key={tab}
              onClick={async () => {
                setActiveTab(tab);
                if (tab === "news" && newsArticles.length === 0 && !newsLoading && ticker) {
                  setNewsLoading(true);
                  try {
                    const res = await api.getStockNews(market, ticker);
                    setNewsArticles(res.articles);
                  } catch { setNewsArticles([]); }
                  finally { setNewsLoading(false); }
                }
                if (tab === "intraday" && !intradayPattern && !intradayLoading && ticker) {
                  setIntradayLoading(true);
                  setIntradayError("");
                  try {
                    const res = await api.getIntradayPattern(market, ticker);
                    setIntradayPattern(res);
                  } catch {
                    setIntradayError("장중 패턴 데이터를 불러오지 못했습니다");
                  } finally {
                    setIntradayLoading(false);
                  }
                }
              }}
              className="px-4 py-2 text-sm font-medium transition-colors"
              style={{
                borderBottom: activeTab === tab ? "2px solid var(--accent)" : "2px solid transparent",
                color: activeTab === tab ? "var(--accent)" : "var(--muted)",
                marginBottom: "-1px",
              }}
            >
              {tab === "chart" ? "차트 & 분석" : tab === "intraday" ? "장중 패턴" : "뉴스"}
            </button>
          ))}
        </div>
      )}

      {/* 차트 */}
      {activeTab === "chart" && chartData.length > 0 && (
        <div className="card">
          <h2 className="font-semibold mb-3">가격 차트</h2>
          <StockChart data={chartData} market={market} />
        </div>
      )}

      {/* 뉴스 탭 */}
      {activeTab === "news" && (
        <div className="space-y-3">
          {newsLoading && Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-4 rounded mb-2" style={{ background: "var(--card-border)", width: "88%" }} />
              <div className="h-3 rounded" style={{ background: "var(--card-border)", width: "35%" }} />
            </div>
          ))}
          {!newsLoading && newsArticles.length === 0 && (
            <div className="card text-sm text-center" style={{ color: "var(--muted)" }}>뉴스가 없습니다.</div>
          )}
          {!newsLoading && newsArticles.map((a, i) => (
            <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
              className="card block hover:opacity-80 transition-opacity" style={{ textDecoration: "none" }}>
              <p className="text-sm font-medium leading-snug mb-2" style={{ color: "var(--foreground)" }}>{a.title}</p>
              <div className="flex items-center gap-3 text-xs" style={{ color: "var(--muted)" }}>
                {a.source && <span>{a.source}</span>}
                {a.published && <span>{a.published}</span>}
              </div>
            </a>
          ))}
        </div>
      )}

      {/* 장중 패턴 탭 */}
      {activeTab === "intraday" && (
        <div className="card space-y-3">
          <div>
            <h2 className="font-semibold">일자별 궤적 겹쳐보기</h2>
            <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
              최근 {intradayPattern?.days_used ?? "60"}거래일 각각의 실제 하루 흐름(회색, 그날 시가 대비 %)을 그대로 겹쳐 그리고, 굵은 파란 선이 평균입니다.
            </p>
            <p className="text-xs mt-2 rounded-lg px-3 py-2" style={{ background: "#f59e0b1a", color: "#f59e0b" }}>
              ⚠️ 과거 평균적인 흐름을 보여주는 탐색용 참고 지표이며, 매매 신호나 다음 거래일 예측이 아닙니다.
            </p>
          </div>
          {intradayLoading && (
            <div className="text-center py-10 text-sm animate-pulse" style={{ color: "var(--muted)" }}>불러오는 중...</div>
          )}
          {!intradayLoading && intradayError && (
            <div className="text-center py-10 text-sm" style={{ color: "var(--muted)" }}>{intradayError}</div>
          )}
          {!intradayLoading && !intradayError && intradayPattern && intradayPattern.hours.length === 0 && (
            <div className="text-center py-10 text-sm" style={{ color: "var(--muted)" }}>
              시간대별 데이터를 구할 수 없습니다.
            </div>
          )}
          {!intradayLoading && !intradayError && intradayPattern && intradayPattern.hours.length > 0 && intradayPattern.daily_series.length > 0 && (
            <IntradaySpaghettiChart hours={intradayPattern.hours} dailySeries={intradayPattern.daily_series} />
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 기술적 분석 */}
        {activeTab === "chart" && technical && (
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
        {activeTab === "chart" && (prediction || predLoading) && (
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

      {/* 수급-가격 관계 분석 */}
      {activeTab === "chart" && market === "KR" && fundFlow.length > 0 && (
        <div className="card">
          <h2 className="font-semibold mb-3">수급-가격 관계 분석 (외국인·기관 누적순매수 vs 종가, 90일)</h2>
          <FlowPriceChart
            priceData={flowPriceData.map((d) => ({ date: d.date, close: d.close }))}
            flowData={fundFlow as Parameters<typeof FlowPriceChart>[0]["flowData"]}
          />
        </div>
      )}

      {/* 기업개요 + 재무제표 패널 */}
      {activeTab === "chart" && (overview || overviewLoading || financials || (financialsError && chartData.length > 0)) && (
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
