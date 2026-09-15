# 03. 게임 엔진 규격 — 인터페이스, 추가 절차, 테스트

## 1. 설계 원칙

1. **규칙은 순수 함수.** `applyMove(state, move) → state`. 입력이 같으면 출력이 같다. 부작용·전역 상태·`Math.random`·`Date.now` 금지.
2. **상태는 평범한 JSON.** 클래스, `Map`, `Set`, `undefined` 값 금지. 서버·클라·DB·워커 사이를 그대로 오간다.
3. **한 게임 = 한 패키지 = 한 `GameDefinition`.** 엔진(`game-core`)은 어떤 게임도 특별 취급하지 않는다. 오목에 있는 분기가 엔진에 들어가면 설계 실패다.
4. **엔진이 공통으로 책임지는 것**: 턴 관리 골격, 시드 RNG, 시계, 종료 판정 호출, 직렬화, 리플레이. **게임이 책임지는 것**: 판·말·합법수·승패·표기·UI·AI.

## 2. 핵심 인터페이스 (`packages/game-core`)

```ts
export type Seat = 0 | 1;                 // MVP는 2인. 다인은 number로 확장 (Phase 2)

export interface Rng {
  next(): number;                         // [0, 1)
  int(maxExclusive: number): number;
  state(): string;                        // 리플레이용 직렬화
}

export interface GameStatus {
  finished: boolean;
  winner?: Seat;
  draw?: boolean;
  reason?: string;                        // 'checkmate' | 'five_in_row' | 'no_moves' | 'agreement' | ...
  score?: Record<Seat, number>;           // 바둑 계가, 만칼라 씨앗 수 등
}

export interface GameDefinition<S, M, V = Record<string, unknown>> {
  id: string;                             // 'omok'
  version: number;                        // 규칙 변경 시 증가. 기보 호환성 판단
  players: { min: number; max: number };  // MVP는 {2, 2}
  variants: { default: V; schema: ZodType<V> };

  setup(variant: V, rng: Rng): S;
  currentSeat(state: S): Seat;
  legalMoves(state: S): M[];              // 유한해야 함. 바둑 착수처럼 많아도 OK (≤ 400)
  isLegal(state: S, move: M): boolean;    // 기본 구현: legalMoves 포함 여부. 성능상 오버라이드 가능
  applyMove(state: S, move: M, rng: Rng): S;  // rng는 윷 던지기 같은 난수 수에만 사용
  status(state: S): GameStatus;

  // 숨은 정보 게임(카드 등)을 위한 훅. MVP 게임은 모두 state 그대로 반환
  view?(state: S, seat: Seat | 'spectator'): S;

  // 특수 행위. 없으면 엔진이 기본 처리
  // - 무승부 제안/기권은 엔진 공통. 
  // - 바둑의 사석 표시·계가 합의처럼 "수"가 아닌 협상 단계는 phase 로 표현한다.
  phase?(state: S): 'play' | 'negotiate' | 'finished';

  notation: {
    encodeMove(state: S, move: M): string;   // 기보 한 줄. 예: 체스 SAN, 바둑 'Q16'
    decodeMove(state: S, text: string): M;
    encodeState(state: S): string;           // 테스트 픽스처용 (체스 FEN 등)
    decodeState(text: string, variant: V): S;
  };
}

export interface AIProvider<S, M> {
  levels: number[];                        // [1, 2]
  chooseMove(state: S, level: number, rng: Rng, budgetMs: number): M;
}
```

엔진이 제공하는 공통 래퍼:

```ts
// 대국 하나의 전 생애를 관리. realtime 서버와 클라이언트(AI/로컬 2인)가 동일하게 사용
export class MatchRunner<S, M, V> {
  constructor(def: GameDefinition<S, M, V>, opts: { variant: V; seed: string; clock?: ClockConfig });
  state(): S;
  ply(): number;
  moves(): M[];
  play(seat: Seat, move: M, atMs: number): Result<{ state: S; status: GameStatus }, MoveError>;
  resign(seat: Seat): void;
  offerDraw(seat: Seat): void; acceptDraw(seat: Seat): void;
  timeout(atMs: number): Seat | null;
  replayTo(ply: number): S;               // setup + 시드 RNG 재생성 + applyMove × ply
  serialize(): MatchRecord;               // {gameId, version, variant, seed, moves, clocks, result}
  static restore(def, record: MatchRecord): MatchRunner;
}
```

