# 08. 디자인 자산 파이프라인 — 어떤 모델·도구로 무엇을 만들까

> 질문: "질감, 기물, 애니메이션, 소리를 최소한으로 먼저 만들고 차차 발전시키려면 무엇을 써야 하나?"
> 답의 골자: **8종 중 그림이 필요한 자산은 체스 기물 6종과 로비 아이콘 8개뿐이다.** 나머지 기물·판·질감은 코드(SVG)로 만든다. 생성형 AI는 무드보드·텍스처·마케팅 이미지에 쓰고, 소유권이 중요한 기물·아이콘·로고는 사람이 벡터로 마무리한다.

## 1. 먼저 결정할 것: 무엇을 그리고, 무엇을 코드로 만들까

| 자산 | 제작 방식 | 이유 |
|---|---|---|
| 바둑돌 · 오목돌 · 고누 말 · 체커 말 | **코드 SVG** (원 + 방사형 그라데이션) | 그림 불필요. 색·크기를 토큰으로 제어 |
| 장기 기물 | **코드 SVG** (팔각형 + Noto Serif KR 한자) | 글자가 곧 디자인 |
| 윷가락 · 윷판 · 만칼라 판 · 씨앗 | **코드 SVG** | 도형 조합 |
| 체스판 · 바둑판 · 격자 | **코드 SVG** | |
| 나무 · 종이 질감 | **코드 SVG 필터** (`feTurbulence`) | 용량 0, 다크 모드 대응, 스킨별 변형 쉬움 |
| **체스 기물 6종** | Figma에서 직접 벡터 제작. AI는 참고 시트만 | 소유권·일관성·상표 리스크 |
| **로비 게임 아이콘 8개** (24px 단색) | Figma에서 직접 제작 | 24px 글리프는 손이 더 빠르고 정확 |
| 로고 · 워드마크 | AI로 후보 탐색 → 사람이 벡터화 | 상표 출원 시 인간 저작 필요 |
| 게임 상세 히어로 · OG 이미지 · 마케팅 비주얼 | 생성형 AI 직접 사용 | 독점 소유가 중요하지 않음 |
| 프리미엄 보드 스킨 텍스처 (Phase 2) | AI 타일 텍스처 → 흑백 오버레이로 후처리 | |
| 효과음 5종 | 직접 녹음 + Audacity 정리 (대안: CC0, AI SFX) | 고유성·소유권 |

원칙 하나: **AI가 만든 결과물을 그대로 "우리 자산"으로 두지 않는다.** 한국 문화체육관광부·저작권위원회의 생성형 AI 저작권 안내와 미국 저작권청 지침 모두, 사람의 창작적 기여 없이 AI가 만든 산출물은 저작권 보호가 어렵다고 본다. 남이 베껴도 막을 수 없는 자산에 브랜드를 걸지 않는다. AI → 사람이 Figma에서 다시 그림 → 그 결과가 우리 저작물.

## 2. 생성형 AI 모델 선택표

2026년 9월 기준. 모델은 빠르게 바뀌므로 "어떤 성질을 보고 고르는가"를 기준으로 적었다.

| 용도 | 1순위 | 대안 | 고르는 기준 |
|---|---|---|---|
| 스타일 탐색·무드보드 (기물 실루엣, 판 분위기) | Midjourney (`--sref`로 스타일 고정, `--tile`로 타일 텍스처) | Google Nano Banana 계열(Gemini 이미지), OpenAI GPT Image | 한 세트 안의 **일관성** 기능이 있는가 |
| 플랫 아이콘·기물 **벡터 초안** | **Recraft V3** (SVG 직접 출력, Style로 세트 일관성) | GPT Image(투명 배경 PNG) → vectorizer.ai / Inkscape trace | SVG를 내는가, 아니면 래스터를 벡터화해야 하는가 |
| 텍스트 지시 정확도가 중요한 이미지 (규칙 설명 삽화, OG 카드) | GPT Image | Nano Banana, Ideogram 3 | 지시 준수·텍스트 렌더링 |
| 기존 이미지 부분 수정 (색 바꾸기, 배경 제거, 톤 통일) | Nano Banana 계열 | GPT Image 편집, Flux Kontext | 편집 정합성 |
| 로고·워드마크 후보 | Ideogram 3, Recraft | Midjourney | 글자 렌더링 |
| 타일 텍스처 (나무·천·종이) | Midjourney `--tile` | Stable Diffusion/Flux 타일링 워크플로 | 이음매 없는 출력 |
| 로컬·오픈 모델이 필요할 때 | Flux.1 **schnell** (Apache 2.0) | SDXL | **라이선스**: Flux `dev` 계열은 비상업 → 사용 금지 |

