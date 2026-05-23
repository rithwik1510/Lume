import "@/styles/theme.css";
import "@/styles/fonts.css";
import ReactDOM from "react-dom/client";
import App from "./App";

// StrictMode intentionally OFF — see DESIGN.md §4 rule #2:
// PTY lifecycle is keyed by paneId in module-level Map, not by React mount.
// StrictMode's double-invocation is harmless once that's true. Re-enable
// when paneId-keyed lifecycle is in place + verified.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