`MoveError`는 `'not_your_turn' | 'illegal' | 'stale_ply' | 'finished' | 'wrong_phase'` 중 하나. 서버는 이 코드를 그대로 ack로 돌려준다.

## 3. 시계

- 설정: `{ type: 'none' } | { type: 'absolute', initialMs } | { type: 'fischer', initialMs, incrementMs } | { type: 'byoyomi', initialMs, periods, periodMs }` (초읽기는 바둑·장기용, MVP 포함).
- 서버는 `play()`가 호출된 서버 시각으로만 차감한다. 클라가 보낸 시각은 무시.
- 클라는 `clock:tick`의 `serverTime`과 로컬 시각 차이를 추정해 보간만 한다.
- 시간패 판정은 서버 타이머가 한다. 클라가 "시간 끝났다"고 주장할 수 없다.

## 4. 게임 추가 절차 (신규 게임 체크리스트)

1. `docs/06-ip-policy.md`의 게임별 IP 체크리스트를 먼저 채운다 (🟢/🟡 판정, 명칭 검색 결과).
2. `packages/games/<id>` 생성 (템플릿 `pnpm gen:game <id>`로 뼈대 생성 — Phase 0에서 스크립트 작성).
3. `rules/`: 상태 타입 → `setup` → `legalMoves` → `applyMove` → `status` 순으로 구현. 규칙 출처를 `rules/SOURCES.md`에 적는다 (규칙을 어떤 공적 자료에서 정리했는지).
4. `notation.ts`: 픽스처를 손으로 쓸 수 있는 텍스트 표기를 먼저 정한다. 테스트가 이것에 의존한다.
5. `tests/rules.test.ts`: 규칙별 최소 1개 픽스처. 알려진 함정 포지션(체스 앙파상·캐슬링 조건, 바둑 패, 체커 연속 잡기 강제 등) 포함.
6. `tests/properties.test.ts`: 공통 속성 테스트를 그대로 붙인다 (아래 5절).
7. `ai/`: 레벨 1(합법수 무작위 + 즉승/즉패 처리) 필수. 레벨 2는 게임별.
8. `ui/Board.tsx`: `packages/ui`의 보드 프리미티브로 구성. 디자인 시스템 규칙(`04`) 준수.
9. `i18n/`: 게임명, 말 이름, 종료 사유, 규칙 30초 요약 (ko/en).
10. 레지스트리(`packages/games/index.ts`)와 카탈로그 메타(아이콘, 태그, 플레이 인원, 평균 시간)에 등록.
11. `docs/05-guidelines.md`의 DoD 체크리스트를 PR 본문에 붙이고 전부 체크.

## 5. 공통 속성 테스트 (모든 게임 필수)

```ts
// fast-check 로 시드 200개 × 게임당 무작위 플레이아웃
- 랜덤 합법수만 두면 항상 종료된다 (상한: 게임별 maxPlies, 예: 오목 225, 체스 600, 바둑 19줄 800)
- legalMoves()가 반환한 모든 수는 isLegal() === true
- isLegal() === false 인 임의 수에 applyMove 를 호출하면 예외가 아니라 명시적 거부 (엔진 래퍼 수준)
- applyMove 는 입력 state 를 변형하지 않는다 (deep-freeze 후 호출)
- encodeMove → decodeMove 왕복이 동일한 수
- encodeState → decodeState 왕복이 동일한 상태 (deep equal)
- 같은 seed + 같은 수 목록을 replayTo 하면 항상 같은 상태 (결정성)
- status().finished 가 true 인 뒤에는 legalMoves()가 빈 배열
```

## 6. 게임별 구현 노트

### 오목 `omok`
- 상태: `board: (0|1|2)[]` 길이 225, `toMove`, `lastMove`. 승리 판정은 마지막 착점 기준 4방향 스캔만.
- 옵션: `exactFive`(정확히 5만 승리, 6목 이상은 무효), `blackRestrictions`(삼삼·사사·장목 금수). 금수 판정은 렌주 규칙 정의를 문서화한 뒤 별도 모듈로. MVP 기본값은 둘 다 off.
- 무승부: 판이 가득 참.

### 고누 `gonu`
- MVP는 우물고누. 상태는 점(node)과 선(edge)으로 정의한 그래프 + 각 점의 점유. 판 형태를 그래프 데이터로 두면 호박고누·네줄고누는 데이터만 추가한다.
- 승리: 상대가 움직일 수 없으면 승. 규칙 출처(한국민속대백과사전 등)를 `SOURCES.md`에 기록하고, 지역 변형은 variant로 분리.