라이선스 메모:
- Midjourney·Recraft·Ideogram·ElevenLabs는 **유료 플랜에서만** 상업 이용. 무료 플랜 산출물은 공개·비상업 조건이 붙는 경우가 많다.
- OpenAI 이미지 API 산출물은 이용약관상 사용자에게 권리가 귀속된다. 다만 위 "AI 산출물 저작권" 한계는 동일.
- 모든 AI 산출물은 `assets/ai-refs/`에 두고, 최종 자산(`packages/ui/assets/`)과 분리한다. 최종 자산 폴더에는 사람이 만든 SVG만 들어간다.

## 3. 기물 제작 세부

### 3.1 코드로 만드는 기물 (MVP 대부분)

바둑돌 하나를 `<symbol>`로 정의하고 `<use>`로 찍는다. 그라데이션은 토큰 색을 기준으로 밝기만 바꾼다.

```svg
<defs>
  <radialGradient id="stone-black" cx="35%" cy="30%" r="70%">
    <stop offset="0"   stop-color="#4A4A4A"/>
    <stop offset="1"   stop-color="var(--piece-black)"/>
  </radialGradient>
  <radialGradient id="stone-white" cx="35%" cy="30%" r="70%">
    <stop offset="0"   stop-color="#FFFFFF"/>
    <stop offset="1"   stop-color="#CFC9BE"/>
  </radialGradient>
  <symbol id="stone-b" viewBox="0 0 1 1"><circle cx=".5" cy=".5" r=".46" fill="url(#stone-black)"/></symbol>
  <symbol id="stone-w" viewBox="0 0 1 1"><circle cx=".5" cy=".5" r=".46" fill="url(#stone-white)" stroke="rgba(0,0,0,.12)" stroke-width=".02"/></symbol>
</defs>
<use href="#stone-b" x="3" y="15" width="1" height="1"/>
```

장기 기물: 팔각형 + 글자. 왕>차>포·마·상>사·졸 4단계 크기는 `width/height` 스케일로만 처리한다.

```svg
<symbol id="janggi-red-cha" viewBox="0 0 1 1">
  <polygon points=".3,.05 .7,.05 .95,.3 .95,.7 .7,.95 .3,.95 .05,.7 .05,.3"
           fill="#F3E7C9" stroke="var(--piece-red)" stroke-width=".06"/>
  <text x=".5" y=".5" text-anchor="middle" dominant-baseline="central"
        font-family="Noto Serif KR" font-weight="700" font-size=".52" fill="var(--piece-red)">車</text>
</symbol>
```

### 3.2 손으로 그리는 기물: 체스 6종

절차:
1. Midjourney/Recraft로 "flat, two-tone, no outline, Staunton silhouette" 무드보드 20~30장 생성. **기존 사이트 기물을 프롬프트에 언급하지 않는다** (그 스타일이 복제될 위험).
2. Figma에서 1×1 아트보드(100×100)에 킹부터 6종 실루엣을 펜 툴로 직접 그린다. 규칙: 외곽선 없음, 2톤(본체 + 하이라이트 1색), 하단 받침 폭 통일(0.7), 높이 킹 0.9 / 퀸 0.85 / 룩 0.7 / 비숍 0.8 / 나이트 0.8 / 폰 0.6.
3. 흑은 `--piece-black` + 밝은 하이라이트, 백은 `--piece-white` + 어두운 하이라이트. 백 기물에는 0.02 두께 대비선(다크 모드 판에서 분리).
4. 24px, 48px, 96px에서 실루엣 식별 테스트(나이트·비숍 혼동 여부).
5. SVGO로 최적화 → `packages/ui/assets/pieces/chess/{wK,wQ,...}.svg`. Figma 원본 링크와 export 날짜를 `ASSETS.md`에 기록.

### 3.3 로비 아이콘 8개

