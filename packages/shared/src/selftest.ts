import { gomokuEngine } from "./games/gomoku.js";
import { reversiEngine } from "./games/reversi.js";
import { checkersEngine } from "./games/checkers.js";
import { chessEngine } from "./games/chess.js";
import { janggiEngine } from "./games/janggi.js";
import { flickEngine } from "./games/flick.js";
import { gonuEngine, POINTS, POINT_IDS, GONU_LINES, type GonuState } from "./games/gonu.js";
import { yutEngine } from "./games/yut.js";
import { territoryEngine } from "./games/territory.js";
import type { BaseState, GameEngine, Move } from "./types.js";
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

// --- Board feedback is derived from actual positions, including edge diagonals. ---
{
  for (const [dx, dy, x, y] of [[1, 0, 0, 0], [0, 1, 14, 0], [1, 1, 0, 0], [1, -1, 0, 14]]) {
    const state = gomokuEngine.createInitialState();
    assert(gomokuEngine.feedback!(state) === null, "gomoku: no feedback on an unfinished board");
    for (let i = 0; i < 5; i++) state.board[y + i * dy][x + i * dx] = 1;
    state.status = "win"; state.winner = 1;
    const snapshot = JSON.stringify(state);
    const feedback = gomokuEngine.feedback!(state)!;
    assert(feedback.positions.length === 5 && feedback.lines?.length === 1, `gomoku: highlight complete line ${dx},${dy}`);
    assert(feedback.positions.every(pos => state.board[pos.y][pos.x] === 1), "gomoku: only winning stones are highlighted");
    assert(JSON.stringify(state) === snapshot, "gomoku: feedback never mutates state");
    state.status = "draw"; state.winner = null;
    assert(gomokuEngine.feedback!(state) === null, "gomoku: draws do not have a winning line");
  }
  const chess = chessEngine.createInitialState();
  assert(chessEngine.feedback!(chess) === null, "chess: starting king is not checked");
  const checked = { ...chess, fen: "4k3/8/8/8/8/8/4R3/4K3 b - - 0 1", turn: 1 as const };
  assert(chessEngine.feedback!(checked)?.kind === "check", "chess: attacked king is checked");
  assert(chessEngine.feedback!(checked)?.positions[0].y === 0, "chess: check ring is on the black king");
  assert(chessEngine.feedback!({ ...checked, status: "draw" }) === null, "chess: a finished draw does not request a defense");
  const escaped = chessEngine.applyMove(checked, { from: { x: 4, y: 0 }, to: { x: 3, y: 0 } }, 1);
  assert(escaped.ok && chessEngine.feedback!(escaped.state) === null, "chess: check clears after a legal escape");
  let mate = chess;
  for (const [x1, y1, x2, y2] of [[5, 6, 5, 5], [4, 1, 4, 3], [6, 6, 6, 4], [3, 0, 7, 4]]) {
    const next = chessEngine.applyMove(mate, { from: { x: x1, y: y1 }, to: { x: x2, y: y2 } }, mate.turn);
    assert(next.ok, "chess: Fool's mate sequence is legal"); mate = next.state;
  }
  assert(mate.status === "win" && chessEngine.feedback!(mate)?.label === "체크메이트", "chess: distinguish mate from check");
  assert(chessEngine.feedback!(mate)?.positions[0].y === 7, "chess: mate highlights the losing king");
  const janggi = janggiEngine.createInitialState();
  assert(janggiEngine.feedback!(janggi) === null, "janggi: starting general is safe");
  janggi.board = Array.from({ length: 10 }, () => Array(9).fill(null));
  janggi.board[8][4] = { owner: 0, type: "general" };
  janggi.board[1][4] = { owner: 1, type: "general" };
  janggi.board[4][4] = { owner: 1, type: "chariot" };
  assert(janggiEngine.feedback!(janggi)?.label === "장군", "janggi: a chariot attack announces check");
  const defended = janggiEngine.applyMove(janggi, { from: { x: 4, y: 8 }, to: { x: 3, y: 8 } }, 0);
  assert(defended.ok && janggiEngine.feedback!(defended.state) === null, "janggi: a legal defense clears check");
  janggi.board[4][3] = { owner: 1, type: "chariot" };
  janggi.board[4][5] = { owner: 1, type: "chariot" };
  assert(janggiEngine.legalMoves(janggi, 0).length === 0, "janggi: the three-file attack is inescapable");
  janggi.status = "win"; janggi.winner = 1;
  assert(janggiEngine.feedback!(janggi)?.label === "외통장군", "janggi: an ended check displays mate");
  ok("board feedback: four gomoku directions, chess check/mate, janggi check/defense/mate verified");
}