### 체커 `checkers`
- 영국식. 강제 잡기, 연속 잡기(같은 수 안에서 경로 전체가 하나의 `move`), 킹은 뒤로도 이동, 킹 승격 시 그 턴 종료.
- 합법수 생성: 잡는 수가 하나라도 있으면 잡는 수만 반환.
- 무승부: 40수 동안 잡기·승격 없음, 또는 3회 동형.

### 만칼라 `mancala`
- 칼라 규칙: 6×4, 반시계 뿌리기, 상대 창고 건너뜀, 마지막 씨앗이 내 창고 → 추가 턴, 내 빈 구덩이 → 맞은편 포획(맞은편이 비어 있으면 포획 없음, 옵션).
- 종료: 한쪽이 비면 남은 씨앗은 그쪽 소유. 점수 비교.
- 변형 `oware`는 Phase 2.

### 체스 `chess`
- 상태는 FEN과 1:1 대응 + 동형 반복 판정용 포지션 해시 목록.
- 캐슬링(경유 칸 공격 여부 포함), 앙파상(직전 수 조건), 승격(수에 promotion 필드), 50수 규칙, 3회 동형, 기물 부족 무승부.
- 표기: SAN(수), FEN(상태). 퍼프트(perft) 테스트로 합법수 생성기를 검증한다 (표준 포지션의 알려진 노드 수와 비교).

### 장기 `janggi`
- 9×10 교차점, 궁성 대각선. 초(청/녹)·한(적). 초기 배치는 마·상 순서를 양쪽이 각각 고름 → `setup` 이전에 variant 또는 첫 "배치 수"로 처리 (배치 선택을 ply 0·1의 특수 수로 두면 리플레이가 자연스럽다).
- 규칙: 장군/멍군, 한 수 쉬기(pass 수), 빅장(양쪽 왕이 마주 봄 → 무승부 제안 성격, MVP는 규칙 옵션), 외통.
- 표기: 좌표 `a1`~`i10` 식 자체 표기. 한국식 숫자 표기는 UI 표시 옵션.
- 점수제 판정(한 73.5 / 초 72 기준)은 Phase 2 옵션.

### 윷놀이 `yut`
- 상태: 각 팀 말 4개 위치(출발 전/판 위 노드/골인), 업힌 말 그룹, 남은 던지기 큐, `toMove`.
- 수 종류: `throw`(난수 수, rng 소비) / `move`(던진 결과 중 하나를 말 하나에 적용) / 규칙상 이동 불가 시 `pass`.
- 던지기 결과: 각 윷가락 평면이 위일 확률 `pFlat`(기본 0.6, variant로 0.5 가능). 도1 개2 걸3 윷4 모5. 윷·모·잡기 시 추가 던지기. 빽도(표시된 한 가락만 평면 위)는 variant.
- 말판: 29노드 그래프. 모(모서리)·방(중앙)에 **정확히 멈췄을 때만** 지름길 진입. 이동 규칙을 그래프의 "다음 노드" 함수로 두고, 출발점에서 진입 방향을 결정한다.
- 잡기·업기: 같은 노드에 도착 시 상대 말은 출발 전으로, 내 말은 업힘(함께 이동, 함께 잡힘).
- 승리: 말 4개 모두 골인.

### 바둑 `baduk`
- 상태: 판(9/13/19), 패 금지점, 포획 수, 연속 패스 수, phase.
- 착수금지(자살수), 패(단순 패만, 슈퍼코는 옵션).
- 두 번 연속 패스 → `phase: 'negotiate'`. 양쪽이 사석 표시(협상 액션)를 제출해 일치하면 계가, 불일치면 `play`로 복귀(다시 두 번 패스해야 재협상).
- 계가: MVP는 **면적 계가**(돌 + 둘러싼 빈 점, 덤 7.5). 한국식 집 계가(덤 6.5)는 Phase 2.
- 성능: 그룹·활로 계산은 union-find 또는 flood fill. 19줄 합법수 계산은 1ms 이내 목표.
- 표기: 좌표 `A1`~`T19`(I 생략). SGF 가져오기/내보내기는 Phase 2.

## 7. 다인 게임으로의 확장 (설계만 미리)

`Seat`을 `number`로, `players`를 `{min, max}`로 둔 것은 빙고·다인 윷놀이(팀전)를 위해서다. 엔진은 seat 수를 가정하지 않고, `currentSeat`이 반환하는 순서만 따른다. 팀은 `variant`에 `teams: Seat[][]`로 표현한다. MVP에서 구현하지는 않는다.
