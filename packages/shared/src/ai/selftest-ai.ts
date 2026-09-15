/**
 * AI self-test harness. Run all games with `npm run test:ai`, or one with
 * `AI_GAME=gomoku npm run test:ai`. `AI_SKIP_STRENGTH=1` skips the AI-vs-random
 * games (useful while an AI is still the random placeholder).
 *
 * For every registered AI it checks:
 *   1. legality  — on positions sampled from random playouts, every level returns a
 *                  move the engine accepts, null off-turn, and null when the game is over
 *   2. speed     — the hard level respects its time budget (generously: a single slow
 *                  node may overrun, but not by an order of magnitude)
 *   3. determinism — same seed + frozen clock → same move
 *   4. strength  — the normal level beats a random mover at least `minWinRate` of the time
 */
import { GAME_LIST, getEngine, isGameId, type GameEngine, type PlayerIndex, type Rng } from "../index.js";
import { seededRng } from "../rng.js";
import { AI_PROVIDERS, AI_LEVELS, type AiProvider } from "./index.js";

const only = process.env.AI_GAME;
if (only && !isGameId(only)) {
  console.error(`Unknown AI_GAME: ${only}`);
  process.exit(2);
}
const games = only && isGameId(only) ? [only] : GAME_LIST;
const skipStrength = process.env.AI_SKIP_STRENGTH === "1";

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

type AnyEngine = GameEngine<any, any>;

function other(p: PlayerIndex): PlayerIndex {
  return p === 0 ? 1 : 0;
}

/** Plays `plies` random moves from the initial position; stops early if the game ends. */
function randomPosition(engine: AnyEngine, plies: number, rng: Rng): any {
  let state = engine.createInitialState();
  for (let i = 0; i < plies; i++) {
    if (engine.status(state).status !== "ongoing") break;
    const mover = engine.turn(state);
    const moves = engine.legalMoves(state, mover);
    if (moves.length === 0) break;
    const r = engine.applyMove(state, moves[Math.floor(rng() * moves.length)], mover, rng);
    if (!r.ok) break;
    state = r.state;
  }
  return state;
}

function isAccepted(engine: AnyEngine, state: any, player: PlayerIndex, move: any, rng: Rng): boolean {
  const legal = engine.legalMoves(state, player);
  const key = JSON.stringify(move);
  if (legal.some((m: any) => JSON.stringify(m) === key)) return true;
  // flick's move space is continuous: membership can't be checked, acceptance can.
  return engine.applyMove(state, move, player, rng).ok;
}

function checkLegality(id: string, engine: AnyEngine, ai: AiProvider<any, any>) {
  const rng = seededRng(101);
  const samples = 14;
  let tested = 0;
  for (let s = 0; s < samples; s++) {
    const state = randomPosition(engine, Math.floor(rng() * 60), rng);
    const status = engine.status(state);
    if (status.status !== "ongoing") {
      for (const lv of AI_LEVELS) {
        let m: any = "threw";
        try {
          m = ai.chooseMove(state, 0, lv.id, { rng, budgetMs: 20 });
        } catch {
          /* recorded below */
        }
        assert(m === null, `${id}/${lv.id}: must return null on a finished game (got ${JSON.stringify(m)})`);
      }
      continue;
    }
    const mover = engine.turn(state);
    for (const lv of AI_LEVELS) {
      let move: any = "threw";
      try {
        move = ai.chooseMove(state, mover, lv.id, { rng, budgetMs: 30 });
      } catch (e) {
        move = "threw";
      }
      assert(move !== "threw", `${id}/${lv.id}: chooseMove threw`);
      assert(move !== null && move !== undefined, `${id}/${lv.id}: returned null on an ongoing position with legal moves`);
      if (move && move !== "threw") {
        assert(isAccepted(engine, state, mover, move, rng), `${id}/${lv.id}: returned a move the engine rejects: ${JSON.stringify(move)}`);
        assert(
          JSON.parse(JSON.stringify(move)) !== null && typeof move === "object",
          `${id}/${lv.id}: move must be a JSON-serialisable object`,
        );
      }
      let offTurn: any = "threw";
      try {
        offTurn = ai.chooseMove(state, other(mover), lv.id, { rng, budgetMs: 20 });
      } catch {
        /* recorded below */
      }
      assert(offTurn === null, `${id}/${lv.id}: must return null when it is not that player's turn`);
      tested++;
    }
  }
  ok(`${id}: legality on ${tested} (position, level) pairs`);
}

