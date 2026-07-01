// SiteAssure design tokens -> MUI theme.
// Matches the design-reference mockup (docs/siteassure_mockup.html / SiteAssure_MockupFigures.pdf):
// a dark charcoal field-tooling surface, safety amber as the single sharp accent (record button,
// active states, flags), steel blue as the secondary/info accent, ledger-style monospace for
// timestamps and "no signal" status. Headers: Roboto Slab. Body/UI: Inter. Mono: IBM Plex Mono.
//
// Supports both dark (default, matches mockup) and light mode via createAppTheme(mode).
import { createTheme, alpha } from "@mui/material/styles";
import type { PaletteMode } from "@mui/material";

export const tokens = {
  // Dark surfaces — the mockup's phone frame is near-black charcoal.
  charcoal: "#15191D",       // app background
  charcoalRaised: "#1E242A", // cards / raised panels on the dark surface
  charcoalLine: "#2A3138",   // hairline borders on dark surfaces
  ink: "#ECEFF1",            // primary text on dark
  inkMuted: "#9AA5AD",       // secondary text on dark

  // Light surfaces — same field-ledger language, inverted for daylight/outdoor readability.
  paperBg: "#F4F6F7",        // app background (light)
  paperRaised: "#FFFFFF",    // cards / raised panels on the light surface
  paperLine: "#DDE2E6",      // hairline borders on light surfaces
  paperInk: "#1B2126",       // primary text on light
  paperInkMuted: "#5C6670",  // secondary text on light

  // Accents — identical in both modes, this is the app's fixed identity.
  amber: "#F4A41E",
  amberInk: "#B5450F",
  steel: "#5C8DB2",
  steelInk: "#34638A",

  paper: "#F4F6F7",
  muted: "#6B7680",

  success: "#2DAA5A",
  error: "#E0594A",
};

const sharedTypography = {
  fontFamily: "Inter, system-ui, sans-serif",
  h1: { fontFamily: "'Roboto Slab', serif", fontWeight: 700 },
  h2: { fontFamily: "'Roboto Slab', serif", fontWeight: 700 },
  h3: { fontFamily: "'Roboto Slab', serif", fontWeight: 600 },
  h4: { fontFamily: "'Roboto Slab', serif", fontWeight: 600 },
  h5: { fontFamily: "'Roboto Slab', serif", fontWeight: 600 },
  h6: { fontFamily: "'Roboto Slab', serif", fontWeight: 600 },
  overline: { letterSpacing: "0.18em", fontWeight: 600 },
  button: { textTransform: "none", fontWeight: 600 },
} as const;

const sharedShape = { borderRadius: 14 } as const;

export function createAppTheme(mode: PaletteMode = "dark") {
  const isDark = mode === "dark";

  const bg = isDark ? tokens.charcoal : tokens.paperBg;
  const bgRaised = isDark ? tokens.charcoalRaised : tokens.paperRaised;
  const line = isDark ? tokens.charcoalLine : tokens.paperLine;
  const ink = isDark ? tokens.ink : tokens.paperInk;
  const inkMuted = isDark ? tokens.inkMuted : tokens.paperInkMuted;

  return createTheme({
    palette: {
      mode,
      primary: { main: tokens.steel, dark: tokens.steelInk, contrastText: "#FFFFFF" },
      secondary: { main: tokens.amber, dark: tokens.amberInk, contrastText: "#1E242A" },
      background: { default: bg, paper: bgRaised },
      text: { primary: ink, secondary: inkMuted },
      divider: line,
      success: { main: tokens.success, contrastText: "#0B1A10" },
      error: { main: tokens.error, contrastText: "#FFFFFF" },
      grey: isDark
        ? {
            50: tokens.charcoalRaised,
            100: "#252C33",
            200: tokens.charcoalLine,
            300: "#3A434B",
            900: "#0D1013",
          }
        : {
            50: tokens.paperRaised,
            100: "#EDF0F2",
            200: tokens.paperLine,
            300: "#C7CED3",
            // Header bar (ScreenShell) uses grey.900 for a near-black bar in BOTH modes,
            // so the app keeps its "ledger" identity even in light mode.
            900: "#12171B",
          },
    },
    typography: sharedTypography,
    shape: sharedShape,
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { backgroundColor: bg },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { boxShadow: "none", borderRadius: 999 },
          outlined: { borderWidth: 1.5 },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            boxShadow: isDark ? "0 18px 40px rgba(0, 0, 0, 0.35)" : "0 8px 24px rgba(20, 24, 28, 0.10)",
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 600 },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: { backgroundImage: "none" },
        },
      },
    },
  });
}

// Default export kept for any file still importing the static theme directly.
export const theme = createAppTheme("dark");

// Monospace stack for ledger-style readouts: timestamps, "no signal", record counts.
export const monoFont = "'IBM Plex Mono', 'Roboto Mono', ui-monospace, SFMono-Regular, monospace";

// Shared helpers for the amber "record" affordance used on Home + Capture.
export const amberGlow = (strength = 0.18) => `0 0 0 10px ${alpha(tokens.amber, strength)}`;
