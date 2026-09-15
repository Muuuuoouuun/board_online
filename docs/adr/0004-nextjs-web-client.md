# ADR-0004: 웹 클라이언트는 Next.js (App Router)

- 상태: 채택 (2026-09)
- 맥락: 로비·학습·프로필·리플레이 공유 페이지는 SEO와 OG 미리보기가 중요(초대 링크가 메신저에 카드로 보임). 대국 화면은 클라이언트 렌더.
- 결정: Next.js + React. 대국 화면과 게임 UI는 클라이언트 컴포넌트로 동적 import. 스타일은 Tailwind + CSS 변수 토큰, 컴포넌트는 Radix 기반(shadcn/ui 방식으로 소스 소유).
- 대안: SvelteKit(훌륭하나 React Native/생태계 경로 약함), Vite SPA(SEO·OG 처리 별도 필요).
- 결과: 웹은 Vercel 배포. 향후 모바일은 같은 React 컴포넌트를 Capacitor로 래핑(ADR-0005).
