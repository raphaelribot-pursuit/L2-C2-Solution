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
  } else {
    b.fills = solid(COL.surfaceAlt); b.strokes = solid(COL.hairline); b.strokeWeight = 1;
    b.appendChild(makeText(label, 13, "Regular", COL.text));
  }
  return b;
}

const win = figma.createFrame({ name: "02 - Model Missing", width: 960, height: 720, x: 1120, y: 80, cornerRadius: 12 });
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
row.appendChild(actions); header.appendChild(row); row.layoutSizingHorizontal = "FILL";
header.appendChild(makeText("VOICE > TEXT > EXPORT", 11, "Semi Bold", { r: 1, g: 1, b: 1, a: 0.55 }));
const wave = figma.createAutoLayout("HORIZONTAL", { itemSpacing: 3, counterAxisAlignItems: "MAX", height: 52 });
[10, 20, 34, 48, 52, 36, 44, 28, 50, 38, 22, 40].forEach((h) => {
  const bar = figma.createRectangle(); bar.resize(4, h); bar.cornerRadius = 2;
  bar.fills = [{ type: "SOLID", color: { r: 0.749, g: 0.937, b: 0.839 }, opacity: 0.85 }]; wave.appendChild(bar);
});
const waveWrap = figma.createAutoLayout("VERTICAL", { itemSpacing: 6, counterAxisAlignItems: "CENTER", width: 904 });
waveWrap.appendChild(wave);
waveWrap.appendChild(makeText("Download a speech model to begin", 12, "Regular", { r: 1, g: 1, b: 1, a: 0.75 }));
header.appendChild(waveWrap); waveWrap.layoutSizingHorizontal = "FILL";
win.appendChild(header); header.layoutSizingHorizontal = "FILL";

const body = figma.createAutoLayout("VERTICAL", { name: "Body", width: 960, paddingLeft: 24, paddingRight: 24, paddingBottom: 20, itemSpacing: 0 });
const card = figma.createAutoLayout("VERTICAL", { name: "Body Card", width: 912, paddingLeft: 22, paddingRight: 22, paddingTop: 20, paddingBottom: 22, itemSpacing: 16, cornerRadius: 16, fills: solid(COL.surface), strokes: solid(COL.hairline), strokeWeight: 1 });

const setup = figma.createAutoLayout("VERTICAL", { name: "Setup Panel", width: 868, paddingTop: 32, paddingBottom: 32, paddingLeft: 24, paddingRight: 24, itemSpacing: 12, cornerRadius: 14, counterAxisAlignItems: "CENTER", fills: [{ type: "GRADIENT_LINEAR", gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: [{ position: 0, color: { ...c("#5FD3A0"), a: 0.14 } }, { position: 1, color: { ...c("#57C6D6"), a: 0.1 } }] }], strokes: [{ type: "SOLID", color: COL.mint, opacity: 0.4 }], strokeWeight: 1 });
const appmarkLg = figma.createFrame({ name: "Appmark LG", width: 56, height: 56, cornerRadius: 14 });
appmarkLg.fills = [{ type: "GRADIENT_LINEAR", gradientTransform: [[0, 1, 0], [1, 0, 0]], gradientStops: [{ position: 0, color: { ...c("#0B3A44"), a: 1 } }, { position: 1, color: { ...c("#061A20"), a: 1 } }] }];
setup.appendChild(appmarkLg);
const h2 = makeText("One more step", 22, "Semi Bold", COL.text); setup.appendChild(h2);
const p1 = makeText("Resona needs a speech model before it can transcribe. We will check your system and recommend the right size.", 15, "Regular", COL.muted);
p1.textAlignHorizontal = "CENTER"; p1.resize(440, 48); setup.appendChild(p1);
const tiers = makeText("Small (~75 MB) · Medium (~150 MB) · Large (~1.6 GB)", 13, "Regular", COL.mint);
setup.appendChild(tiers);
const cta = makeBtn("Open setup guide", "primary");
cta.paddingLeft = 28; cta.paddingRight = 28; cta.paddingTop = 12; cta.paddingBottom = 12;
setup.appendChild(cta);
setup.resize(868, 320);
card.appendChild(setup); setup.layoutSizingHorizontal = "FILL";

body.appendChild(card); card.layoutSizingHorizontal = "FILL"; card.layoutSizingVertical = "FILL";
win.appendChild(body); body.layoutSizingHorizontal = "FILL"; body.layoutSizingVertical = "FILL";
figma.currentPage.appendChild(win);
return { createdNodeIds: [win.id, card.id, setup.id] };
