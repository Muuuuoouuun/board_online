# board_online — 온라인 고전 보드게임 플랫폼

브라우저에서 바로 접속해 체스·장기·바둑·오목·체커·윷놀이·고누·만칼라를
친구 / 랜덤 매칭 / AI / 같은 기기 2인으로 두는 웹 플랫폼입니다.
장기 비전은 "전 세계 고전 보드게임의 Steam"이며, MVP는 **웹 전용 8종**입니다.

> 현재 상태: **기획 단계**. 코드는 아직 없고 `docs/`에 설계 문서만 있습니다.

## 문서 지도

| 문서 | 내용 |
|---|---|
| [docs/01-product.md](docs/01-product.md) | 비전, 타깃, MVP 범위, 게임 카탈로그와 IP 티어, 화면 목록, 성공 지표 |
| [docs/02-architecture.md](docs/02-architecture.md) | 기술 스택, 시스템 구성, 모노레포 구조, 데이터 모델, 실시간 프로토콜, 인프라 |
| [docs/03-game-engine.md](docs/03-game-engine.md) | 공통 게임 엔진 인터페이스, 게임 추가 절차, 테스트 규약, 게임별 구현 노트 |
| [docs/04-design-system.md](docs/04-design-system.md) | 비주얼 아이덴티티, 디자인 토큰, 타이포, 보드/말 아트 디렉션, 레이아웃, 모션, 사운드, 접근성 |
| [docs/05-guidelines.md](docs/05-guidelines.md) | 개발 지침, 게임 완료 기준(DoD), 코드 규약, 브랜치/CI, i18n, 보안 |
| [docs/06-ip-policy.md](docs/06-ip-policy.md) | 저작권·상표 정책, 게임별 체크리스트, 서드파티 라이선스 |
| [docs/07-roadmap.md](docs/07-roadmap.md) | 단계별 로드맵, 마일스톤, 리스크 |
| [docs/08-asset-pipeline.md](docs/08-asset-pipeline.md) | 디자인 자산 파이프라인: 생성형 AI 모델·도구 선택, 질감·기물·애니메이션·사운드 제작과 단계별 디벨롭 |
| [docs/adr/](docs/adr/) | 아키텍처 결정 기록 (왜 이 스택인지) |

## 한눈에 보는 핵심 결정

- **TypeScript 모노레포** (pnpm workspaces + Turborepo). 규칙 코드를 클라이언트와 서버가 공유하기 위해 언어를 하나로 고정.
- **웹 클라이언트**: Next.js + React + Tailwind CSS. 보드는 **SVG**로 렌더링.
- **실시간 서버**: Node.js + Socket.IO. 저장소는 PostgreSQL(Drizzle ORM), 캐시/큐는 Redis.
- **게임 규칙은 순수 TS 모듈** (`packages/games/*`). 서버가 유일한 진실(authoritative), 클라이언트는 같은 모듈로 검증·힌트만 수행.
- **게스트 우선**: 로그인 없이 링크 하나로 한 판. 계정은 기록·레이팅을 남기고 싶을 때.
- **모바일**: 웹 우선 → PWA → Capacitor 래핑. 보드 UI는 SVG 프리미티브만 사용해 이식 가능성 유지.

## MVP 게임 8종

| 게임 | id | 구현 순서 | 난이도 |
|---|---|---|---|
| 오목 | `omok` | 1 | 하 |
| 고누 (우물고누) | `gonu` | 2 | 하 |
| 체커 | `checkers` | 3 | 중 |
| 만칼라 | `mancala` | 4 | 하 |
| 체스 | `chess` | 5 | 중상 |
| 장기 | `janggi` | 6 | 중상 |
| 윷놀이 | `yut` | 7 | 중 (난수·다중 말) |
| 바둑 | `baduk` | 8 | 상 (계가) |
