# 02. 아키텍처 — 스택, 구조, 데이터, 프로토콜

## 1. 스택 결정 요약

| 영역 | 선택 | 대안(기각) | 이유 |
|---|---|---|---|
| 언어 | TypeScript 전면 | Go/Rust 서버 + TS 클라 | 규칙 모듈을 클라·서버가 **같은 코드**로 공유. 게임 추가 속도가 곧 제품 경쟁력 |
| 모노레포 | pnpm workspaces + Turborepo | Nx, 단일 레포 | 가볍고 캐시·병렬 빌드 충분 |
| 웹 프레임워크 | Next.js (App Router) + React | SvelteKit, Vite SPA | 학습·규칙 페이지 SEO, 이미지/폰트 최적화, 생태계. 대국 화면은 클라이언트 컴포넌트 |
| 스타일 | Tailwind CSS + CSS 변수 토큰 + Radix 프리미티브(shadcn/ui 방식) | CSS Modules, MUI | 토큰 기반 테마(라이트/다크/보드 스킨)를 CSS 변수로 통제 |
| 보드 렌더링 | **SVG** (React) | Canvas, PixiJS | DOM 접근성·키보드 조작·선명도·구현 단순성. 19×19 바둑도 성능 충분. 렌더러 교체 가능한 구조 유지 |
| 클라 상태 | Zustand + TanStack Query | Redux | 서버 상태(대국)와 UI 상태를 분리. 규모 대비 가벼움 |
| 실시간 | Node.js + Socket.IO (Fastify 위) | Colyseus, 순수 ws, Cloudflare Durable Objects | 재접속·ack·룸 기본 제공. 턴제라 상태 델타 동기화 불필요 → Colyseus 과함. DO는 Phase 3 재검토 |
| DB | PostgreSQL + Drizzle ORM | Prisma, MongoDB | 관계형 데이터(사용자·대국·수·레이팅). Drizzle은 SQL에 가깝고 가벼움 |
| 캐시/큐 | Redis | 없음 | 매칭 큐, 프레즌스, 룸 상태 스냅샷, 다중 인스턴스 pub/sub |
| 인증 | Better Auth (익명 세션 → 계정 전환 지원) | Auth.js, Supabase Auth | 게스트 → 계정 승계 흐름이 1급 기능 |
| 검증 | Zod | — | 프로토콜 메시지·API 입력 스키마를 타입과 함께 공유 |
| 테스트 | Vitest + fast-check + Playwright | Jest | 규칙 모듈 속성 기반 테스트, E2E는 대국 흐름 1개 |
| i18n | next-intl | i18next | App Router 친화 |
| 관측 | Sentry + PostHog | — | 에러, 퍼널(초대→대국 시작) |
| 호스팅 | 웹: Vercel / 실시간: Fly.io 또는 Railway / DB: Neon 또는 Supabase(Postgres만) / Redis: Upstash | 단일 VPS | 서버리스는 WebSocket 장기 연결 불가 → 실시간 서버는 상주 프로세스 |

## 2. 시스템 구성

```
┌─────────────────────────────┐        HTTPS         ┌─────────────────────────┐
│  브라우저 (Next.js 클라)     │◄────────────────────►│  apps/web (Next.js)      │
│  - 보드 UI (SVG)            │  페이지, API Route    │  - 로비/프로필/학습 페이지 │
│  - 규칙 모듈 (검증·힌트)     │                      │  - 인증 (Better Auth)     │
│  - AI (Web Worker)          │                      │  - 기보/레이팅 조회 API   │
│  - 로컬 2인 / AI 대국은      │                      └───────────┬─────────────┘
│    서버 없이 동작            │                                  │ Drizzle
│                             │   WebSocket (Socket.IO)          ▼
│                             │◄─────────────────────► ┌─────────────────────────┐
└─────────────────────────────┘                        │ apps/realtime (Node)     │
                                                       │  - 룸 생명주기          │
                                                       │  - 수 검증(규칙 모듈)    │
                                                       │  - 서버 시계            │
                                                       │  - 매칭 큐              │
                                                       │  - 종료 시 레이팅 계산   │
                                                       └───┬──────────────┬──────┘
                                                           │              │
                                                     ┌─────▼────┐   ┌─────▼────┐
                                                     │ Postgres │   │  Redis   │
                                                     │ 영구 저장 │   │ 큐/스냅샷 │
                                                     └──────────┘   └──────────┘
```

