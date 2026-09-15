import { useState } from "react";
import { isMuted, playSound, setMuted } from "../lib/sound.js";

export default function SoundToggle() {
  const [muted, setMutedState] = useState(() => isMuted());

  function toggle() {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (!next) playSound("click");
  }

  return (
    <button
      className="secondary-btn sound-toggle"
      onClick={toggle}
      aria-pressed={muted}
      title={muted ? "소리 켜기" : "소리 끄기"}
    >
      {muted ? "🔇 소리 꺼짐" : "🔊 소리 켜짐"}
    </button>
  );
}
