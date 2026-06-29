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

type Screen = "home" | "capture" | "confirm" | "flags" | "record";

const emptyDraft = (kind: RecordKind): Draft => ({
  kind,
  transcript: "",
  segments: [],
  narrative: "",
  fields: { date: new Date().toISOString().slice(0, 10) },
  flags: [],
});

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [draft, setDraft] = useState<Draft>(emptyDraft("daily_log"));
  const [recordId, setRecordId] = useState<string | null>(null);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {screen === "home" && (
        <HomeScreen
          onNew={(kind) => { setDraft(emptyDraft(kind)); setScreen("capture"); }}
          onOpen={(id) => { setRecordId(id); setScreen("record"); }}
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
    </ThemeProvider>
  );
}
