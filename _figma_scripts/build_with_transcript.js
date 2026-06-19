function c(hex) {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 };
}
const COL = {
  bg: c("#04171C"), screen: c("#082530"), surface: c("#0E323E"), surfaceAlt: c("#0B2B36"),
  hairline: c("#1C4350"), text: c("#EAF6F1"), muted: c("#9FB8B5"), mint: c("#5FD3A0"),
  onMint: c("#062018"),
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
function makeBtn(label) {
  const b = figma.createAutoLayout("HORIZONTAL", { name: "Btn/" + label, paddingLeft: 14, paddingRight: 14, paddingTop: 8, paddingBottom: 8, cornerRadius: 8, fills: solid(COL.surfaceAlt), strokes: solid(COL.hairline), strokeWeight: 1 });
  b.appendChild(makeText(label, 13, "Regular", COL.text));
  return b;
}

const win = figma.createFrame({ name: "03 - With Transcript", width: 960, height: 720, x: 2160, y: 80, cornerRadius: 12 });
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
brand.appendChild(mark);
const brandText = figma.createAutoLayout("VERTICAL", { itemSpacing: 1 });
brandText.appendChild(makeText("Resona.", 26, "Semi Bold", { r: 1, g: 1, b: 1 }));
brandText.appendChild(makeText("a private whisper", 12, "Regular", COL.text));
brand.appendChild(brandText); row.appendChild(brand);
const actions = figma.createAutoLayout("HORIZONTAL", { itemSpacing: 8 });
actions.appendChild(makeBtn("About")); actions.appendChild(makeBtn("Get started"));
row.appendChild(actions); header.appendChild(row); row.layoutSizingHorizontal = "FILL";
header.appendChild(makeText("VOICE > TEXT > EXPORT", 11, "Semi Bold", { r: 1, g: 1, b: 1, a: 0.55 }));
win.appendChild(header); header.layoutSizingHorizontal = "FILL";

const body = figma.createAutoLayout("VERTICAL", { name: "Body", width: 960, paddingLeft: 24, paddingRight: 24, paddingBottom: 20, itemSpacing: 0 });
const card = figma.createAutoLayout("VERTICAL", { name: "Body Card", width: 912, paddingLeft: 22, paddingRight: 22, paddingTop: 20, paddingBottom: 22, itemSpacing: 16, cornerRadius: 16, fills: solid(COL.surface), strokes: solid(COL.hairline), strokeWeight: 1 });

const cols = figma.createAutoLayout("HORIZONTAL", { name: "Two Column", itemSpacing: 16, width: 868 });
const library = figma.createAutoLayout("VERTICAL", { name: "Library", width: 220, paddingTop: 16, paddingBottom: 16, paddingLeft: 16, paddingRight: 16, itemSpacing: 8, cornerRadius: 12, fills: solid(COL.surfaceAlt), strokes: solid(COL.hairline), strokeWeight: 1 });
library.appendChild(makeText("LIBRARY", 11, "Semi Bold", COL.muted));
function libItem(label, active) {
  const item = figma.createAutoLayout("HORIZONTAL", { paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10, cornerRadius: 8, width: 188, fills: active ? [{ type: "SOLID", color: COL.mint, opacity: 0.08 }] : [], strokes: solid(active ? COL.mint : COL.hairline), strokeWeight: 1 });
  item.appendChild(makeText(label, 13, "Regular", COL.text));
  return item;
}
library.appendChild(libItem("Meeting notes", true));
library.appendChild(libItem("Lecture clip", false));
cols.appendChild(library);

const transcript = figma.createAutoLayout("VERTICAL", { name: "Transcript", width: 632, paddingTop: 16, paddingBottom: 16, paddingLeft: 16, paddingRight: 16, itemSpacing: 12, cornerRadius: 12, fills: solid(COL.surfaceAlt), strokes: solid(COL.hairline), strokeWeight: 1 });
transcript.appendChild(makeText("TRANSCRIPT", 11, "Semi Bold", COL.muted));
const line1 = figma.createAutoLayout("VERTICAL", { itemSpacing: 4 });
line1.appendChild(makeText("0:00 - 0:04", 11, "Regular", COL.muted));
line1.appendChild(makeText("So I think the proposal looks good.", 16, "Regular", COL.text));
transcript.appendChild(line1);
const line2 = figma.createAutoLayout("VERTICAL", { itemSpacing: 4 });
line2.appendChild(makeText("0:04 - 0:09", 11, "Regular", COL.muted));
line2.appendChild(makeText("We should send it before Friday.", 16, "Regular", COL.text));
transcript.appendChild(line2);
const toolbar = figma.createAutoLayout("HORIZONTAL", { itemSpacing: 10 });
toolbar.appendChild(makeBtn("Copy")); toolbar.appendChild(makeBtn("Export"));
transcript.appendChild(toolbar);
cols.appendChild(transcript); transcript.layoutSizingHorizontal = "FILL";
card.appendChild(cols); cols.layoutSizingHorizontal = "FILL";

body.appendChild(card); card.layoutSizingHorizontal = "FILL"; card.layoutSizingVertical = "FILL";
win.appendChild(body); body.layoutSizingHorizontal = "FILL"; body.layoutSizingVertical = "FILL";
figma.currentPage.appendChild(win);
return { createdNodeIds: [win.id, card.id, cols.id] };
