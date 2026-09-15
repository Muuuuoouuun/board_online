import { Route, Routes } from "react-router-dom";
import Home from "./pages/Home.js";
import Room from "./pages/Room.js";
import Local from "./pages/Local.js";
import AiPlay from "./pages/AiPlay.js";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/room/:code" element={<Room />} />
      <Route path="/local/:gameId" element={<Local />} />
      <Route path="/ai/:gameId" element={<AiPlay />} />
    </Routes>
  );
}
