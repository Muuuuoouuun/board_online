import { gomokuEngine } from "./games/gomoku.js";
import { reversiEngine } from "./games/reversi.js";
import { checkersEngine } from "./games/checkers.js";
import { chessEngine } from "./games/chess.js";
import { janggiEngine } from "./games/janggi.js";
import { flickEngine } from "./games/flick.js";
import { gonuEngine, getGonuLayout, type GonuState, type GonuVariant } from "./games/gonu.js";
import { yutEngine } from "./games/yut.js";
import { territoryEngine } from "./games/territory.js";
import type { GameEngine, Move } from "./types.js";
import { applyMoveSafely } from "./index.js";

let failures = 0;
let checks = 0;

function assert(cond: boolean, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

function ok(msg: string) {
  console.log(`ok  - ${msg}`);
}

// --- Gomoku: force a horizontal 5-in-a-row for player 0 ---
{
  let state = gomokuEngine.createInitialState();
  const p0Moves: [number, number][] = [[3, 3], [4, 3], [5, 3], [6, 3], [7, 3]];
  const p1Moves: [number, number][] = [[3, 4], [4, 4], [5, 4], [6, 4]];
  for (let i = 0; i < p0Moves.length; i++) {
    const r0 = gomokuEngine.applyMove(state, { to: { x: p0Moves[i][0], y: p0Moves[i][1] } }, 0);
    assert(r0.ok, `gomoku move ${i} for p0 should be legal`);
    state = r0.state;
    if (i < p1Moves.length) {
      const r1 = gomokuEngine.applyMove(state, { to: { x: p1Moves[i][0], y: p1Moves[i][1] } }, 1);
      assert(r1.ok, `gomoku move ${i} for p1 should be legal`);
      state = r1.state;
    }
  }
  assert(state.status === "win" && state.winner === 0, "gomoku: player 0 should win with 5 in a row");
  ok("gomoku 5-in-a-row win detected");
}

// --- Reversi: opening move flips exactly one disc, and legal move count is 4 ---
{
  const state = reversiEngine.createInitialState();
  const legal = reversiEngine.legalMoves(state, 0);
  assert(legal.length === 4, `reversi: black should have 4 opening moves, got ${legal.length}`);
  const r = reversiEngine.applyMove(state, { to: { x: 3, y: 2 } }, 0);
  assert(r.ok, "reversi: d3-style opening move should be legal");
  if (r.ok) {
    const blackCount = r.state.board.flat().filter((c) => c === 0).length;
    assert(blackCount === 4, `reversi: after opening move black should have 4 discs, got ${blackCount}`);
  }
  ok("reversi opening move + flip count correct");
}

// --- Checkers: classic fact - exactly 7 legal opening moves ---
{
  const state = checkersEngine.createInitialState();
  const legal = checkersEngine.legalMoves(state, 0);
  assert(legal.length === 7, `checkers: expected 7 opening moves, got ${legal.length}`);
  ok("checkers opening move count == 7");
}

// --- Chess: classic fact - exactly 20 legal opening moves ---
{
  const state = chessEngine.createInitialState();
  const legal = chessEngine.legalMoves(state, 0);
  assert(legal.length === 20, `chess: expected 20 opening moves, got ${legal.length}`);
  ok("chess opening move count == 20 (chess.js wired correctly)");
}

// --- Janggi: hand-verified opening facts about the default formation ---
{
  const state = janggiEngine.createInitialState();
  const legal = janggiEngine.legalMoves(state, 0);

  const cannonMoves = legal.filter((m) => m.from!.x === 1 && m.from!.y === 7);
  assert(cannonMoves.length === 0, `janggi: cannon at (1,7) should have 0 opening moves, got ${cannonMoves.length}`);

  const horseMoves = legal.filter((m) => m.from!.x === 2 && m.from!.y === 9);
  assert(
    horseMoves.length === 1 && horseMoves[0].to.x === 3 && horseMoves[0].to.y === 7,
    `janggi: horse at (2,9) should have exactly 1 move to (3,7), got ${JSON.stringify(horseMoves)}`,
  );

  const elephantMoves = legal.filter((m) => m.from!.x === 1 && m.from!.y === 9);
  assert(
    elephantMoves.length === 1 && elephantMoves[0].to.x === 3 && elephantMoves[0].to.y === 6,
    `janggi: elephant at (1,9) should have exactly 1 move to (3,6), got ${JSON.stringify(elephantMoves)}`,
  );

  assert(legal.length > 0, "janggi: opening position should have legal moves");
  ok(`janggi opening facts verified (${legal.length} total legal moves for Cho)`);
}

// --- Janggi 마상 formations: each option must place the horses/elephants it names ---
{
  const expected: Record<string, [string, string, string, string]> = {
    마상상마: ["horse", "elephant", "elephant", "horse"],
    상마마상: ["elephant", "horse", "horse", "elephant"],
    마상마상: ["horse", "elephant", "horse", "elephant"],
    상마상마: ["elephant", "horse", "elephant", "horse"],
  };
  for (const [formation, want] of Object.entries(expected)) {
    const state = janggiEngine.createInitialState(formation);
    const at = (x: number, y: number) => state.board[y][x]?.type ?? "empty";
    const got = [at(1, 9), at(2, 9), at(6, 9), at(7, 9)];
    assert(
      JSON.stringify(got) === JSON.stringify(want),
      `janggi ${formation}: Cho back rank should be ${want.join(",")}, got ${got.join(",")}`,
    );
    // Player 1 sits opposite, so their rank is the mirror in absolute coordinates.
    const mirrored = [at(7, 0), at(6, 0), at(2, 0), at(1, 0)];
    assert(
      JSON.stringify(mirrored) === JSON.stringify(want),
      `janggi ${formation}: Han back rank should mirror Cho's, got ${mirrored.join(",")}`,
    );
    const pieceCount = janggiEngine.pieces(state).length;
    assert(pieceCount === 32, `janggi ${formation}: expected 32 pieces, got ${pieceCount}`);
  }
  const fallback = janggiEngine.createInitialState("존재하지않는배치");
  assert(fallback.formation === "상마마상", "janggi: unknown setup id should fall back to the default formation");
  // The pickers display setupOptions[0] before the player touches them, so it has
  // to describe the same board the engine builds with no setup id.
  const firstOption = janggiEngine.meta.setupOptions?.[0].id;
  assert(
    firstOption === fallback.formation,
    `janggi: setupOptions[0] (${firstOption}) must match the default formation (${fallback.formation})`,
  );
  ok("janggi formations: all 4 setups place horses/elephants correctly and mirror for Han");
}

// --- Janggi hanja glyphs: the two sides use different characters for general and soldier ---
{
  const state = janggiEngine.createInitialState();
  const glyphs = janggiEngine.pieces(state);
  const choGeneral = glyphs.find((p) => p.owner === 0 && p.highlight);
  const hanGeneral = glyphs.find((p) => p.owner === 1 && p.highlight);
  assert(choGeneral?.glyph === "楚", `janggi: Cho general should be 楚, got ${choGeneral?.glyph}`);
  assert(hanGeneral?.glyph === "漢", `janggi: Han general should be 漢, got ${hanGeneral?.glyph}`);
  const choSoldier = glyphs.find((p) => p.owner === 0 && p.pos.y === 6);
  const hanSoldier = glyphs.find((p) => p.owner === 1 && p.pos.y === 3);
  assert(choSoldier?.glyph === "卒", `janggi: Cho soldier should be 卒, got ${choSoldier?.glyph}`);
  assert(hanSoldier?.glyph === "兵", `janggi: Han soldier should be 兵, got ${hanSoldier?.glyph}`);
  const hanjaOnly = glyphs.every((p) => /[楚漢士車包馬象卒兵]/.test(p.glyph));
  assert(hanjaOnly, "janggi: every piece should render as hanja");
  ok("janggi hanja glyphs verified (楚/漢 generals, 卒/兵 soldiers)");
}

// --- Gonu: every board the picker offers must build, and an unknown id falls back ---
{
  const ids = gonuEngine.meta.setupOptions?.map((o) => o.id) ?? [];
  assert(ids.length === 3, `gonu: expected 3 boards in setupOptions, got ${ids.length}`);
  for (const id of ids) {
    const state = gonuEngine.createInitialState(id);
    assert(state.variant === id, `gonu: createInitialState("${id}") should build that board, got ${state.variant}`);
    const layout = getGonuLayout(state.variant);
    assert(
      state.cells.length === layout.points.length,
      `gonu ${id}: state has ${state.cells.length} points, layout has ${layout.points.length}`,
    );
    assert(gonuEngine.legalMoves(state, 0).length > 0, `gonu ${id}: 흑 must have an opening move`);
  }
  const fallback = gonuEngine.createInitialState("존재하지않는말밭");
  assert(fallback.variant === "umul", `gonu: unknown setup id should fall back to 우물고누, got ${fallback.variant}`);
  // The pickers show setupOptions[0] before anyone touches them, so it has to be
  // the same board createInitialState() builds with no id at all.
  assert(ids[0] === gonuEngine.createInitialState().variant, "gonu: setupOptions[0] must match the default board");
  ok("gonu: 우물/호박/넉줄 boards all build, unknown id falls back to 우물고누");
}

/** Builds an arbitrary gonu position for a rules check. */
function gonuPosition(variant: GonuVariant, cells: (0 | 1 | null)[], turn: 0 | 1, plies = 4): GonuState {
  return {
    variant,
    cells,
    turn,
    status: "ongoing",
    winner: null,
    reason: "",
    plies,
    quiet: 0,
    taken: [0, 0],
    last: null,
  };
}

// --- 우물고누: the opening tradition bans is refused, and it would in fact win on the spot ---
{
  const start = gonuEngine.createInitialState("umul");
  const layout = getGonuLayout("umul");
  const banned = layout.bannedOpening!;
  const from = layout.points[banned.from];
  const to = layout.points[banned.to];

  const opening = gonuEngine.legalMoves(start, 0);
  assert(
    !opening.some((m) => m.from!.x === from.x && m.from!.y === from.y && m.to.x === to.x && m.to.y === to.y),
    "우물고누: 첫수 금지 move must not be offered",
  );
  const refused = gonuEngine.applyMove(start, { from, to }, 0);
  assert(!refused.ok, "우물고누: 첫수 금지 move must be refused");
  assert(
    (refused.error ?? "").includes("첫수"),
    `우물고누: refusal should explain the 첫수 rule, got "${refused.error}"`,
  );

  // Why it is banned: played out, it leaves 백 with nowhere at all to go.
  const after = [...start.cells];
  after[banned.from] = null;
  after[banned.to] = 0;
  const trapped = gonuPosition("umul", after as (0 | 1 | null)[], 1);
  assert(
    gonuEngine.legalMoves(trapped, 1).length === 0,
    "우물고누: the banned opening must really be an instant trap (otherwise the ban is pointless)",
  );

  // And the other opening is fine.
  const legal = gonuEngine.applyMove(start, opening[0], 0);
  assert(legal.ok, "우물고누: the remaining opening must be playable");
  assert(legal.state.status === "ongoing", "우물고누: the legal opening must not end the game");
  ok("우물고누: 첫수 금지 enforced, and it is a real instant trap");
}

// --- 우물고누: trapping the opponent ends the game ---
{
  // 백 on SE+SW, 흑 on NE and the centre, NW open: 흑 steps NE→NW and 백, cut off
  // from the centre by the well, has nothing left.
  const state = gonuPosition("umul", [null, 0, 1, 1, 0], 0);
  const layout = getGonuLayout("umul");
  const result = gonuEngine.applyMove(state, { from: layout.points[1], to: layout.points[0] }, 0);
  assert(result.ok, "우물고누: NE→NW should be legal");
  assert(
    result.state.status === "win" && result.state.winner === 0,
    `우물고누: trapping 백 should win for 흑, got ${result.state.status}/${result.state.winner}`,
  );
  ok("우물고누: 상대를 가두면 그 자리에서 승리");
}

// --- 호박고누: a stone that left its camp can never go back in ---
{
  const layout = getGonuLayout("hobak");
  const [blackHome, whiteHome] = layout.homes!;
  const start = gonuEngine.createInitialState("hobak");

  // Camp stones shuffling inside their own camp is fine.
  const out = gonuEngine.applyMove(start, gonuEngine.legalMoves(start, 0)[0], 0);
  assert(out.ok, "호박고누: 흑 should be able to leave the camp");
  const insideCamp = gonuEngine
    .legalMoves(out.state, 1)
    .concat(gonuEngine.legalMoves({ ...out.state, turn: 0 } as GonuState, 0))
    .some((m) => {
      const to = layout.points.findIndex((p) => p.x === m.to.x && p.y === m.to.y);
      const from = layout.points.findIndex((p) => p.x === m.from!.x && p.y === m.from!.y);
      return blackHome.includes(to) && blackHome.includes(from);
    });
  assert(insideCamp, "호박고누: stones still in their camp should be able to shift within it");

  // But a stone out on the ring may not re-enter any camp.
  const gate = layout.adj[blackHome[1]].find((i) => !blackHome.includes(i) && !whiteHome.includes(i))!;
  const cells: (0 | 1 | null)[] = layout.points.map(() => null);
  cells[gate] = 0; // 흑 stone out on the ring, right next to its own camp
  cells[blackHome[0]] = 0;
  cells[whiteHome[0]] = 1;
  cells[whiteHome[1]] = 1;
  const position = gonuPosition("hobak", cells, 0);
  const homeward = gonuEngine.legalMoves(position, 0).filter((m) => {
    const to = layout.points.findIndex((p) => p.x === m.to.x && p.y === m.to.y);
    const fromIdx = layout.points.findIndex((p) => p.x === m.from!.x && p.y === m.from!.y);
    return fromIdx === gate && (blackHome.includes(to) || whiteHome.includes(to));
  });
  assert(homeward.length === 0, `호박고누: a stone off the camp must not re-enter one (${homeward.length} such moves)`);
  ok("호박고누: 진영을 나온 말은 어느 진영에도 다시 들어가지 못함");
}

// --- 넉줄고누: sandwiching takes a stone, walking into a sandwich does not ---
{
  const layout = getGonuLayout("neokjul");
  const at = (x: number, y: number) => layout.points.findIndex((p) => p.x === x && p.y === y);
  const board = (spots: [number, number, 0 | 1][]): (0 | 1 | null)[] => {
    const cells: (0 | 1 | null)[] = layout.points.map(() => null);
    for (const [x, y, owner] of spots) cells[at(x, y)] = owner;
    return cells;
  };

  // 흑 slides (2,3) up to (2,1), pinning 백's (1,1) against 흑's (0,1).
  const pinning = gonuPosition(
    "neokjul",
    board([[0, 1, 0], [2, 3, 0], [1, 1, 1], [0, 0, 1], [3, 0, 1]]),
    0,
  );
  const taken = gonuEngine.applyMove(pinning, { from: { x: 2, y: 3 }, to: { x: 2, y: 1 } }, 0);
  assert(taken.ok, "넉줄고누: sliding up the column should be legal");
  assert(taken.state.cells[at(1, 1)] === null, "넉줄고누: the pinned stone should be taken");
  assert(taken.state.taken[0] === 1, `넉줄고누: 흑 should be credited 1 stone, got ${taken.state.taken[0]}`);

  // Sliding your own stone in between two enemies is safe.
  const suicide = gonuPosition(
    "neokjul",
    board([[0, 1, 1], [2, 1, 1], [1, 3, 0], [3, 3, 0], [0, 0, 1]]),
    0,
  );
  const safe = gonuEngine.applyMove(suicide, { from: { x: 1, y: 3 }, to: { x: 1, y: 1 } }, 0);
  assert(safe.ok, "넉줄고누: moving between two enemies should be legal");
  assert(safe.state.cells[at(1, 1)] === 0, "넉줄고누: a stone that moves between two enemies must survive");

  // A stone cornered with both its neighbours held goes too.
  const cornered = gonuPosition(
    "neokjul",
    board([[0, 0, 1], [1, 0, 0], [0, 3, 0], [3, 3, 0], [3, 0, 1], [2, 0, 1]]),
    0,
  );
  const corner = gonuEngine.applyMove(cornered, { from: { x: 0, y: 3 }, to: { x: 0, y: 1 } }, 0);
  assert(corner.ok, "넉줄고누: sliding up the left column should be legal");
  assert(corner.state.cells[at(0, 0)] === null, "넉줄고누: a stone pinned into the corner should be taken");

  // Diagonals never take.
  const diagonal = gonuPosition("neokjul", board([[1, 1, 1], [0, 0, 0], [3, 3, 0], [2, 3, 0], [0, 3, 1]]), 0);
  const noTake = gonuEngine.applyMove(diagonal, { from: { x: 2, y: 3 }, to: { x: 2, y: 2 } }, 0);
  assert(noTake.ok, "넉줄고누: the diagonal test move should be legal");
  assert(noTake.state.cells[at(1, 1)] === 1, "넉줄고누: diagonal alignment must not take a stone");

  // Down to one stone there is nothing left to pin, so the game is over.
  const finishing = gonuPosition("neokjul", board([[0, 1, 0], [2, 3, 0], [1, 1, 1], [3, 0, 1]]), 0);
  const finished = gonuEngine.applyMove(finishing, { from: { x: 2, y: 3 }, to: { x: 2, y: 1 } }, 0);
  assert(
    finished.ok && finished.state.status === "win" && finished.state.winner === 0,
    `넉줄고누: taking 백 down to one stone should win, got ${finished.state.status}`,
  );
  ok("넉줄고누: 끼워 잡기·모퉁이 잡기 동작, 대각선은 잡지 않음, 한 알 남으면 종료");
}

// --- Every engine must reject malformed moves instead of throwing ---
// Moves reach applyMove straight from a network client, so a throw here would
// take the server process down with every other room on it.
{
  const engines: GameEngine<any, any>[] = [
    gomokuEngine, reversiEngine, checkersEngine, chessEngine, janggiEngine, gonuEngine, yutEngine, territoryEngine, flickEngine,
  ];
  const junk: unknown[] = [
    null,
    undefined,
    {},
    { to: null },
    { to: {} },
    { to: { x: "a", y: "b" } },
    { to: { x: NaN, y: NaN } },
    { to: { x: 1e9, y: -1e9 } },
    { from: {}, to: {} },
    { kind: "nonsense" },
    [],
    "move",
    42,
  ];
  for (const engine of engines) {
    const state = engine.createInitialState();
    const player = engine.turn(state);
    for (const bad of junk) {
      let threw = false;
      let res: any;
      try {
        res = applyMoveSafely(engine, state, bad as any, player);
      } catch {
        threw = true;
      }
      assert(!threw, `${engine.meta.id}: applyMoveSafely must not throw on ${JSON.stringify(bad) ?? String(bad)}`);
      assert(threw || res.ok === false, `${engine.meta.id}: applyMoveSafely must reject ${JSON.stringify(bad) ?? String(bad)}`);
      assert(threw || res.state === state, `${engine.meta.id}: a rejected move must leave state untouched`);
    }
  }
  ok(`malformed-move handling verified across ${engines.length} engines`);
}

// --- Generic smoke test: play random legal moves for a while on every engine, no crash ---
function randomPlaythrough<TState>(engine: GameEngine<TState>, maxPlies: number, setupId?: string) {
  let state = engine.createInitialState(setupId);
  let plies = 0;
  let lastTurn = engine.turn(state);
  let stuckGuard = 0;
  while (plies < maxPlies) {
    const status = engine.status(state);
    if (status.status !== "ongoing") break;
    const player = engine.turn(state);
    const moves = engine.legalMoves(state, player);
    assert(moves.length > 0, `${engine.meta.id}: ongoing game must have legal moves for side to move`);
    if (moves.length === 0) break;
    const move = moves[Math.floor(Math.random() * moves.length)];
    const result = engine.applyMove(state, move, player);
    assert(result.ok, `${engine.meta.id}: a move drawn from legalMoves() must be accepted by applyMove()`);
    if (!result.ok) break;
    state = result.state;
    plies++;
    if (engine.turn(state) === lastTurn) {
      stuckGuard++;
      assert(stuckGuard < 60, `${engine.meta.id}: turn did not advance for 60 consecutive plies (possible infinite loop)`);
      if (stuckGuard >= 60) break;
    } else {
      stuckGuard = 0;
    }
    lastTurn = engine.turn(state);
  }
  const finalStatus = engine.status(state);
  const label = setupId ? `${engine.meta.id}/${setupId}` : engine.meta.id;
  ok(`${label} random playthrough: ${plies} plies, final status = ${finalStatus.status}`);
}

randomPlaythrough(gomokuEngine, 60);
randomPlaythrough(reversiEngine, 120);
randomPlaythrough(checkersEngine, 150);
randomPlaythrough(chessEngine, 150);
randomPlaythrough(janggiEngine, 150);
randomPlaythrough(flickEngine, 200);
randomPlaythrough(gonuEngine, 80, "umul");
randomPlaythrough(gonuEngine, 120, "hobak");
randomPlaythrough(gonuEngine, 120, "neokjul");
randomPlaythrough(yutEngine, 400);
randomPlaythrough(territoryEngine, 600);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
} else {
  console.log("All engine self-tests passed.");
}