Lucide 규격(24px 그리드, 2px 선, 둥근 끝)에 맞춰 직접 그린다. 체스=나이트 실루엣, 바둑=돌 3개, 장기=팔각형+글자, 오목=5개 점 대각선, 체커=겹친 원반, 윷놀이=윷가락 4개, 고누=우물 격자, 만칼라=구덩이 열. Lucide 아이콘 그대로 쓰지 않는 이유는 로비 카드가 서비스 정체성이기 때문.

## 4. 질감: 코드로 만드는 최소 질감

이미지 텍스처 대신 SVG 필터. 판 배경 사각형 하나에만 적용하므로 성능 부담이 없다.

```svg
<defs>
  <!-- 나무결: 가로로 늘어진 난류 -->
  <filter id="wood" x="0" y="0" width="1" height="1">
    <feTurbulence type="fractalNoise" baseFrequency="0.015 0.35" numOctaves="3" seed="7" result="noise"/>
    <feColorMatrix in="noise" type="matrix"
      values="0 0 0 0 0.35   0 0 0 0 0.22   0 0 0 0 0.08   0 0 0 0.18 0" result="tint"/>
    <feBlend in="SourceGraphic" in2="tint" mode="multiply"/>
  </filter>
  <!-- 종이·천: 고주파 미세 노이즈 -->
  <filter id="paper" x="0" y="0" width="1" height="1">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n"/>
    <feColorMatrix in="n" type="saturate" values="0" result="g"/>
    <feComponentTransfer in="g" result="soft"><feFuncA type="linear" slope="0.05"/></feComponentTransfer>
    <feBlend in="SourceGraphic" in2="soft" mode="multiply"/>
  </filter>
</defs>
<rect width="19" height="19" fill="var(--board-wood)" filter="url(#wood)"/>
```

- 강도는 `feFuncA slope`나 알파(0.18)로 조절. 기본은 **"있는 듯 없는 듯"**. 라이트 모드 0.15, 다크 모드 0.10.
- `seed`를 스킨별로 바꾸면 무늬가 달라진다. 스킨 = 색 토큰 + seed + baseFrequency 3개 값.
- 저사양 모바일에서 끊기면: 빌드 시 같은 필터를 512×512 WebP로 굽고(`scripts/bake-textures.ts`, headless Chromium) `<pattern>`으로 대체. 실측 전에는 필터 그대로 쓴다.
- AI 타일 텍스처는 Phase 2 프리미엄 스킨에서만. 사용할 때도 컬러 원본이 아니라 **흑백 오버레이(multiply, 알파 0.1~0.2)**로만 얹어 토큰 색이 판을 지배하게 한다.

## 5. 애니메이션

### 5.1 라이브러리

| 층 | 선택 | 용도 |
|---|---|---|
| 기본 | **CSS transition / keyframes** | 기물 이동, 하이라이트 페이드, 버튼 |
| React 연출 | **Motion** (`motion` 패키지, 구 Framer Motion, MIT) | 결과 배너, 바텀 시트, 레이아웃 전환, 순차(stagger) 효과 |
| 타임라인 | GSAP (2025년부터 전면 무료) | 만칼라 뿌리기, 윷 던지기처럼 단계가 많은 시퀀스. MVP는 Motion의 `stagger`로 충분하면 생략 |
| 벡터 연출 | Rive (런타임 MIT, 에디터 무료 티어) | Phase 2: 윷가락 회전, 승리 연출, 로딩 마스코트 |

Lottie는 After Effects 의존과 파일 크기 때문에 쓰지 않는다. SVG SMIL은 브라우저 지원이 애매해 쓰지 않는다.

### 5.2 기물 이동은 "같은 DOM 노드가 움직인다"로 푼다

React에서 기물을 **칸이 아니라 기물 id로 key**를 주면, 수가 두어져도 같은 `<g>`가 남아 `transform`만 바뀐다. CSS transition 한 줄로 이동 애니메이션이 끝난다.