원칙:
1. **온라인 대국의 진실은 realtime 서버.** 클라이언트가 보낸 수는 서버가 같은 규칙 모듈로 검증하고, 검증된 수만 방송한다.
2. **AI 대국과 같은 기기 2인은 서버를 거치지 않는다.** 오프라인에서도 동작하고 서버 비용이 0이다. 레이팅에 반영하지 않는다.
3. **대국 기록은 "초기 옵션 + 시드 + 수 목록"만 저장**한다. 현재 상태는 언제든 `applyMove`를 재생해 복원한다 (리플레이·재접속·감사 모두 이 하나로 해결).
4. **난수는 서버가 시드를 만들고**, 규칙 모듈은 시드 RNG만 사용한다. 윷 던지기 결과를 클라가 조작할 수 없다.

## 3. 모노레포 구조

```
board_online/
├─ apps/
│  ├─ web/                 # Next.js — 로비, 대국 화면, 프로필, 학습, 인증
│  └─ realtime/            # Node + Socket.IO — 룸, 시계, 매칭, 수 검증
├─ packages/
│  ├─ game-core/           # GameDefinition 인터페이스, 시드 RNG, 시계, 공통 타입
│  ├─ games/
│  │  ├─ omok/  gonu/  checkers/  mancala/
│  │  ├─ chess/ janggi/ yut/      baduk/
│  │  └─ index.ts          # 레지스트리: id → definition (서버용, UI 제외)
│  ├─ rating/              # Glicko-2 구현 + 테스트
│  ├─ protocol/            # 클라↔서버 이벤트 Zod 스키마와 타입
│  ├─ db/                  # Drizzle 스키마, 마이그레이션, 쿼리 헬퍼
│  ├─ ui/                  # 디자인 토큰(CSS 변수), 공통 컴포넌트, 보드 프리미티브
│  └─ config/              # 공유 tsconfig / eslint / tailwind preset
├─ docs/
├─ .github/workflows/      # CI: typecheck, lint, test, build
├─ turbo.json
└─ pnpm-workspace.yaml
```

각 게임 패키지의 내부 구조(고정):

```
packages/games/omok/
├─ src/
│  ├─ rules/               # 순수 규칙. React/소켓/DB import 금지 (lint로 강제)
│  │  ├─ index.ts          #   export const omok: GameDefinition<OmokState, OmokMove>
│  │  ├─ state.ts, moves.ts, win.ts
│  ├─ ai/                  # 순수 함수. Web Worker에서 실행됨
│  │  └─ index.ts          #   export const omokAI: AIProvider<OmokState, OmokMove>
│  ├─ ui/                  # React SVG 보드. 클라 전용 엔트리
│  │  └─ Board.tsx
│  ├─ notation.ts          # 텍스트 표기(기보·테스트 픽스처)
│  └─ i18n/ ko.json en.json
├─ tests/
│  ├─ rules.test.ts        # 픽스처 기반 단위 테스트
│  └─ properties.test.ts   # 속성 기반: 랜덤 플레이아웃 종료·합법성
└─ package.json            # exports: ".", "./ai", "./ui"
```

`exports`를 셋으로 나누는 이유: realtime 서버는 `.`(rules)만 import 하고, React를 번들에 끌어들이지 않는다.

## 4. 데이터 모델 (Postgres)

```sql
users            (id, handle, display_name, email, avatar_url, created_at)
guest_sessions   (id, display_name, user_id NULL, created_at, last_seen_at)
                 -- 브라우저 쿠키에 묶인 익명 주체. 가입 시 user_id 연결(승계)

matches          (id, game_id, variant_json, seed, time_control_json, rated,
                  status: 'waiting'|'playing'|'finished'|'aborted',
                  result: 'p0'|'p1'|'draw'|NULL, result_reason,
                  created_at, started_at, finished_at)
match_players    (match_id, seat: 0|1, principal_type: 'user'|'guest'|'ai',
                  principal_id, rating_before, rating_after)
match_moves      (match_id, ply, move_json, clock_ms_after, played_at)
                 -- append-only. 상태는 재생으로 복원

ratings          (principal_id, game_id, rating, rd, volatility, games, updated_at)
rating_history   (principal_id, game_id, match_id, rating, rd, at)

rooms (Redis)    -- 대기·진행 중 룸의 스냅샷: 상태 JSON, 시계, 참가자 소켓, 만료 TTL
matchmaking (Redis) -- ZSET per (game_id, time_control): score = rating
```

- 게스트도 `ratings`를 가진다(`principal_id`가 guest id). 가입 승계 시 principal을 user로 재지정.
- `variant_json`: 판 크기(바둑 9/13/19), 오목 금수 여부, 윷 빽도 등 게임별 옵션.

## 5. 실시간 프로토콜 (Socket.IO 이벤트)

