# CLAUDE.md — 프로젝트 작업 지침

이 저장소는 온라인 고전 보드게임 플랫폼입니다. 작업 전에 `docs/` 아래 문서를 먼저 읽으세요.
특히 `docs/03-game-engine.md`(엔진 규격)와 `docs/05-guidelines.md`(개발 지침)는 코드 작성 시 반드시 따릅니다.

## 절대 규칙
- 게임 규칙 로직은 `packages/games/<id>/src/rules`에 **순수 함수**로만 작성한다. React, 소켓, DB import 금지.
- 온라인 대국의 진실은 서버다. 클라이언트에서 온 수는 서버가 같은 규칙 모듈로 재검증한다.
- 난수는 반드시 `packages/game-core`의 시드 RNG를 통해서만 사용한다 (`Math.random` 금지). 리플레이 재현성을 위해서다.
- 게임 상태는 JSON 직렬화 가능한 평범한 객체여야 한다 (클래스 인스턴스, Map/Set 금지).
- 타사 사이트의 말 디자인, UI, 효과음, 규칙 설명문을 복제하지 않는다. `docs/06-ip-policy.md` 참고.

## 코드 규약 요약
- TypeScript strict, ESLint + Prettier, 테스트는 Vitest.
- 게임 id는 소문자 ASCII: `chess`, `janggi`, `baduk`, `omok`, `checkers`, `yut`, `gonu`, `mancala`.
- 커밋 메시지는 Conventional Commits (`feat(omok): ...`, `fix(realtime): ...`).
- 새 게임은 `docs/03-game-engine.md`의 "게임 추가 절차"와 `docs/05-guidelines.md`의 DoD 체크리스트를 채워야 완료다.
