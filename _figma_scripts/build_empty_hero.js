function c(hex) {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 };
}
const COL = {
  bg: c("#04171C"), screen: c("#082530"), surface: c("#0E323E"), surfaceAlt: c("#0B2B36"),
  hairline: c("#1C4350"), text: c("#EAF6F1"), muted: c("#9FB8B5"), mint: c("#5FD3A0"),
  teal: c("#57C6D6"), onMint: c("#062018"),
};
await figma.loadFontAsync({ family: "Inter", style: "Regular" });
await figma.loadFontAsync({ family: "Inter", style: "Medium" });
await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
function solid(color, opacity = 1) { return [{ type: "SOLID", color, opacity }]; }
function makeText(str, size, style, color) {
  const t = figma.createText();
  t.fontName = { family: "Inter", style };
  t.characters = str;
  t.fontSize = size;
  t.fills = solid(color);
  return t;
}
function makeBtn(label, variant) {
  const b = figma.createAutoLayout("HORIZONTAL", { name: "Btn/" + label, paddingLeft: 14, paddingRight: 14, paddingTop: 8, paddingBottom: 8, cornerRadius: 8 });
  if (variant === "primary") {
    b.fills = solid(COL.mint); b.strokes = solid(COL.mint); b.strokeWeight = 1;
    b.appendChild(makeText(label, 13, "Semi Bold", COL.onMint));
  } else if (variant === "ghost") {
    b.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0.1 }];
    b.strokes = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0.25 }]; b.strokeWeight = 1;
    b.appendChild(makeText(label, 13, "Regular", { r: 1, g: 1, b: 1 }));
  } else if (variant === "record") {
    b.fills = [{ type: "SOLID", color: COL.teal, opacity: 0.1 }]; b.strokes = solid(COL.teal); b.strokeWeight = 1;
    b.appendChild(makeText(label, 13, "Regular", COL.teal));
  } else {
    b.fills = solid(COL.surfaceAlt); b.strokes = solid(COL.hairline); b.strokeWeight = 1;
    b.appendChild(makeText(label, 13, "Regular", COL.text));
  }
  return b;
}

const win = figma.createFrame({ name: "01 - Empty Hero", width: 960, height: 720, x: 80, y: 80, cornerRadius: 12 });
win.clipsContent = true;
win.fills = solid(COL.bg);
win.strokes = solid(c("#0A2830"));
win.strokeWeight = 1;
win.layoutMode = "VERTICAL";
win.itemSpacing = 0;

const titlebar = figma.createAutoLayout("HORIZONTAL", { name: "Titlebar", width: 960, height: 36, paddingLeft: 14, itemSpacing: 8, fills: solid(COL.screen), strokes: solid(COL.hairline), strokeWeight: 1, primaryAxisAlignItems: "CENTER" });
for (const hex of ["#FF5F57", "#FEBC2E", "#28C840"]) {
  const dot = figma.createEllipse(); dot.resize(12, 12); dot.fills = solid(c(hex)); titlebar.appendChild(dot);
}
titlebar.appendChild(makeText("Resona", 12, "Regular", COL.muted));
win.appendChild(titlebar);
titlebar.layoutSizingHorizontal = "FILL";

const header = figma.createAutoLayout("VERTICAL", { name: "Hero Header", width: 960, paddingLeft: 28, paddingRight: 28, paddingTop: 18, paddingBottom: 14, itemSpacing: 8, fills: [{ type: "GRADIENT_LINEAR", gradientTransform: [[0.97, -0.26, 0.13], [0.26, 0.97, 0.05]], gradientStops: [{ position: 0, color: { ...c("#0B3A44"), a: 1 } }, { position: 0.42, color: { ...c("#0E7C86"), a: 1 } }, { position: 0.88, color: { ...c("#155E3E"), a: 1 } }] }] });

const row = figma.createAutoLayout("HORIZONTAL", { name: "Header Row", width: 904, primaryAxisAlignItems: "SPACE_BETWEEN", counterAxisAlignItems: "CENTER" });
const brand = figma.createAutoLayout("HORIZONTAL", { itemSpacing: 12, counterAxisAlignItems: "CENTER" });
const mark = figma.createFrame({ name: "Appmark", width: 36, height: 36, cornerRadius: 9 });
mark.fills = [{ type: "GRADIENT_LINEAR", gradientTransform: [[0, 1, 0], [1, 0, 0]], gradientStops: [{ position: 0, color: { ...c("#0B3A44"), a: 1 } }, { position: 1, color: { ...c("#061A20"), a: 1 } }] }];
const leaf = figma.createEllipse(); leaf.resize(18, 22); leaf.x = 9; leaf.y = 7;
leaf.fills = [{ type: "GRADIENT_LINEAR", gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: [{ position: 0, color: { ...c("#7FE6B6"), a: 1 } }, { position: 1, color: { ...c("#3FB37E"), a: 1 } }] }];
mark.appendChild(leaf); brand.appendChild(mark);
const brandText = figma.createAutoLayout("VERTICAL", { itemSpacing: 1 });
brandText.appendChild(makeText("Resona.", 26, "Semi Bold", { r: 1, g: 1, b: 1 }));
brandText.appendChild(makeText("a private whisper", 12, "Regular", COL.text));
brand.appendChild(brandText); row.appendChild(brand);
const actions = figma.createAutoLayout("HORIZONTAL", { itemSpacing: 8 });
actions.appendChild(makeBtn("About", "ghost")); actions.appendChild(makeBtn("Get started", "ghost"));
row.appendChild(actions); header.appendChild(row);
row.layoutSizingHorizontal = "FILL";
header.appendChild(makeText("VOICE > TEXT > EXPORT", 11, "Semi Bold", { r: 1, g: 1, b: 1, a: 0.55 }));

