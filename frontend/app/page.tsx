import Navbar from "@/components/Navbar";
import { api } from "@/lib/api";
import Link from "next/link";

async function MarketSummary() {
  try {
    const data = await api.getMarketSummary();
    return (
      <div className="flex gap-4">
        {Object.entries(data).map(([name, v]) => (
          <div key={name} className="card flex-1">
            <p className="muted text-xs mb-1">{name}</p>
            <p className="text-xl font-bold">{v.close?.toLocaleString()}</p>
            <p className={`text-sm font-medium ${v.change_pct >= 0 ? "positive" : "negative"}`}>
              {v.change_pct >= 0 ? "▲" : "▼"} {Math.abs(v.change_pct).toFixed(2)}%
            </p>
          </div>
        ))}
      </div>
    );
  } catch {
    return <p className="muted text-sm">시장 데이터를 불러올 수 없습니다 (백엔드 실행 필요)</p>;
  }
}

async function TopMovers({ market }: { market: "KR" | "US" }) {
  try {
    const data = await api.getTopMovers(market);
    const gainers = data.gainers as Array<{
      ticker?: string;
      name?: string;
      change_pct: number;
      [key: string]: unknown;
    }>;
    return (
      <div className="card">
        <h3 className="font-semibold mb-3 text-sm">{market === "KR" ? "KOSPI" : "미국"} 급등주</h3>
        <div className="space-y-2">
          {gainers.map((s, i) => (
            <div key={i} className="flex justify-between items-center text-sm">
              <span>{s.name || s.ticker}</span>
              <span className="positive font-medium">+{s.change_pct.toFixed(2)}%</span>
            </div>
          ))}
        </div>
      </div>
    );
  } catch {
    return <div className="card"><p className="muted text-sm">데이터 없음</p></div>;
  }
}

export default function Home() {
  return (
    <>
      <Navbar />
      <main className="p-6 space-y-6 max-w-7xl mx-auto w-full">
        <div>
          <h1 className="text-2xl font-bold mb-1">대시보드</h1>
          <p className="muted text-sm">한국·미국 주식 시장 현황</p>
        </div>

        <section>
          <h2 className="text-sm font-semibold muted mb-3 uppercase tracking-wide">국내 시장</h2>
          <MarketSummary />
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TopMovers market="KR" />
          <TopMovers market="US" />
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { href: "/stock", label: "종목 분석", desc: "차트·기술적 지표·AI 예측", icon: "📈" },
            { href: "/sectors", label: "섹터 분석", desc: "섹터별 자금 흐름·수익률", icon: "🏭" },
            { href: "/portfolio", label: "포트폴리오", desc: "보유 종목 수익률 관리", icon: "💼" },
          ].map((item) => (
            <Link key={item.href} href={item.href} className="card hover:border-blue-500 transition-colors block">
              <div className="text-2xl mb-2">{item.icon}</div>
              <h3 className="font-semibold mb-1">{item.label}</h3>
              <p className="text-sm muted">{item.desc}</p>
            </Link>
          ))}
        </section>
      </main>
    </>
  );
}