function checkSpeed(id: string, engine: AnyEngine, ai: AiProvider<any, any>) {
  const rng = seededRng(202);
  let worst = 0;
  for (let s = 0; s < 4; s++) {
    const state = randomPosition(engine, 6 + s * 9, rng);
    if (engine.status(state).status !== "ongoing") continue;
    const mover = engine.turn(state);
    const t0 = Date.now();
    ai.chooseMove(state, mover, "hard", { rng, budgetMs: 150 });
    worst = Math.max(worst, Date.now() - t0);
  }
  // Loose on purpose: the harness often runs many games in parallel on a loaded machine.
  assert(worst <= 3000, `${id}: hard level took ${worst}ms with a 150ms budget`);
  ok(`${id}: hard level worst case ${worst}ms with a 150ms budget`);
}

function checkDeterminism(id: string, engine: AnyEngine, ai: AiProvider<any, any>) {
  const state = randomPosition(engine, 10, seededRng(303));
  if (engine.status(state).status !== "ongoing") return;
  const mover = engine.turn(state);
  const frozen = () => 0;
  const a = ai.chooseMove(state, mover, "normal", { rng: seededRng(7), now: frozen, budgetMs: 1_000_000 });
  const b = ai.chooseMove(state, mover, "normal", { rng: seededRng(7), now: frozen, budgetMs: 1_000_000 });
  assert(JSON.stringify(a) === JSON.stringify(b), `${id}: same seed + frozen clock must give the same move`);
  ok(`${id}: deterministic under a fixed seed`);
}

function playGame(
  engine: AnyEngine,
  ai: AiProvider<any, any>,
  aiSeat: PlayerIndex,
  rng: Rng,
  budgetMs: number,
  maxPlies: number,
): { winner: PlayerIndex | null; plies: number; aiMs: number; aiMoves: number } {
  let state = engine.createInitialState();
  let plies = 0;
  let aiMs = 0;
  let aiMoves = 0;
  while (engine.status(state).status === "ongoing" && plies < maxPlies) {
    const mover = engine.turn(state);
    let move: any;
    if (mover === aiSeat) {
      const t0 = Date.now();
      move = ai.chooseMove(state, mover, "normal", { rng, budgetMs });
      aiMs += Date.now() - t0;
      aiMoves++;
      if (move === null) break;
    } else {
      const moves = engine.legalMoves(state, mover);
      if (moves.length === 0) break;
      move = moves[Math.floor(rng() * moves.length)];
    }
    const r = engine.applyMove(state, move, mover, rng);
    if (!r.ok) {
      console.error(`   engine rejected ${mover === aiSeat ? "AI" : "random"} move ${JSON.stringify(move)}: ${r.error}`);
      break;
    }
    state = r.state;
    plies++;
  }
  const st = engine.status(state);
  return { winner: st.status === "win" ? st.winner : null, plies, aiMs, aiMoves };
}

function checkStrength(id: string, engine: AnyEngine, ai: AiProvider<any, any>) {
  const profile = ai.testProfile ?? {};
  const games = profile.games ?? 6;
  const minWinRate = profile.minWinRate ?? 0.7;
  const budgetMs = profile.budgetMs ?? 30;
  const maxPlies = profile.maxPlies ?? 300;
  const rng = seededRng(404);
  let wins = 0;
  let losses = 0;
  let totalAiMs = 0;
  let totalAiMoves = 0;
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    const aiSeat: PlayerIndex = g % 2 === 0 ? 0 : 1;
    const res = playGame(engine, ai, aiSeat, rng, budgetMs, maxPlies);
    if (res.winner === aiSeat) wins++;
    else if (res.winner !== null) losses++;
    totalAiMs += res.aiMs;
    totalAiMoves += res.aiMoves;
  }
  const rate = wins / games;
  const avg = totalAiMoves ? (totalAiMs / totalAiMoves).toFixed(1) : "n/a";
  assert(
    rate >= minWinRate,
    `${id}: normal level won ${wins}/${games} vs random (${losses} losses); needs ${(minWinRate * 100).toFixed(0)}%`,
  );
  ok(`${id}: normal vs random ${wins}W ${losses}L ${games - wins - losses}D, avg ${avg}ms/move, ${Date.now() - t0}ms total`);
}

for (const id of games) {
  const engine = getEngine(id);
  const ai = AI_PROVIDERS[id];
  console.log(`\n== ${id} ==`);
  checkLegality(id, engine, ai);
  checkSpeed(id, engine, ai);
  checkDeterminism(id, engine, ai);
  if (!skipStrength) checkStrength(id, engine, ai);
}

console.log(`\n${checks - failures}/${checks} AI checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
} else {
  console.log("All AI self-tests passed.");
}