const wave = figma.createAutoLayout("HORIZONTAL", { itemSpacing: 3, counterAxisAlignItems: "MAX", height: 52 });
[10, 20, 34, 48, 52, 36, 44, 28, 50, 38, 22, 40].forEach((h) => {
  const bar = figma.createRectangle(); bar.resize(4, h); bar.cornerRadius = 2;
  bar.fills = [{ type: "SOLID", color: { r: 0.749, g: 0.937, b: 0.839 }, opacity: 0.85 }]; wave.appendChild(bar);
});
const waveWrap = figma.createAutoLayout("VERTICAL", { itemSpacing: 6, counterAxisAlignItems: "CENTER", width: 904 });
waveWrap.appendChild(wave);
waveWrap.appendChild(makeText("Drop audio below or start recording", 12, "Regular", { r: 1, g: 1, b: 1, a: 0.75 }));
header.appendChild(waveWrap);
waveWrap.layoutSizingHorizontal = "FILL";
win.appendChild(header);
header.layoutSizingHorizontal = "FILL";

const body = figma.createAutoLayout("VERTICAL", { name: "Body", width: 960, paddingLeft: 24, paddingRight: 24, paddingBottom: 20, itemSpacing: 0 });
const card = figma.createAutoLayout("VERTICAL", { name: "Body Card", width: 912, paddingLeft: 22, paddingRight: 22, paddingTop: 20, paddingBottom: 22, itemSpacing: 16, cornerRadius: 16, fills: solid(COL.surface), strokes: solid(COL.hairline), strokeWeight: 1 });
card.appendChild(makeText("TRANSCRIBE", 11, "Semi Bold", COL.muted));
card.appendChild(makeText("On-device - nothing leaves your computer", 13, "Regular", COL.muted));

const drop = figma.createAutoLayout("VERTICAL", { name: "Hero Drop", width: 868, paddingTop: 24, paddingBottom: 24, paddingLeft: 24, paddingRight: 24, itemSpacing: 12, cornerRadius: 14, counterAxisAlignItems: "CENTER", strokes: solid(COL.hairline), strokeWeight: 2, dashPattern: [8, 6], fills: [{ type: "GRADIENT_LINEAR", gradientTransform: [[0, 1, 0], [0, 0, 1]], gradientStops: [{ position: 0, color: { ...c("#5FD3A0"), a: 0.05 } }, { position: 1, color: { ...c("#04171C"), a: 0 } }] }] });
drop.resize(868, 200);
drop.appendChild(makeText("Drop audio or video here", 18, "Semi Bold", COL.text));
const lead = makeText("Record, choose a file, or paste a URL - all transcription stays local.", 14, "Regular", COL.muted);
lead.textAlignHorizontal = "CENTER"; lead.resize(380, 42); drop.appendChild(lead);
const heroActions = figma.createAutoLayout("HORIZONTAL", { itemSpacing: 10, layoutWrap: "WRAP" });
heroActions.appendChild(makeBtn("Record", "record")); heroActions.appendChild(makeBtn("Choose file", "default")); heroActions.appendChild(makeBtn("Transcribe", "primary"));
drop.appendChild(heroActions); card.appendChild(drop);
drop.layoutSizingHorizontal = "FILL";

const urlBlock = figma.createAutoLayout("VERTICAL", { itemSpacing: 6, width: 868 });
urlBlock.appendChild(makeText("Import from URL", 12, "Medium", COL.muted));
const urlRow = figma.createAutoLayout("HORIZONTAL", { itemSpacing: 8, width: 868 });
const input = figma.createAutoLayout("HORIZONTAL", { paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10, cornerRadius: 8, fills: solid(COL.surfaceAlt), strokes: solid(COL.hairline), strokeWeight: 1 });
input.appendChild(makeText("https://www.youtube.com/watch?v=...", 14, "Regular", c("#6B7F7C")));
urlRow.appendChild(input); input.layoutSizingHorizontal = "FILL";
urlRow.appendChild(makeBtn("Download and transcribe", "primary"));
urlBlock.appendChild(urlRow);
card.appendChild(urlBlock); urlBlock.layoutSizingHorizontal = "FILL";
card.appendChild(makeText("Advanced options - language, GPU, model size", 13, "Regular", COL.muted));

body.appendChild(card); card.layoutSizingHorizontal = "FILL"; card.layoutSizingVertical = "FILL";
win.appendChild(body); body.layoutSizingHorizontal = "FILL"; body.layoutSizingVertical = "FILL";
figma.currentPage.appendChild(win);
return { createdNodeIds: [win.id, card.id, drop.id] };
