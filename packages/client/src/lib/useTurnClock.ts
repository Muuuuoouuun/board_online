import { useEffect, useRef } from "react";
import type { BaseState, GameEngine } from "@board-online/shared";

/**
 * Runs a timed game's turn clock in pass-and-play, where there is no room server
 * to run it. Games without a `clock` fall straight through.
 *
 * `running` is what the page knows and the engine does not: whether play is
 * actually happening right now. It goes false while the rules or result pop-up is
 * up, so nobody loses a turn to reading the rules, and the turn starts over when
 * play resumes — the same deal the room server gives a player whose opponent has
 * stepped away.
 */
export function useTurnClock<TState extends BaseState, TMove>(
  engine: GameEngine<TState, TMove>,
  state: TState,
  running: boolean,
  onState: (next: TState) => void,
): void {
  // Read through refs so the effect below re-runs on the state and the pause, and
  // never merely because the page handed it a new callback.
  const stateRef = useRef(state);
  stateRef.current = state;
  const onStateRef = useRef(onState);
  onStateRef.current = onState;
  const wasRunning = useRef(false);

  const clock = engine.clock;
  const deadline = clock && running ? clock.deadline(state) : null;

  useEffect(() => {
    if (!clock) return;
    if (!running) {
      if (wasRunning.current) {
        wasRunning.current = false;
        onStateRef.current(clock.pause(stateRef.current));
      }
      return;
    }
    if (!wasRunning.current) {
      wasRunning.current = true;
      onStateRef.current(clock.restart(stateRef.current, Date.now()));
      return; // the restarted state comes back round and arms the timer below
    }
    if (deadline === null) return;

    const timer = setTimeout(() => {
      const current = stateRef.current;
      const result = engine.applyMove(current, clock.timeoutMove(), engine.turn(current), undefined, Date.now());
      if (result.ok) onStateRef.current(result.state);
    }, Math.max(0, deadline - Date.now()) + 30);
    return () => clearTimeout(timer);
  }, [engine, clock, running, deadline]);
}
