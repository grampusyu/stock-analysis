"use client";
import { useState, useEffect, useCallback } from "react";
import Navbar from "@/components/Navbar";
import { api, Holding, Market } from "@/lib/api";

export default function PortfolioPage() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ ticker: "", market: "KR" as Market, quantity: "", avg_price: "" });
  const [adding, setAdding] = useState(false);

  const fetchPortfolio = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getPortfolio();
      setHoldings(res.holdings);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPortfolio(); }, [fetchPortfolio]);

  const addHolding = async () => {
    if (!form.ticker || !form.quantity || !form.avg_price) return;
    setAdding(true);
    try {
      await api.addHolding({
        ticker: form.ticker.trim(),
        market: form.market,
        quantity: Number(form.quantity),
        avg_price: Number(form.avg_price),
      });
      setForm({ ticker: "", market: "KR", quantity: "", avg_price: "" });
      await fetchPortfolio();
    } finally {
      setAdding(false);
    }
  };

  const removeHolding = async (market: Market, ticker: string) => {
    await api.removeHolding(market, ticker);
    await fetchPortfolio();
  };

  const totalValue = holdings.reduce((sum, h) => sum + (h.total_value ?? 0), 0);
  const totalCost = holdings.reduce((sum, h) => sum + h.avg_price * h.quantity, 0);
  const totalProfitPct = totalCost > 0 ? (totalValue - totalCost) / totalCost * 100 : 0;

  return (
    <>
      <Navbar />
      <main className="p-6 space-y-6 max-w-7xl mx-auto w-full">
        <h1 className="text-2xl font-bold">포트폴리오</h1>

        {/* 요약 */}
        {holdings.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "총 평가금액", value: `${totalValue.toLocaleString()}` },
              { label: "총 매입금액", value: `${totalCost.toLocaleString()}` },
              { label: "총 수익률", value: `${totalProfitPct >= 0 ? "▲" : "▼"} ${Math.abs(totalProfitPct).toFixed(2)}%`, color: totalProfitPct >= 0 ? "positive" : "negative" },
            ].map(({ label, value, color }) => (
              <div key={label} className="card">
                <p className="muted text-xs mb-1">{label}</p>
                <p className={`text-xl font-bold ${color ?? ""}`}>{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* 종목 추가 */}
        <div className="card space-y-3">
          <h2 className="font-semibold">종목 추가</h2>
          <div className="flex flex-wrap gap-3">
            <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--card-border)" }}>
              {(["KR", "US"] as Market[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setForm((f) => ({ ...f, market: m }))}
                  className="px-4 py-2 text-sm font-medium transition-colors"
                  style={{ background: form.market === m ? "var(--accent)" : "transparent", color: form.market === m ? "#fff" : "var(--muted)" }}
                >
                  {m === "KR" ? "한국" : "미국"}
                </button>
              ))}
            </div>
            {[
              { key: "ticker", placeholder: form.market === "KR" ? "종목코드 (005930)" : "티커 (AAPL)" },
              { key: "quantity", placeholder: "수량" },
              { key: "avg_price", placeholder: "평균 매입가" },
            ].map(({ key, placeholder }) => (
              <input
                key={key}
                className="px-3 py-2 rounded-lg text-sm"
                style={{ background: "var(--background)", border: "1px solid var(--card-border)", color: "var(--foreground)", minWidth: 140 }}
                placeholder={placeholder}
                value={form[key as keyof typeof form]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              />
            ))}
            <button
              onClick={addHolding}
              disabled={adding}
              className="px-5 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: adding ? "var(--muted)" : "var(--accent)" }}
            >
              {adding ? "추가 중..." : "추가"}
            </button>
          </div>
        </div>

        {/* 보유 종목 */}
        {loading ? (
          <p className="muted text-sm">로딩 중...</p>
        ) : holdings.length === 0 ? (
          <div className="card text-center py-12">
            <p className="muted">보유 종목이 없습니다. 위에서 종목을 추가해보세요.</p>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="muted border-b" style={{ borderColor: "var(--card-border)" }}>
                  {["종목", "시장", "수량", "평균매입가", "현재가", "평가금액", "수익률", ""].map((h) => (
                    <th key={h} className="text-left py-2 px-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => (
                  <tr key={`${h.market}-${h.ticker}`} className="border-b" style={{ borderColor: "var(--card-border)" }}>
                    <td className="py-3 px-3">
                      <div className="font-medium">{h.name || h.ticker}</div>
                      <div className="text-xs muted">{h.ticker}</div>
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded text-xs" style={{ background: h.market === "KR" ? "#3b82f630" : "#10b98130", color: h.market === "KR" ? "#3b82f6" : "#10b981" }}>
                        {h.market}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono">{h.quantity.toLocaleString()}</td>
                    <td className="py-3 px-3 font-mono">{h.avg_price.toLocaleString()}</td>
                    <td className="py-3 px-3 font-mono">{h.current_price?.toLocaleString() ?? "-"}</td>
                    <td className="py-3 px-3 font-mono">{h.total_value?.toLocaleString() ?? "-"}</td>
                    <td className={`py-3 px-3 font-medium ${(h.profit_pct ?? 0) >= 0 ? "positive" : "negative"}`}>
                      {(h.profit_pct ?? 0) >= 0 ? "▲" : "▼"} {Math.abs(h.profit_pct ?? 0).toFixed(2)}%
                    </td>
                    <td className="py-3 px-3">
                      <button
                        onClick={() => removeHolding(h.market, h.ticker)}
                        className="text-xs muted hover:text-red-400 transition-colors"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
