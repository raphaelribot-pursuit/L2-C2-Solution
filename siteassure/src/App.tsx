// SiteAssure — screen-flow router. Five capture screens + the back-office dashboard (stretch).
import { ThemeProvider, CssBaseline } from "@mui/material";
import { theme } from "./theme";
// TODO(build): wire a simple router (local state machine or react-router) across:
//   Home -> Capture -> Confirm -> Flags -> (save) -> Record (history).  Dashboard is separate.
export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* TODO(build): <Router/> across the screens in src/screens */}
    </ThemeProvider>
  );
}