```tsx
// 잘못된 방식: key={square} → 기물이 사라졌다 생기므로 애니메이션 불가
// 올바른 방식
{pieces.map(p => (
  <g key={p.id} className="piece" style={{ transform: `translate(${p.x}px, ${p.y}px)` }}>
    <use href={`#piece-${p.kind}`} width="1" height="1" />
  </g>
))}
```

```css
.piece { transition: transform 160ms cubic-bezier(.2,.8,.2,1); will-change: transform; }
.piece[data-captured] { transition: opacity 150ms, transform 150ms; opacity: 0; transform: scale(.6); }
@media (prefers-reduced-motion: reduce) { .piece { transition: none; } }
```

잡힌 기물은 즉시 제거하지 말고 `data-captured`를 붙인 뒤 150ms 후 제거한다(`onTransitionEnd`).

### 5.3 게임별 최소 연출 (MVP)

| 게임 | 연출 | 구현 |
|---|---|---|
| 공통 | 이동 160ms, 잡기 페이드+축소, 마지막 수 하이라이트 페이드인 | CSS |
| 바둑·오목 | 착수 시 돌이 0.85→1.0 스케일로 "놓임" 80ms | CSS keyframes |
| 체스·장기 | 장군 시 왕 주변 붉은 링 펄스 2회 | CSS keyframes |
| 만칼라 | 씨앗이 구덩이마다 60ms 간격으로 순차 도착, 숫자 카운트업 | Motion `stagger` |
| 윷놀이 | 윷가락 4개가 0.5초간 뒤집히다 결과로 정착, 결과 글자 팝 | Motion 키프레임 (Phase 2에 Rive로 교체) |
| 결과 | 배너 아래서 200ms 슬라이드, 승리 시 액센트색 테두리 글로우 1회 | Motion |

## 6. 사운드

### 6.1 소스 확보 3가지 경로 (우선순위 순)

1. **직접 녹음.** 실제 바둑돌을 나무판에 놓는 소리, 체스 기물을 판에 놓는 소리, 윷 던지는 소리를 스마트폰으로 조용한 방에서 녹음. Audacity(무료)로 노이즈 제거 → 앞뒤 자르기 → 정규화(-3dB) → 페이드아웃 30ms. 하루면 끝나고, 완전히 우리 소유이며, 다른 서비스와 절대 같지 않다.
2. **CC0 라이브러리.** Kenney.nl(인터페이스·UI 오디오 팩, CC0), freesound.org(라이선스 필터 "Creative Commons 0"만). 출처를 `packages/ui/sounds/LICENSES.md`에 적는다. CC BY는 고지 의무가 생기므로 피한다.
3. **AI 효과음 생성.** ElevenLabs Sound Effects(유료 플랜 상업 이용), Stable Audio Open(연매출 100만 달러 미만 무료 커뮤니티 라이선스). Meta AudioGen/AudioCraft는 CC-BY-NC(비상업)이므로 **사용 금지**. AI 생성음도 Audacity에서 손을 봐 최종본을 만든다.

### 6.2 MVP 5종 규격

| 이벤트 | 성격 | 길이 |
|---|---|---|
| 착수/이동 | 짧고 둔탁한 "톡" | 80~120ms |
| 잡기 | 착수보다 낮고 무거운 "툭" | 120~180ms |
| 장군/체크 | 짧은 두 음 상승 | 200ms |
| 종료 | 승/패/무 3변주 (승 상승 3음, 패 하강 2음, 무 단음) | 400~600ms |
| 저시간 경고 | 20초, 10초에 1회 틱 | 60ms |

게임별 변주는 Phase 1 후반: 바둑·오목·고누는 돌 소리, 체스·체커는 나무 기물 소리, 장기는 조금 더 두꺼운 소리, 윷은 던지기 전용, 만칼라는 씨앗 구르는 소리.

### 6.3 재생 구현

- **Howler.js**(MIT). 오디오 스프라이트 1파일(`ui.webm` + `ui.mp3` 폴백)에 오프셋으로 5종을 담아 요청 1회.
- 첫 사용자 제스처(첫 클릭)에서 `Howler.ctx.resume()` 호출해 모바일 자동재생 정책 해제.
- 설정 토글은 `localStorage`에 저장. 기본값: 데스크톱 on, 모바일 off.

```ts
import { Howl } from 'howler';
export const ui = new Howl({
  src: ['/sounds/ui.webm', '/sounds/ui.mp3'],
  sprite: { move: [0, 110], capture: [200, 160], check: [400, 200], win: [700, 550], lose: [1300, 450], draw: [1800, 300], lowtime: [2200, 60] },
  volume: 0.6,
});
export const play = (id: keyof typeof ui['_sprite']) => { if (settings.sound) ui.play(id); };
```

파일이 하나도 없어도 동작하는 **합성 폴백**을 둔다. 녹음 전 개발 단계와 오프라인 AI 대국에 쓴다.

```ts
export function clickTone(ctx: AudioContext, freq = 180, ms = 90) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(freq, ctx.currentTime);
  g.gain.setValueAtTime(0.4, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + ms / 1000);
  o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + ms / 1000);
}
```

## 7. 도구와 폴더 규약

| 역할 | 도구 | 메모 |
|---|---|---|
| 벡터 원본 | Figma (무료 티어) | 페이지: Tokens / Icons / Chess Pieces / Boards / Screens |
| SVG 최적화 | SVGO (`pnpm svgo`) | `removeViewBox: false`, id는 유지(`symbol` 참조) |
| 래스터→벡터 | vectorizer.ai 또는 Inkscape Trace Bitmap | AI 초안을 벡터로 옮길 때만 |
| 오디오 편집 | Audacity | 프로젝트 파일은 `assets/audio-src/`에 보관 |
| 텍스처 굽기 | Playwright headless Chromium 스크립트 | 필요할 때만 |
| 목업 | Figma 또는 Claude Design 캔버스 | 대국 화면 3종(데스크톱/모바일/다크) 먼저 |

```
assets/                      # 저장소 루트. 원본과 참고 자료 (배포에 포함되지 않음)
├─ ai-refs/                  # AI 생성 참고 이미지. 최종 자산으로 쓰지 않음
├─ figma/                    # Figma 파일 링크, export 기록 (ASSETS.md)
└─ audio-src/                # 녹음 원본, Audacity 프로젝트, 출처 기록
packages/ui/
├─ assets/pieces/chess/*.svg # 사람이 만든 최종 SVG
├─ assets/icons/games/*.svg
├─ sounds/ui.webm, ui.mp3, LICENSES.md
└─ tokens.css
```

## 8. 단계별 디벨롭 계획

| 단계 | 시점 | 질감 | 기물 | 애니메이션 | 사운드 |
|---|---|---|---|---|---|
| **L0 최소** | Phase 0~1 | `feTurbulence` 나무·종이 2종 | 전부 코드 SVG + 체스 기물 v1(직접 벡터) + 아이콘 8개 | CSS 이동·잡기·하이라이트, Motion 결과 배너 | 합성 폴백 → 직접 녹음 5종 |
| **L1 다듬기** | MVP 공개 + 4주 | 스킨 3종(나무/종이/다크 슬레이트), 강도 설정 | 체스 기물 v2(피드백 반영), 장기 한글 표기 세트 | 만칼라 뿌리기·바둑 착수 스케일·장군 펄스 | 게임별 변주(돌/나무/윷/씨앗) |
| **L2 연출** | Phase 2 | AI 타일 기반 프리미엄 스킨(흑백 오버레이), 계절 스킨 | 체스 기물 대체 세트 1종(추상형), 커스텀 돌 색 | Rive 윷 던지기·승리 연출, 햅틱(모바일) | 앰비언트 옵션(찻집·바람), 초읽기 음성(바둑) |
| **L3** | Phase 3 | 사용자 제작 스킨 마켓 검토 | 3D는 하지 않는다. 2D SVG가 정체성 | 관전 리플레이 자동 재생 연출 | 게임별 사운드 팩 판매 검토 |

각 단계에서 지키는 것: 질감은 판 위 정보(마지막 수·합법수)를 절대 가리지 않는다. 애니메이션은 한 수당 200ms를 넘기지 않는다. 사운드는 5종을 넘길 때마다 "이게 없으면 뭐가 불편한가"를 먼저 묻는다.

## 9. 참고 기준점 (베끼기 금지, 배우기만)

- lichess: 대국 화면 정보 위계(보드·시계·수 목록)와 속도. 기물·색은 보지 않는다.
- online-go.com: 바둑 사석 표시·계가 UX 흐름.
- Board Game Arena: 다게임 로비의 카탈로그 구조. 시각 스타일은 참고하지 않는다.
- Apple Chess / 닌텐도 세계의 게임 51: "최소 질감 + 조용한 연출"의 톤.
