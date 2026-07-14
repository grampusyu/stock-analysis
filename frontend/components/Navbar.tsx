"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "대시보드" },
  { href: "/stock", label: "종목 분석" },
  { href: "/sectors", label: "섹터 분석" },
  { href: "/portfolio", label: "포트폴리오" },
  { href: "/news", label: "뉴스" },
];

export default function Navbar() {
  const pathname = usePathname();
  return (
    <nav
      className="flex items-center gap-8 px-6 py-4 border-b"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}
    >
      <span className="text-lg font-bold" style={{ color: "var(--accent)" }}>
        StockDash
      </span>
      <div className="flex gap-4">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="text-sm font-medium transition-colors"
            style={{
              color: pathname === l.href ? "var(--accent)" : "var(--muted)",
            }}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
