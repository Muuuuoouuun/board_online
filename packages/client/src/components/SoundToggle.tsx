import { useState } from "react";
import { isMuted, playSound, setMuted } from "../lib/sound.js";

/**
 * A toggle button, so the label stays put and `aria-pressed` carries the state:
 * a button whose name changes with its own state reads as a different control
 * each time, and contradicts itself when the name says one thing (소리 끄기)
 * while aria-pressed says another.
 */
export default function SoundToggle() {
  const [muted, setMutedState] = useState(() => isMuted());

  function toggle() {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (!next) playSound("click");
  }

  return (
    <button className="secondary-btn sound-toggle" onClick={toggle} aria-pressed={muted}>
      <span aria-hidden="true">{muted ? "🔇" : "🔊"}</span> 음소거
    </button>
  );
}
