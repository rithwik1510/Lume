import ReactDOM from "react-dom/client";
import App from "./App";

// StrictMode disabled for the spike: it double-invokes useEffect in dev,
// which races pty_open/pty_kill and leaves the Rust state in None. We'll
// re-enable it in Weekend 1 once pty lifecycle is keyed by paneId.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
