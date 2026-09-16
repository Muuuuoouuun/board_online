# Material design specification

## Direction selected for implementation

Lobby: `lobby-concept.png`. AI game: `game-concept.png`. Extend the existing nine-game application; keep all AI levels, local play, online rooms and janggi formations.

Ground is warm ivory #f5f3ee (not white); panels #fffdf8; charcoal ink #292820; forest olive #3d5141 actions; warm gray #dedbd2 borders. 1120–1280px centered desktop layout, 24px gutters, 12px card radius, 6px controls, restrained physical shadows. Korean serif headings (Noto Serif KR), Korean sans UI (Noto Sans KR/system), 56–64px hero, 24–28px section headings, 14–16px body and controls. Small four-square brand mark, consistent 18px line arrows. Subtle paper noise and real generated wood; never bake interaction text into photos.

Lobby anatomy: brand bar, editorial hero with generated still life on the right, horizontal room-code form, section title + global play mode, category navigation + global AI level, three-column photo-led catalogue of all nine registered games. Cards expose one action for the selected mode. Janggi retains its formation select. Responsive: hero stacks, join form stacks, mode wraps, cards become two then one column.

Allowed visible lobby copy: 보드온라인; 로그인 없이, 가볍게 한 판.; 게임 둘러보기; 마주 앉는 즐거움, 어디서나 한 판.; 친구와 함께, 또는 컴퓨터와 느긋하게.; 오래된 게임의 새로운 플레이 공간.; 컴퓨터와 한 판; 친구가 기다리고 있나요?; 초대받은 방 코드로 바로 입장하세요.; 방 코드 6자리; 입장하기; 오늘은 어떤 게임을 할까요?; 9가지 클래식, 취향대로 골라보세요. (count from registry); 컴퓨터 대전; 친구 초대; 같은 화면; 전체; 전략; 전통; 가볍게; 난이도; 쉬움/보통/어려움 from AI_LEVELS; engine names and player labels; 시작하기; factual per-game descriptions from catalogue.

AI screen: same brand bar, back link, serif game title + mode, large board left, compact player and settings panel right. Panel order: 한 수, 천천히.; player identities and actual turn; status; contextual game instruction; level; optional formation; swap sides; rules + sound; factual rule hint. Mobile board is above the settings panel; current turn stays above the board.

Intentional concept corrections: use the lobby's four-square logo on both screens; exclude invented prop slogans and decorative plants from generated mockups; use actual engine player labels (chess 백/흑, janggi 초/한) and actual playable grids; a new game starts empty, without decorative seeded stones. Keep original SVG piece silhouettes for state accuracy and refine their material shading. The photographic gonu thumbnail is an illustration, never a source for legal edges. No AI/game logic changes are required.

Assets: table-still-life (hero, edge fade only, no tint); game-atlas (3×3 equal photographic catalogue cells via CSS positioning); ash-wood (board grain under native SVG lines). All images generated via built-in Image Gen. Prompts recorded in prompts.md. Motion: small card lift, existing piece placement/slide; honor reduced motion.

## User correction — local play first

The user explicitly narrowed this pass to local two-player mode, not computer-opponent work. Default lobby mode and first segment are now 같은 화면; hero CTA is 둘이서 한 판 and opens /local/gomoku; support copy is 하나의 화면, 마주 앉은 두 사람. The play-screen concept is adapted to actual local players 흑/백, player 1/2, turn status, rules and sound. AI difficulty and swap controls are omitted from this local surface. Existing AI and online routes are retained without AI implementation changes. Local explanatory text replaces the AI-specific panel section.
