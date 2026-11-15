import { createRoot } from "react-dom/client";
import "./style.css";

function App() {
  return (
    <main>
      <h1>Платформа QDA</h1>
      <p className="mono">версія 0.1.0 · каркас програми</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
