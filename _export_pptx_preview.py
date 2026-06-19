"""Export slide PNG previews via PowerPoint COM (Windows)."""
import sys
from pathlib import Path

pptx = Path(
    r"C:\Users\Aisling Ld Pursuit\OneDrive\Documents\Pursuit L2 Project\L2 Clone of Wisper\docs\Wisper_Product_Story.pptx"
)
out_dir = pptx.parent / "pptx_preview"
out_dir.mkdir(exist_ok=True)

try:
    import win32com.client
except ImportError:
    import subprocess

    subprocess.check_call([sys.executable, "-m", "pip", "install", "pywin32", "-q"])
    import win32com.client

app = win32com.client.Dispatch("PowerPoint.Application")
app.Visible = 1
pres = app.Presentations.Open(str(pptx.resolve()), WithWindow=False)
for i in range(1, pres.Slides.Count + 1):
    path = str((out_dir / f"slide{i}.png").resolve())
    pres.Slides(i).Export(path, "PNG", 1280, 720)
    print(path)
pres.Close()
app.Quit()
