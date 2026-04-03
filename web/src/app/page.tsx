import InputBar from "@/components/InputBar";

export default function Home() {
  return (
    <main
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        background: "var(--background)",
        overflow: "hidden",
        padding: 0,
        margin: 0,
        border: "none",
        position: "fixed",
        top: 0,
        left: 0,
      }}
    >
      {/* Welcome */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "10px",
          userSelect: "none",
          pointerEvents: "none",
          flex: 1,
          height: "auto",
        }}
      >
        <h1
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: "clamp(2rem, 5vw, 3.4rem)",
            fontWeight: 500,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "#d4d4d4",
            margin: 0,
          }}
        >
          Brain2
        </h1>
        <p
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: "clamp(0.65rem, 1.4vw, 0.78rem)",
            fontWeight: 300,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "#464646",
            margin: 0,
          }}
        >
          The Extension of Your Mind
        </p>
      </div>

      {/* Bottom input bar */}
      <InputBar />
    </main>
  );
}