모든 페이로드는 `packages/protocol`의 Zod 스키마로 정의하고, 서버·클라가 같은 타입을 쓴다.

클라 → 서버 (ack 콜백으로 성공/오류 반환):

| 이벤트 | 페이로드 | 설명 |
|---|---|---|
| `room:create` | `{gameId, variant, timeControl, rated, seatPreference}` | 방 생성, `roomId` 반환 |
| `room:join` | `{roomId}` | 링크 입장. 두 번째 참가자면 자동 시작 |
| `room:leave` | `{roomId}` | 대기 중 나가기 |
| `queue:join` / `queue:leave` | `{gameId, timeControl}` | 랜덤 매칭 큐 |
| `game:move` | `{roomId, ply, move}` | `ply`는 낙관적 동시성 검사용(현재 수 번호와 다르면 거부) |
| `game:resign` / `game:draw_offer` / `game:draw_accept` / `game:rematch` | `{roomId}` | |
| `game:chat` | `{roomId, presetId}` | 정형 메시지만 (자유 채팅은 Phase 2) |
| `game:sync` | `{roomId}` | 재접속 시 전체 상태 요청 |

서버 → 클라:

| 이벤트 | 페이로드 | 설명 |
|---|---|---|
| `room:state` | `{room, players, status}` | 대기/시작/종료 상태 변화 |
| `game:full` | `{state, moves, clocks, ply}` | 입장·재접속 시 전체 상태 |
| `game:moved` | `{ply, move, clocks, by}` | 검증된 수 방송. 클라는 자기 규칙 모듈로 `applyMove` |
| `game:ended` | `{result, reason, ratingDelta?}` | |
| `clock:tick` | `{clocks, serverTime}` | 5초 간격 보정 + 수마다 갱신. 클라는 로컬 보간 |
| `presence` | `{seat, online}` | 상대 접속 상태 |
| `queue:matched` | `{roomId}` | |

재접속: 클라는 `roomId`와 세션 토큰으로 다시 붙고 `game:sync`를 보낸다. 서버는 소켓이 끊겨도 룸은 유지하며, 상대 이탈 시 시계는 계속 흐른다(시간패). 대기 중 방은 10분, 종료된 방은 1시간 뒤 Redis에서 만료되고 Postgres 기록만 남는다.

## 6. 서버 내부 구성 (apps/realtime)

```
RoomManager     룸 생성/조회/만료. 룸당 하나의 GameSession
GameSession     definition + state + moves + clocks. 수 검증·적용·방송. 단일 스레드 직렬 처리
ClockService    서버 타임스탬프 기준. 수 적용 시점에만 차감. 시간 초과 판정은 서버가
Matchmaker      Redis ZSET에서 레이팅 근접 상대를 주기적으로(1초) 페어링. 대기 시간에 비례해 허용 폭 확대
RatingService   종료 시 Glicko-2 계산 → ratings/rating_history 갱신
Persistence     수마다 match_moves append, 종료 시 matches 갱신 (비동기, 실패해도 대국은 진행)
```

MVP는 realtime 인스턴스 1대. 다중 인스턴스는 Socket.IO Redis adapter + 룸 소유 인스턴스 고정(roomId 해시)로 확장한다.

## 7. AI 실행 모델

- MVP AI는 각 게임 패키지 `ai/`에 순수 함수로 구현하고, 클라이언트 **Web Worker**에서 실행한다. 서버 비용 0, 오프라인 가능.
- 레벨 1: 무작위 합법수 + 즉시 승/패 회피. 레벨 2: 깊이 제한 미니맥스(알파베타) 또는 단순 휴리스틱. 레벨 3+: Phase 2.
- 외부 엔진(Stockfish, Fairy-Stockfish, KataGo 등)은 라이선스 검토 뒤 별도 워커/프로세스에서 UCI/GTP 프로토콜로 통신하는 방식만 허용한다. `docs/06-ip-policy.md` 참고.

## 8. 환경과 배포

| 환경 | 웹 | 실시간 | DB/Redis |
|---|---|---|---|
| local | `pnpm dev` (3000) | `pnpm dev` (4000) | docker compose (postgres, redis) |
| preview | Vercel 프리뷰 | Fly.io 프리뷰 앱 (PR별) | Neon 브랜치 |
| prod | Vercel | Fly.io 도쿄 `nrt` 리전 (서울 리전 없음, RTT 약 30~40ms) 또는 Railway 싱가포르 | Neon/Supabase + Upstash |

CI(GitHub Actions): `pnpm typecheck && pnpm lint && pnpm test` → main 머지 시 자동 배포.
