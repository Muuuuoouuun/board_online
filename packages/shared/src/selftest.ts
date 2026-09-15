import { gomokuEngine } from "./games/gomoku.js";
import { reversiEngine } from "./games/reversi.js";
import { checkersEngine } from "./games/checkers.js";
import { chessEngine } from "./games/chess.js";
import { janggiEngine } from "./games/janggi.js";
import type { GameEngine, Move } from "./types.js";

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

// --- Generic smoke test: play random legal moves for a while on every engine, no crash ---
function randomPlaythrough<TState>(engine: GameEngine<TState>, maxPlies: number) {
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

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
} else {
  console.log("All engine self-tests passed.");
}
