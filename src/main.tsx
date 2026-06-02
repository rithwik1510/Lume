import "@/styles/theme.css";
import "@/styles/fonts.css";
import ReactDOM from "react-dom/client";
import App from "./App";
import {
  readConfig,
  watchConfig,
  writeDefaultConfigIfMissing,
} from "@/lib/configClient";
import { useSettingsStore } from "@/store/settingsStore";
import { useToastStore } from "@/store/toastStore";
import { installSettingsApply } from "@/terminals/applySettings";

// StrictMode intentionally OFF — see DESIGN.md §4 rule #2:
// PTY lifecycle is keyed by paneId in module-level Map, not by React mount.
// StrictMode's double-invocation is harmless once that's true. Re-enable
// when paneId-keyed lifecycle is in place + verified.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);

// Config bootstrap: create the default file if missing, then load it.
// This runs AFTER the first render so the initial paint isn't blocked. A
// brief moment of defaults is visible while the file loads; in practice
// the read is fast enough that no flash occurs.
void (async () => {
  try {
    const created = await writeDefaultConfigIfMissing();
    if (created) console.info("config.toml created with defaults");
    const cfg = await readConfig();
    useSettingsStore.getState().applyConfig(cfg);
    installSettingsApply();
  } catch (err) {
    console.error("config bootstrap failed; keeping defaults", err);
    useToastStore.getState().push({
      severity: "warn",
      message: "Couldn't read config.toml; using defaults. Check the log for details.",
    });
  }
  // Hot reload subscription. Re-reads on every Changed event.
  try {
    await watchConfig(async (e) => {
      if (e.kind !== "changed") return;
      try {
        const cfg = await readConfig();
        useSettingsStore.getState().applyConfig(cfg);
        console.info("config.toml hot-reloaded");
      } catch (err) {
        console.warn("hot reload parse failed; keeping last valid", err);
        useToastStore.getState().push({
          severity: "warn",
          message: "Config has errors; keeping last valid values.",
        });
        useSettingsStore.getState().revertToLastValid();
      }
    });
  } catch (err) {
    console.error("watchConfig failed; hot reload disabled", err);
    useToastStore.getState().push({
      severity: "warn",
      message: "Config hot-reload disabled; changes won't apply until restart.",
    });
  }
})();
