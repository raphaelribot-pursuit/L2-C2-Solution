// SiteAssure -- minimal screen-flow router (local state machine) over the live Tauri commands.
// Home -> Capture -> Confirm -> Flags -> (save) -> Record (history + amend).
// Records and Audit are persistent-nav destinations reachable from any screen via ScreenShell's
// built-in bottom nav (see components/ScreenShell.tsx) -- no need to return to Home first.
import { useMemo, useState } from "react";
import { ThemeProvider, CssBaseline, IconButton, Tooltip, type PaletteMode } from "@mui/material";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import { createAppTheme } from "./theme";
import type { Draft, RecordKind } from "./lib/types";
import type { NavTab } from "./components/ScreenShell";
import HomeScreen from "./screens/HomeScreen";
import CaptureScreen from "./screens/CaptureScreen";
import ConfirmScreen from "./screens/ConfirmScreen";
import FlagsScreen from "./screens/FlagsScreen";
import RecordScreen from "./screens/RecordScreen";
import DashboardScreen from "./screens/DashboardScreen";
import RecordsScreen from "./screens/RecordsScreen";
import AuditScreen from "./screens/AuditScreen";
import SetupScreen from "./screens/SetupScreen";

// "setup" is the first-run install gate (voice model + ffmpeg); it self-skips when deps are
// already present or when running in a browser preview (see SetupScreen).
type Screen = "setup" | "home" | "capture" | "confirm" | "flags" | "record" | "dashboard" | "records" | "audit";

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
  const [mode, setMode] = useState<PaletteMode>("dark");

  const theme = useMemo(() => createAppTheme(mode), [mode]);
  const toggleMode = () => setMode((m) => (m === "dark" ? "light" : "dark"));

  // Persistent-nav handler shared by every screen via ScreenShell's bottom nav.
  const handleNav = (tab: NavTab) => {
    if (tab === "trends") setScreen("dashboard");
    else setScreen(tab);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Tooltip title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
        <IconButton
          onClick={toggleMode}
          size="small"
          sx={{
            position: "fixed",
            top: { xs: 12, md: 20 },
            right: { xs: 12, md: 24 },
            zIndex: 1300,
            bgcolor: "background.paper",
            border: "1px solid",
            borderColor: "divider",
            color: "text.primary",
            boxShadow: "0 6px 16px rgba(0,0,0,0.25)",
            "&:hover": { bgcolor: "background.paper" },
          }}
          aria-label="Toggle dark/light mode"
        >
          {mode === "dark" ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
      {screen === "setup" && <SetupScreen onReady={() => setScreen("home")} />}
      {screen === "home" && (
        <HomeScreen
          onNew={(kind) => { setDraft(emptyDraft(kind)); setScreen("capture"); }}
          onOpen={(id) => { setRecordId(id); setScreen("record"); }}
          onNav={handleNav}
        />
      )}
      {screen === "capture" && (
        <CaptureScreen draft={draft} setDraft={setDraft}
          onDone={() => setScreen("confirm")} onBack={() => setScreen("home")} onNav={handleNav} />
      )}
      {screen === "confirm" && (
        <ConfirmScreen draft={draft} setDraft={setDraft}
          onNext={() => setScreen("flags")} onBack={() => setScreen("capture")} onNav={handleNav} />
      )}
      {screen === "flags" && (
        <FlagsScreen draft={draft} setDraft={setDraft}
          onSaved={(id) => { setRecordId(id); setScreen("record"); }} onBack={() => setScreen("confirm")} onNav={handleNav} />
      )}
      {screen === "record" && (
        <RecordScreen id={recordId ?? ""} onHome={() => setScreen("home")} onNav={handleNav} />
      )}
      {screen === "dashboard" && (
        <DashboardScreen onHome={() => setScreen("home")} onNav={handleNav} />
      )}
      {screen === "records" && (
        <RecordsScreen
          onOpen={(id) => { setRecordId(id); setScreen("record"); }}
          onNav={handleNav}
        />
      )}
      {screen === "audit" && (
        <AuditScreen onNav={handleNav} />
      )}
    </ThemeProvider>
  );
}
