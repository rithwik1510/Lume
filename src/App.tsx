// Workstation root component. Weekend 1 scope: render 4 Terminal Panes in a
// flat row to validate smoothness baseline (§9 Smoothness acceptance test).
// Layout tree / splitters / tabs / sidebar / MD editor land in later weekends.

export default function App() {
  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#0a0a0a",
        color: "#e8e8e8",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 14,
      }}
    >
      Workstation v0.1-alpha — scaffold OK
    </div>
  );
}
