// SiteAssure — minimal screen-flow router (local state machine) over the live Tauri commands.
// Home → Capture → Confirm → Flags → (save) → Record (history + amend).
import { useState } from "react";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { theme } from "./theme";
import type { Draft, RecordKind } from "./lib/types";
import HomeScreen from "./screens/HomeScreen";
import CaptureScreen from "./screens/CaptureScreen";
import ConfirmScreen from "./screens/ConfirmScreen";
import FlagsScreen from "./screens/FlagsScreen";
import RecordScreen from "./screens/RecordScreen";
import DashboardScreen from "./screens/DashboardScreen";
import SetupScreen from "./screens/SetupScreen";

type Screen = "setup" | "home" | "capture" | "confirm" | "flags" | "record" | "dashboard";

const emptyDraft = (kind: RecordKind): Draft => ({
  kind,
  transcript: "",
  segments: [],
  narrative: "",
  fields: { date: new Date().toISOString().slice(0, 10) },
  flags: [],
});

export default function App() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [draft, setDraft] = useState<Draft>(emptyDraft("daily_log"));
  const [recordId, setRecordId] = useState<string | null>(null);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {screen === "setup" && (
        <SetupScreen onReady={() => setScreen("home")} />
      )}
      {screen === "home" && (
        <HomeScreen
          onNew={(kind) => { setDraft(emptyDraft(kind)); setScreen("capture"); }}
          onOpen={(id) => { setRecordId(id); setScreen("record"); }}
          onTrends={() => setScreen("dashboard")}
        />
      )}
      {screen === "capture" && (
        <CaptureScreen draft={draft} setDraft={setDraft}
          onDone={() => setScreen("confirm")} onBack={() => setScreen("home")} />
      )}
      {screen === "confirm" && (
        <ConfirmScreen draft={draft} setDraft={setDraft}
          onNext={() => setScreen("flags")} onBack={() => setScreen("capture")} />
      )}
      {screen === "flags" && (
        <FlagsScreen draft={draft} setDraft={setDraft}
          onSaved={(id) => { setRecordId(id); setScreen("record"); }} onBack={() => setScreen("confirm")} />
      )}
      {screen === "record" && recordId && (
        <RecordScreen id={recordId} onHome={() => setScreen("home")} />
      )}
      {screen === "dashboard" && (
        <DashboardScreen onHome={() => setScreen("home")} />
      )}
    </ThemeProvider>
  );
}
