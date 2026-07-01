// Shared screen shell. Persistent bottom nav (Home / Records / Trends / Audit) is always
// rendered, pinned to the bottom of a fixed-height frame -- only the content area between the
// header and the nav scrolls. The outer window/frame never grows or shrinks with content length.
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import ArticleRoundedIcon from "@mui/icons-material/ArticleRounded";
import TrendingUpRoundedIcon from "@mui/icons-material/TrendingUpRounded";
import VerifiedUserRoundedIcon from "@mui/icons-material/VerifiedUserRounded";
import { Box, BottomNavigation, BottomNavigationAction, Button, Paper, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

export type NavTab = "home" | "records" | "trends" | "audit";

interface ScreenShellProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  action?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  active?: NavTab;                 // omitted on the pre-nav Setup gate
  onNav?: (tab: NavTab) => void;   // when absent, the bottom nav is hidden
  children: ReactNode;
}

export default function ScreenShell({
  title,
  subtitle,
  eyebrow,
  action,
  onBack,
  backLabel = "Back",
  active,
  onNav,
  children,
}: ScreenShellProps) {
  return (
    // Locked to the viewport -- height (not minHeight), and no page-level scroll.
    // This is what keeps the app window a fixed size regardless of content length.
    <Box
      sx={{
        height: "100vh",
        overflow: "hidden",
        bgcolor: "background.default",
        px: { xs: 1.5, md: 3 },
        py: { xs: 2, md: 3 },
      }}
    >
      <Paper
        elevation={0}
        sx={{
          maxWidth: 1040,
          height: "100%",
          mx: "auto",
          borderRadius: { xs: 0, sm: 4 },
          overflow: "hidden",
          border: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
          // Flex column: header (fixed) -> content (flexes + scrolls) -> nav (fixed).
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header bar -- fixed height, never scrolls */}
        <Box
          sx={{
            flexShrink: 0,
            bgcolor: "grey.900",
            color: "common.white",
            px: { xs: 2, md: 3 },
            py: { xs: 2.5, md: 3 },
          }}
        >
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", sm: "center" }}
            spacing={1.5}
          >
            <Box>
              {eyebrow && (
                <Typography
                  variant="overline"
                  sx={{ display: "block", color: "grey.400", letterSpacing: "0.24em" }}
                >
                  {eyebrow}
                </Typography>
              )}
              <Typography variant="h2" sx={{ fontSize: { xs: 24, md: 30 }, color: "common.white" }}>
                {title}
              </Typography>
              {subtitle && (
                <Typography variant="body2" sx={{ mt: 0.5, color: "grey.300", maxWidth: 680 }}>
                  {subtitle}
                </Typography>
              )}
            </Box>
            <Stack direction="row" spacing={1} alignItems="center">
              {action}
              {onBack && (
                <Button
                  startIcon={<ArrowBackIcon />}
                  onClick={onBack}
                  variant="outlined"
                  sx={{
                    color: "common.white",
                    borderColor: "rgba(255,255,255,0.2)",
                    px: 1.5,
                    "&:hover": {
                      borderColor: "rgba(255,255,255,0.35)",
                      bgcolor: "rgba(255,255,255,0.08)",
                    },
                  }}
                >
                  {backLabel}
                </Button>
              )}
            </Stack>
          </Stack>
        </Box>

        {/* Content -- the ONLY scrollable region. flex:1 + minHeight:0 is what makes a flex
            child scroll instead of pushing the parent taller (the classic flexbox overflow trap). */}
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            p: { xs: 2, md: 3 },
            bgcolor: "background.default",
          }}
        >
          {children}
        </Box>

        {/* Persistent bottom nav -- fixed height, always visible, sits above the scrollable
            content (never scrolls with it, never gets pushed off-screen).
            Hidden on the pre-nav Setup gate, which passes no onNav. */}
        {onNav && (
        <Box sx={{ flexShrink: 0, borderTop: "1px solid", borderColor: "divider", bgcolor: "grey.900" }}>
          <BottomNavigation
            showLabels
            value={active}
            onChange={(_, v) => onNav(v)}
            sx={{
              bgcolor: "transparent",
              "& .MuiBottomNavigationAction-root": { color: "grey.500" },
              "& .Mui-selected": { color: "secondary.main" },
            }}
          >
            <BottomNavigationAction label="Home" value="home" icon={<HomeRoundedIcon />} />
            <BottomNavigationAction label="Records" value="records" icon={<ArticleRoundedIcon />} />
            <BottomNavigationAction label="Trends" value="trends" icon={<TrendingUpRoundedIcon />} />
            <BottomNavigationAction label="Audit" value="audit" icon={<VerifiedUserRoundedIcon />} />
          </BottomNavigation>
        </Box>
        )}
      </Paper>
    </Box>
  );
}