// --- Umul-gonu: facing starts, opening restriction and real trapping rules ---
{
  const start = gonuEngine.createInitialState();
  const snapshot = JSON.stringify(start);
  assert(start.board.BL === 0 && start.board.BR === 0 && start.board.TL === 1 && start.board.TR === 1 && start.board.C === null,
    "gonu: each side starts together, facing the other side with the centre empty");
  const opening = gonuEngine.legalMoves(start, 0);
  assert(opening.length === 1 && opening[0].from?.x === 2 && opening[0].from?.y === 2 && opening[0].to.x === 1 && opening[0].to.y === 1,
    "gonu: only the bottom-right black stone may open");
  assert(!gonuEngine.applyMove(start, { from: POINTS.BL, to: POINTS.C }, 0).ok,
    "gonu: forbid the opening instant-win move beside the well");
  assert(gonuEngine.legalMoves(start, 1).length === 0, "gonu: only the current player may move");
  let current = gonuEngine.applyMove(start, { from: POINTS.BR, to: POINTS.C }, 0);
  assert(current.ok && current.state.status === "ongoing" && current.state.turn === 1, "gonu: opening gives white a playable turn");
  current = gonuEngine.applyMove(current.state, { from: POINTS.TR, to: POINTS.BR }, 1);
  assert(current.ok && current.state.turn === 0, "gonu: white can answer on the right edge");
  current = gonuEngine.applyMove(current.state, { from: POINTS.C, to: POINTS.TR }, 0);
  assert(current.ok && current.state.board.C === null, "gonu: centre becomes empty again after the forced continuation");
  assert(gonuEngine.legalMoves(current.state, 1).some((m) => m.from?.x === 0 && m.from?.y === 0),
    "gonu: well-adjacent stones may move after the opening ply");
  assert(gonuEngine.applyMove(current.state, { from: POINTS.TL, to: POINTS.C }, 1).ok,
    "gonu: the validator also permits a later well-adjacent move");
  const later: GonuState = { ...start, plies: 4 };
  const trapped = gonuEngine.applyMove(later, { from: POINTS.BL, to: POINTS.C }, 0);
  assert(trapped.ok && trapped.state.status === "win" && trapped.state.winner === 0,
    "gonu: the same trap is a valid win later in the game");
  assert(gonuEngine.legalMoves(trapped.state, 1).length === 0, "gonu: a finished game exposes no moves");
  const acrossWell: GonuState = { ...start, plies: 8, board: { TL: null, TR: 1, C: 1, BL: 0, BR: 0 } };
  assert(!gonuEngine.applyMove(acrossWell, { from: POINTS.BL, to: POINTS.TL }, 0).ok,
    "gonu: cannot cross the missing left edge");
  assert(!gonuEngine.applyMove(later, { from: POINTS.BL, to: POINTS.TR }, 0).ok, "gonu: no jumping over the centre or capturing");
  const capped = gonuEngine.applyMove({ ...start, plies: 59 }, { from: POINTS.BR, to: POINTS.C }, 0);
  assert(capped.ok && capped.state.status === "draw", "gonu: the service's 60-ply cap still draws");
  const capWin = gonuEngine.applyMove({ ...start, plies: 59 }, { from: POINTS.BL, to: POINTS.C }, 0);
  assert(capWin.ok && capWin.state.status === "win", "gonu: a trap at the cap takes priority over a draw");
  const whiteFirst: GonuState = { ...start, turn: 1 };
  assert(gonuEngine.legalMoves(whiteFirst, 1).length === 1 && !gonuEngine.applyMove(whiteFirst, { from: POINTS.TL, to: POINTS.C }, 1).ok,
    "gonu: the opening restriction is symmetric if white starts");
  assert(JSON.stringify(start) === snapshot, "gonu: moves never mutate the input state");
  assert(GONU_LINES.length === 7 && !GONU_LINES.some((l) => l.x1 === 0 && l.x2 === 0), "gonu: the drawing has exactly seven paths and no path across the well");
  for (const id of POINT_IDS) assert(POINTS[id].x < gonuEngine.meta.width && POINTS[id].y < gonuEngine.meta.height, "gonu: point fits advertised board dimensions");
  ok("gonu facing setup, opening restriction, well, trap, draw and immutability verified");
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
function randomPlaythrough<TState extends BaseState, TMove>(engine: GameEngine<TState, TMove>, maxPlies: number) {
  let state = engine.createInitialState();
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
  ok(`${engine.meta.id} random playthrough: ${plies} plies, final status = ${finalStatus.status}`);
}

randomPlaythrough(gomokuEngine, 60);
randomPlaythrough(reversiEngine, 120);
randomPlaythrough(checkersEngine, 150);
randomPlaythrough(chessEngine, 150);
randomPlaythrough(janggiEngine, 150);
randomPlaythrough(flickEngine, 200);
randomPlaythrough(gonuEngine, 80);
randomPlaythrough(yutEngine, 400);
randomPlaythrough(territoryEngine, 600);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
} else {
  console.log("All engine self-tests passed.");
}
