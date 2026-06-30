import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

interface ScreenShellProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  action?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  children: ReactNode;
}

export default function ScreenShell({
  title,
  subtitle,
  eyebrow,
  action,
  onBack,
  backLabel = "Back",
  children,
}: ScreenShellProps) {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", px: { xs: 1.5, md: 3 }, py: { xs: 2, md: 3 } }}>
      <Paper
        elevation={0}
        sx={{
          maxWidth: 1040,
          mx: "auto",
          borderRadius: { xs: 0, sm: 4 },
          overflow: "hidden",
          border: "1px solid",
          borderColor: "divider",
          boxShadow: "0 20px 55px rgba(17, 24, 39, 0.08)",
          bgcolor: "#FFFFFF",
        }}
      >
        <Box sx={{ bgcolor: "grey.900", color: "common.white", px: { xs: 2, md: 3 }, py: { xs: 2.5, md: 3 } }}>
          <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} spacing={1.5}>
            <Box>
              {eyebrow && (
                <Typography variant="overline" sx={{ display: "block", color: "grey.400", letterSpacing: "0.24em" }}>
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
                    "&:hover": { borderColor: "rgba(255,255,255,0.35)", bgcolor: "rgba(255,255,255,0.08)" },
                  }}
                >
                  {backLabel}
                </Button>
              )}
            </Stack>
          </Stack>
        </Box>
        <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: "background.default" }}>{children}</Box>
      </Paper>
    </Box>
  );
}
