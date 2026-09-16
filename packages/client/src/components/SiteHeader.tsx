import { Link, useLocation } from "react-router-dom";

export function ArrowIcon({ back = false }: { back?: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={back ? { transform: "rotate(180deg)" } : undefined}
    >
      <path
        d="M4 12h15m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function SiteHeader() {
  const { pathname } = useLocation();
  return (
    <header className="site-header">
      <Link to="/" className="site-brand" aria-label="보드온라인 홈">
        <span className="site-brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span>보드온라인</span>
      </Link>
      <nav aria-label="주 메뉴">
        <span>로그인 없이, 가볍게 한 판.</span>
        {pathname === "/" ? (
          <a href="#games">게임 둘러보기</a>
        ) : (
          <Link to="/">게임 둘러보기</Link>
        )}
      </nav>
    </header>
  );
}
