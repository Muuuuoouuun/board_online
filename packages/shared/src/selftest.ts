import { gomokuEngine } from "./games/gomoku.js";
import { reversiEngine } from "./games/reversi.js";
import { checkersEngine } from "./games/checkers.js";
import { chessEngine } from "./games/chess.js";
import { janggiEngine } from "./games/janggi.js";
import { flickEngine, MAX_FLICK as FLICK_MAX } from "./games/flick.js";
import { gonuEngine } from "./games/gonu.js";
import { yutEngine } from "./games/yut.js";
import {
  territoryEngine,
  territoryCanExtend,
  territoryCanStart,
  territoryPreview,
  MAX_LINE as TERRITORY_MAX_LINE,
  type TerritoryState,
} from "./games/territory.js";
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

// --- Territory: the drawn stroke, its rule checks, and what it seals off ---
// The stroke is drawn on the lattice *between* cells, so every case below is
// expressed as cell corners: (3,0) is the top-right corner of the home block.
{
  const fresh = () => territoryEngine.createInitialState();

  // A stroke out of the home block and straight back in seals off the one cell
  // it wrapped: corner (3,0) -> (4,0) -> (4,1) -> (3,1) boxes in cell (3,0),
  // whose remaining side is walled by home cell (2,0).
  {
    const state = fresh();
    const line = [
      { x: 3, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 1 },
      { x: 3, y: 1 },
    ];
    const preview = territoryPreview(state, 0, line);
    assert(preview.error === null, `territory: a closing stroke should be legal, got ${preview.error}`);
    assert(preview.gain.length === 1, `territory: that stroke should seal 1 cell, got ${preview.gain.length}`);
    const res = territoryEngine.applyMove(state, { line }, 0);
    assert(res.ok, "territory: applyMove must accept the previewed stroke");
    assert(res.state.board[0][3] === 0, "territory: the sealed cell should change hands");
    assert(res.state.turn === 1, "territory: a finished stroke passes the turn");
    assert(res.state.lastGain.length === 1 && res.state.lastBy === 0, "territory: the move should record what it drew");
  }

  // Preview and applyMove must agree on every refusal, and a refused stroke
  // must never cost the turn — that is what makes freehand drawing forgiving.
  const refusals: { name: string; line: { x: number; y: number }[]; error: string }[] = [
    { name: "never leaves home", line: [{ x: 3, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 }], error: "home" },
    { name: "does not come back", line: [{ x: 3, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 0 }], error: "open" },
    { name: "starts away from home", line: [{ x: 7, y: 7 }, { x: 8, y: 7 }], error: "start" },
    { name: "is not a connected chain", line: [{ x: 3, y: 0 }, { x: 6, y: 4 }], error: "shape" },
    { name: "leaves the lattice", line: [{ x: 3, y: 0 }, { x: 3, y: -1 }], error: "shape" },
    // Out along the top edge, back in one row down, then a third pass that has
    // to re-enter a corner the stroke already used.
    {
      name: "crosses itself",
      line: [
        { x: 3, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 1 },
        { x: 5, y: 1 },
        { x: 5, y: 0 },
        { x: 4, y: 0 },
      ],
      error: "self",
    },
  ];
  for (const { name, line, error } of refusals) {
    const state = fresh();
    const preview = territoryPreview(state, 0, line);
    assert(preview.error === error, `territory: a stroke that ${name} should fail with "${error}", got "${preview.error}"`);
    const res = territoryEngine.applyMove(state, { line }, 0);
    assert(!res.ok, `territory: applyMove must refuse a stroke that ${name}`);
    assert(res.state === state, `territory: a refused stroke must leave the board alone (${name})`);
  }

  // The length cap is the only thing bounding one turn, so it has to bite. A
  // strip of w cells along the top edge costs 2w+1 segments: out along y=0,
  // down one, back along y=1.
  {
    const strip = (w: number) => {
      const line = [{ x: 3, y: 0 }];
      for (let i = 1; i <= w; i++) line.push({ x: 3 + i, y: 0 });
      line.push({ x: 3 + w, y: 1 });
      for (let i = w - 1; i >= 0; i--) line.push({ x: 3 + i, y: 1 });
      return line;
    };
    const widest = Math.floor((TERRITORY_MAX_LINE - 1) / 2);
    const fits = strip(widest);
    const over = strip(widest + 1);
    assert(fits.length - 1 <= TERRITORY_MAX_LINE, "territory: (test setup) the widest strip should fit the cap");
    assert(over.length - 1 > TERRITORY_MAX_LINE, "territory: (test setup) one cell wider should not");

    const state = fresh();
    const preview = territoryPreview(state, 0, fits);
    assert(preview.error === null, `territory: a stroke at the cap should be legal, got ${preview.error}`);
    assert(preview.gain.length === widest, `territory: expected ${widest} cells, got ${preview.gain.length}`);
    assert(
      territoryPreview(state, 0, over).error === "too-long",
      "territory: a stroke past the cap must be refused",
    );
  }

  // Rule 2: a stroke may not run along an edge of the opponent's land. Their
  // home corner is at (14,14), so its edge (11,14)-(12,14) is off limits.
  {
    const state = fresh();
    assert(
      !territoryCanExtend(state, 0, [{ x: 11, y: 14 }], { x: 12, y: 14 }),
      "territory: drawing along the opponent's edge must be refused",
    );
    const res = territoryEngine.applyMove(
      state,
      { line: [{ x: 3, y: 14 }, { x: 4, y: 14 }] },
      0,
    );
    assert(!res.ok, "territory: a stroke starting off your own land must be refused");
  }

  // The client draws with territoryCanStart/territoryCanExtend, so those have to
  // match what applyMove will accept — a corner it offers must really be drawable.
  {
    const state = fresh();
    assert(territoryCanStart(state, 0, { x: 3, y: 0 }), "territory: (3,0) is a corner of home with room to draw");
    assert(!territoryCanStart(state, 0, { x: 1, y: 1 }), "territory: a corner buried inside home has nowhere to draw");
    assert(!territoryCanStart(state, 0, { x: 7, y: 7 }), "territory: mid-board corners are not starting points");
    assert(!territoryCanStart(state, 1, { x: 3, y: 0 }), "territory: player 1 cannot start from player 0's home");
    assert(
      territoryCanExtend(state, 0, [], { x: 3, y: 0 }) === territoryCanStart(state, 0, { x: 3, y: 0 }),
      "territory: extending an empty stroke is the same question as starting one",
    );
    assert(territoryCanExtend(state, 0, [{ x: 3, y: 0 }], { x: 4, y: 0 }), "territory: (3,0)->(4,0) runs beside open land");
    assert(
      !territoryCanExtend(state, 0, [{ x: 1, y: 0 }], { x: 2, y: 0 }),
      "territory: a segment with home on both sides goes nowhere",
    );
    assert(
      !territoryCanExtend(state, 0, [{ x: 3, y: 0 }], { x: 5, y: 0 }),
      "territory: a stroke steps one corner at a time",
    );
  }

  // Every stroke legalMoves offers must be one applyMove takes, and the sample
  // must never be empty while the game is running (the fuzz test leans on this).
  {
    const state = fresh();
    const moves = territoryEngine.legalMoves(state, 0);
    assert(moves.length > 0, "territory: the opening position must offer sampled strokes");
    for (const move of moves) {
      assert(
        territoryEngine.applyMove(state, move, 0).ok,
        `territory: sampled stroke ${JSON.stringify(move.line)} must be accepted`,
      );
    }
    assert(territoryEngine.legalMoves(state, 1).length === 0, "territory: no strokes for the player not to move");
  }

  // The opponent's land walls a pocket in just as well as your own: their two
  // cells roof the pocket, your two flank it, and the stroke only has to draw
  // the floor. What is theirs stays theirs — only the open land is taken.
  {
    const state = fresh();
    const board = state.board.map((row) => row.slice());
    board[3][4] = 0;
    board[3][7] = 0;
    board[2][5] = 1;
    board[2][6] = 1;
    const rigged: TerritoryState = { ...state, board };
    const line = [
      { x: 5, y: 4 },
      { x: 6, y: 4 },
      { x: 7, y: 4 },
    ];
    const preview = territoryPreview(rigged, 0, line);
    assert(preview.error === null, `territory: floor-drawing under their roof should be legal, got ${preview.error}`);
    const gained = preview.gain.map((p) => `${p.x},${p.y}`).sort().join(" ");
    assert(gained === "5,3 6,3", `territory: expected to seal 5,3 and 6,3, got "${gained}"`);
    const res = territoryEngine.applyMove(rigged, { line }, 0);
    assert(res.ok, "territory: applyMove must accept it too");
    assert(
      res.state.board[2][5] === 1 && res.state.board[2][6] === 1,
      "territory: cells that already belong to the opponent are never taken",
    );
    // And their land blocks a stroke that tries to run along it.
    assert(
      !territoryCanExtend(rigged, 0, [{ x: 5, y: 3 }], { x: 6, y: 3 }),
      "territory: the edge under their cell is off limits",
    );
  }

  ok("territory line-drawing verified (stroke rules, length cap, enclosure, client helpers)");
}

