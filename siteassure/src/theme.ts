// SiteAssure design tokens -> MUI theme. Charcoal / amber / steel, themed so the UI reads as
// industrial field tooling rather than default Material. Fonts: Roboto Slab (headers) + Inter (body).
import { createTheme } from "@mui/material/styles";

export const tokens = {
  charcoal: "#1E242A", amber: "#F4A41E", amberInk: "#B5450F",
  steel: "#5C8DB2", steelInk: "#34638A", paper: "#F4F6F7", muted: "#6B7680",
};

export const theme = createTheme({
  palette: {
    primary:   { main: tokens.steel, dark: tokens.steelInk },
    secondary: { main: tokens.amber, dark: tokens.amberInk },  // amber = the one sharp accent (flags / active / "prove it")
    background:{ default: tokens.paper, paper: "#FFFFFF" },
    text:      { primary: tokens.charcoal, secondary: tokens.muted },
  },
  typography: {
    fontFamily: "Inter, system-ui, sans-serif",
    h1: { fontFamily: "'Roboto Slab', serif", fontWeight: 700 },
    h2: { fontFamily: "'Roboto Slab', serif", fontWeight: 700 },
    h3: { fontFamily: "'Roboto Slab', serif", fontWeight: 600 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  shape: { borderRadius: 10 },
});
