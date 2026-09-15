# 05. 개발 지침 — 규약, 완료 기준, 워크플로

## 1. 불변 원칙 (어기면 리뷰 반려)

1. 규칙 모듈(`packages/games/*/src/rules`)은 React·Socket·DB·Node API를 import 하지 않는다. ESLint `no-restricted-imports`로 강제.
2. 온라인 대국에서 클라이언트가 보낸 수는 서버가 반드시 재검증한다. "클라에서 이미 검증했다"는 이유로 건너뛰지 않는다.
3. `Math.random`, `Date.now` 는 규칙·AI 코드에서 금지. RNG와 시각은 인자로 받는다.
4. 게임 상태는 JSON 직렬화 가능한 평범한 객체. 클래스·Map·Set·undefined 금지.
5. 타사 서비스의 말 디자인·UI·효과음·규칙 설명문을 복제하지 않는다.
6. 사용자 입력(닉네임, 정형 메시지 id, 수)은 Zod 스키마로 검증한 뒤에만 처리한다.

## 2. 게임 완료 기준 (Definition of Done)

PR 본문에 아래를 붙이고 전부 체크해야 "게임 추가 완료"다.

```
- [ ] IP 체크리스트 작성 (docs/06 §4) 및 티어 🟢 확정
- [ ] rules/SOURCES.md 에 규칙 출처 기록
- [ ] GameDefinition 전체 구현 (setup / legalMoves / applyMove / status / notation)
- [ ] 공통 속성 테스트 통과 (docs/03 §5)
- [ ] 규칙별 픽스처 테스트 ≥ 규칙 수 (함정 포지션 포함)
- [ ] AI 레벨 1 구현, Web Worker 에서 100ms 이내 응답
- [ ] Board UI: 탭·드래그·키보드 3종 입력, 마지막 수·합법수·선택 하이라이트
- [ ] 모바일 375px 폭에서 보드가 잘리지 않고 터치 영역 44px 이상
- [ ] 라이트/다크 모두 대비 기준 충족
- [ ] i18n ko/en: 게임명, 말 이름, 종료 사유, 30초 규칙 요약
- [ ] 카탈로그 메타 등록 (아이콘, 태그, 인원, 평균 시간)
- [ ] E2E: 링크 초대 → 첫 수 → 종료 → 결과 화면 1회 통과
- [ ] 리플레이에서 처음부터 끝까지 재생 가능
```

## 3. 코드 규약

- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. `any` 금지(불가피하면 `// eslint-disable-next-line` + 사유).
- ESLint(typescript-eslint, react-hooks, import 순서) + Prettier. CI에서 `--max-warnings 0`.
- 파일명: 컴포넌트 `PascalCase.tsx`, 그 외 `kebab-case.ts`. 게임 id는 소문자 ASCII.
- 함수는 작게, 규칙 함수는 입력→출력이 명확하게. 상태 변경은 항상 새 객체 반환(구조 공유 허용, 변형 금지).
- 주석은 "왜"만. 규칙 코드에는 규칙 출처 조항을 주석으로 단다 (`// FIDE 3.7.e: 승격`).
- 에러는 `Result` 타입(성공/실패 유니온)으로 반환. 규칙 코드에서 `throw`는 프로그래밍 오류(불변식 위반)에만.

## 4. 테스트 규약

| 층 | 도구 | 범위 | 실행 |
|---|---|---|---|
| 규칙 단위 | Vitest | 픽스처 포지션, 표기 왕복 | PR마다 |
| 규칙 속성 | fast-check | 랜덤 플레이아웃 결정성·종료·합법성 | PR마다 (시드 200) |
| 서버 통합 | Vitest + 실제 Socket.IO 클라 | 방 생성→입장→수→종료, 재접속, 시간패 | PR마다 |
| E2E | Playwright | 초대 링크 대국 1회, AI 대국 1회 | main 머지 전 |
| 성능 | Vitest bench | 바둑 19줄 legalMoves < 1ms, 체스 perft(4) < 2s | 주 1회 |

## 5. 브랜치·커밋·리뷰

- `main`은 항상 배포 가능. 작업은 `feat/<scope>-<desc>`, `fix/…` 브랜치에서 PR.
- 커밋: Conventional Commits. scope는 패키지/앱 이름 (`feat(omok): 금수 옵션`, `fix(realtime): 재접속 시 시계 보정`).
- PR은 작게(한 게임 = 규칙 PR → UI PR → AI PR로 나눠도 됨). 셀프 머지 금지, 1인 프로젝트면 24시간 뒤 셀프 리뷰 후 머지.
- CI 필수 통과: typecheck, lint, test. 실패한 테스트를 skip 처리해 통과시키지 않는다.

## 6. i18n

- 모든 사용자 노출 문자열은 메시지 키. 코드에 한국어 문자열 직접 쓰지 않는다.
- 게임 패키지가 자기 문자열(`i18n/ko.json`, `en.json`)을 소유하고, 앱이 병합한다.
- 말 이름·수 표기는 로케일별로 다를 수 있다 (장기 車/차, 체스 N/나). 표기는 `notation`이 아닌 표시 층에서 변환.
- 날짜·숫자는 `Intl` 사용.

## 7. 보안·공정성

- 서버가 진실: 수 검증, 시계, 난수, 결과 판정 모두 서버.
- 세션: httpOnly 쿠키. 게스트 id도 서명된 쿠키. 방 입장 토큰은 roomId와 별개로 추측 불가(랜덤 22자).
- Socket 이벤트마다 rate limit (수: 초당 5, 채팅: 초당 1). 수 페이로드 크기 제한 1KB.
- 닉네임: 길이 2~16, 제어문자 금지, 금칙어 필터(기본 목록 + 신고).
- 상대 정보 노출 최소화: 상대의 이메일·IP·기기 정보는 어떤 이벤트에도 싣지 않는다.
- 랜덤 매칭 이탈(중도 종료) 패널티: 연속 이탈 시 매칭 대기 시간 증가 (Phase 2).

## 8. 성능 예산

| 항목 | 예산 |
|---|---|
| 대국 화면 첫 인터랙션(LCP) | 모바일 4G 2.5초 이내 |
| 게임 패키지 UI 번들 | 게임당 60KB gzip 이하 (동적 import) |
| 수 → 상대 화면 반영 | 서버 처리 20ms 이내 + 네트워크 |
| 서버 메모리 | 동시 대국 1,000개 기준 512MB 이내 |

## 9. 문서 유지

- 아키텍처 결정은 `docs/adr/NNNN-*.md`에 남긴다. 결정을 뒤집을 때는 새 ADR로 "supersedes"를 명시한다.
- 규칙 변경(예: 오목 기본 옵션 변경)은 `GameDefinition.version`을 올리고 CHANGELOG에 기록한다. 옛 기보는 옛 버전 규칙으로 재생한다.
