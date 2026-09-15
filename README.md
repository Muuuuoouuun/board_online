# 보드온라인 (Board Online) — 초기 MVP

로그인 없이 방 코드 하나로 친구와 바로 즐기는 무료 온라인 보드게임 플랫폼입니다.

## 포함된 게임

| 게임 | 규칙 요약 |
| --- | --- |
| 오목 (Gomoku) | 15×15 교차점, 자유형(렌주 금수 규칙 없음), 5목 완성 시 승리 |
| 체스 (Chess) | 캐슬링·앙파상·프로모션·체크메이트까지 표준 규칙 전체 ([chess.js](https://github.com/jhlywa/chess.js) 사용) |
| 장기 (Janggi) | 9×10 교차점, 궁성 대각선, 포/마/상의 다리·묘 막힘, 장군/외통장군까지 직접 구현 |
| 체커 (Checkers) | 8×8, 강제 잡기 + 연속 점프, 킹 프로모션 |
| 리버시 (Reversi/Othello) | 8×8, 자동 패스 처리, 돌 개수로 승패 판정 |
| 고누 (우물고누) | 5점 7선, 왼쪽 변이 없는 "우물" 구조, 움직일 수 없으면 패배 (60수 무승부) |
| 윷놀이 | 29칸 판과 지름길, 도개걸윷모(윷가락 4개 독립 확률), 윷·모·잡기 시 추가 던지기, 잡기·업기 |
| 땅따먹기 (선 그리기) | 14×14, 내 땅에서 선을 그려 되돌아오면 둘러싼 칸까지 차지, 도중에 닿으면 턴 넘어감 |
| 땅따먹기 (돌 튕기기) | 연속 공간에서 3번 튕겨 내 땅으로 돌아오면 지나온 영역 차지 |

아홉 게임 모두 수백 년 이상 된 고전/전통 게임의 **규칙(아이디어)** 만 구현한 것으로,
저작권 보호 대상이 아닌 영역입니다. 보드·말 디자인과 코드는 전부 자체 제작했습니다.
(향후 게임을 더 추가할 때는 README 하단 "게임 추가 가이드"와 함께, 특정 회사의 구체적 표현물
— 아트, UI, 텍스트, 이름 — 을 베끼지 않도록 주의하세요.)

## 아키텍처

npm workspaces 모노레포로 구성했습니다.

```
packages/
  shared/   각 게임의 규칙 엔진 (순수 TypeScript, 서버/클라이언트 공용)
  server/   Express + Socket.IO 실시간 서버 (계정 없음, 방은 메모리에만 보관)
  client/   React + Vite 프론트엔드
```

- **shared**: 게임마다 `createInitialState / legalMoves / applyMove / status / pieces`
  를 구현하는 `GameEngine` 인터페이스 하나로 통일했습니다. 서버는 이걸로 수를 검증하고,
  클라이언트도 같은 엔진을 그대로 import해서 합법수 하이라이트를 계산합니다(로직 중복 없음).
- **server**: 계정/DB 없이 방 코드(6자리)로만 동작하는 실시간 대전 서버입니다. 방 상태는
  전부 메모리에 있고, 아무도 접속하지 않은 방은 주기적으로 정리됩니다. 새로고침해도
  `localStorage`에 저장된 좌석 토큰으로 같은 자리를 되찾습니다.
- **client**: 게임별로 보드를 따로 그리지 않고, `GameMeta`(보드 크기, 격자 스타일, 팔레트)
  와 `BoardPiece[]`만 있으면 모든 게임을 그릴 수 있는 범용 `<Board>` 컴포넌트 하나로
  오목/장기 같은 "교차점" 보드와 체스/체커/리버시 같은 "칸" 보드를 전부 처리합니다.

## 로컬 개발

```bash
npm install
npm run dev:server   # http://localhost:3001 (Socket.IO + API)
npm run dev:client   # http://localhost:5173 (Vite dev server)
```

두 명령을 각각 다른 터미널에서 실행하세요. 브라우저 탭 두 개(또는 시크릿창)로
`http://localhost:5173`을 열어 한쪽에서 방을 만들고 다른 쪽에서 방 코드로 입장하면
바로 대국할 수 있습니다.

엔진 자체 테스트(합법수 개수, 룰 검증 등):

```bash
npm run test:engine
```

## 배포 (무료 호스팅 기준)

프로덕션에서는 서버 하나가 API + Socket.IO + 빌드된 클라이언트 정적 파일을 모두
서빙하도록 만들어서, Render/Railway/Fly.io 같은 무료·저가 플랜 하나에만 올리면 됩니다.

```bash
npm run build   # client(dist) 빌드 후 server가 그 dist를 서빙하도록 구성됨
npm start       # PORT 환경변수(기본 3001)로 단일 프로세스 실행
```

### Docker로 올리기 (어느 호스팅이든 동일)

`Dockerfile` 하나로 빌드부터 실행까지 끝납니다.

```bash
docker build -t board-online .
docker run -p 3001:3001 board-online
```

- **Render** — 이 저장소를 Render에 연결하면 `render.yaml`을 읽어 서비스를 자동 생성합니다.
- **Fly.io** — `fly launch` (Dockerfile을 감지합니다) 후 `fly deploy`.
- **Railway / Cloud Run** — 저장소를 연결하면 Dockerfile을 그대로 사용합니다.

서버는 `PORT` 환경변수를 읽으므로 호스팅이 지정하는 포트를 그대로 따릅니다.

### 배포 전에 알아둘 제약

- **상시 구동이 필요합니다.** Socket.IO는 연결을 계속 열어두므로 서버리스/엣지 타깃에는
  맞지 않습니다. 컨테이너·VM 기반 플랜을 쓰세요.
- **방은 메모리에만 있습니다.** 서버가 재시작되거나 프리티어 인스턴스가 슬립하면 진행 중이던
  대국이 전부 사라집니다(의도된 MVP 제약). 프리티어는 첫 방문자가 콜드 스타트를 기다립니다.
- **서버는 `tsx`로 TypeScript를 직접 실행합니다.** 별도 컴파일 단계가 없어서 `tsx`가
  devDependency가 아니라 server의 **런타임 dependency**입니다 — 프로덕션 설치에서 빼면
  서버가 뜨지 않습니다.

## 지금 MVP가 의도적으로 하지 않는 것

- 로그인/계정, 전적, 레이팅, 랭킹
- 관전, 채팅, 친구 목록
- AI(컴퓨터) 상대
- 마작
- 체스 무승부 제안/기권, 기보 저장

전부 "공통 게임 엔진 + 게임 카탈로그" 구조 위에서 자연스럽게 얹을 수 있도록
설계는 해두었습니다(예: 레이팅은 서버의 방 종료 이벤트에 훅만 추가하면 됨).

## 게임 추가 가이드

1. `packages/shared/src/games/<game>.ts`에 `GameEngine<TState, TMove>`를 구현
2. `packages/shared/src/index.ts`의 `ENGINES`, `GAME_LIST`에 등록
3. **격자 게임이면 여기서 끝입니다** — 서버와 범용 `<Board>`가 `GameEngine`
   인터페이스만으로 자동 동작합니다.
4. 격자가 아닌 보드라면 `meta.renderer`에 이름을 선언하고,
   `packages/client/src/components/boards/`에 `GameViewProps`를 받는 렌더러를 만든 뒤
   `GameView.tsx`의 분기에 추가하세요 (윷놀이·땅따먹기가 이 방식입니다).
5. 규칙 텍스트는 `packages/client/src/lib/rules.*.ts`에 두고 `rules.ts`에서 합칩니다.

엔진을 쓸 때 지켜야 할 것:

- **상태는 JSON 직렬화 가능해야 합니다** — Socket.IO로 오가고 서버 메모리에 보관됩니다.
  `Map`/`Set`/클래스 인스턴스 금지.
- **무작위는 반드시 `rng` 파라미터를 통해서** 쓰세요 (`const random = rng ?? Math.random`).
  서버가 자기 RNG를 넘기므로 서버 권위가 유지되고, 시드를 고정하면 테스트가 재현됩니다.
- `legalMoves`가 내놓은 수는 `applyMove`가 반드시 받아야 합니다. 자체 테스트가 이를 퍼징합니다.
- 잘못된 수는 예외를 던지지 말고 `{ ok: false }`로 거부하세요. 네트워크에서 들어오는
  수는 `applyMoveSafely` 경계를 거치지만, 엔진도 스스로 방어하는 편이 낫습니다.
- 새 게임을 추가하기 전에 규칙(아이디어)과 특정 회사의 구체적 표현물(아트·카드
  텍스트·로고)을 구분해서, 후자를 베끼지 않았는지 확인하세요.