// --- Flick: every shot is recorded, including the ones that end badly ---
// The stone only sometimes stays where the flick sent it — a shot off the board
// or a spent third flick puts it back — so `lastShot` is the only way a client
// can replay what actually happened.
{
  const fresh = () => flickEngine.createInitialState();
  assert(fresh().lastShot === null, "flick: a new game has no shot to replay");

  // Straight down-right from the home corner: still on the board, flicks to spare.
  {
    const state = fresh();
    const from = state.stones[0];
    const res = flickEngine.applyMove(state, { kind: "flick", dx: 10, dy: 10 }, 0);
    assert(res.ok, "flick: an ordinary flick should be accepted");
    const shot = res.state.lastShot!;
    assert(shot !== null && shot.outcome === "open", `flick: expected an open shot, got ${shot?.outcome}`);
    assert(shot.player === 0 && shot.claimed === 0, "flick: an open shot claims nothing");
    assert(
      shot.from.x === from.x && shot.from.y === from.y && shot.to.x === from.x + 10 && shot.to.y === from.y + 10,
      "flick: the shot records where the stone flew from and to",
    );
    assert(res.state.turn === 0 && res.state.flicksLeft === 2, "flick: the turn goes on with one flick spent");
  }

  // Up and to the left, straight off the top corner. The stone goes back to the
  // start, but the shot still says where it was headed.
  {
    const state = fresh();
    const from = state.stones[0];
    const res = flickEngine.applyMove(state, { kind: "flick", dx: -FLICK_MAX, dy: 0 }, 0);
    const shot = res.state.lastShot!;
    assert(shot.outcome === "off", `flick: a shot off the board should record "off", got ${shot.outcome}`);
    assert(shot.to.x < 0, "flick: the recorded landing spot is off the board, not clamped to it");
    assert(
      res.state.stones[0].x === from.x && res.state.stones[0].y === from.y,
      "flick: the stone itself goes back to where the turn started",
    );
    assert(res.state.turn === 1, "flick: and the turn passes");
  }

  // Three flicks that never make it home end the turn the same way.
  {
    let state = fresh();
    for (let i = 0; i < 3; i++) {
      const res = flickEngine.applyMove(state, { kind: "flick", dx: 0, dy: i === 0 ? 14 : 0.5 }, 0);
      assert(res.ok, `flick: flick ${i + 1} should be accepted`);
      state = res.state;
    }
    assert(state.lastShot!.outcome === "spent", `flick: the third miss should record "spent", got ${state.lastShot!.outcome}`);
    assert(state.turn === 1 && state.flicksLeft === 3, "flick: a spent turn hands over with a full set of flicks");
  }

  // Out and back into your own land: the shot records the claim.
  {
    let state = fresh();
    state = flickEngine.applyMove(state, { kind: "flick", dx: 8, dy: -2 }, 0).state;
    state = flickEngine.applyMove(state, { kind: "flick", dx: -2, dy: 8 }, 0).state;
    const res = flickEngine.applyMove(state, { kind: "flick", dx: -5, dy: -5 }, 0);
    const shot = res.state.lastShot!;
    assert(shot.outcome === "claim", `flick: coming home should record "claim", got ${shot.outcome}`);
    assert(shot.claimed > 0, "flick: and how much land it took");
    assert(res.state.reason.includes(`${shot.claimed}`), "flick: the turn message should agree with the shot");
  }

  // Passing leaves nothing to animate.
  {
    const res = flickEngine.applyMove(fresh(), { kind: "giveup" }, 0);
    assert(res.state.lastShot === null, "flick: passing the turn records no shot");
  }

  ok("flick shot record verified (open / off / spent / claim, and passing)");
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
    { line: null },
    { line: [] },
    { line: [1, 2, 3] },
    { line: [{ x: 3, y: 0 }, null] },
    { line: [{ x: 3, y: 0 }, { x: "4", y: 0 }] },
    { line: new Array(100000).fill({ x: 3, y: 0 }) },
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
