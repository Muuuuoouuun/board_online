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
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M11 4 6 8H3v8h3l5 4V4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        {muted ? <path d="m16 9 5 6m0-6-5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /> : <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
      </svg>
      음소거
    </button>
  );
}
