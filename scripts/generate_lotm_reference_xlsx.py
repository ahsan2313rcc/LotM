"""
Generate a formatted LoTM Tarot reference workbook:
  - Pathways Overview (playstyle + chaos)
  - Sequence Abilities (S9→S1, acting requirements)
  - Chaos Events (X0–X21)
"""
from __future__ import annotations

import json
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

ROOT = Path(__file__).resolve().parents[1]
JSON_PATH = ROOT / "data" / "pathways_export.json"
OUT_PATH = ROOT / "data" / "LoTM_Tarot_Pathways_Abilities_Chaos.xlsx"

THIN = Border(
    left=Side(style="thin", color="CBD5E1"),
    right=Side(style="thin", color="CBD5E1"),
    top=Side(style="thin", color="CBD5E1"),
    bottom=Side(style="thin", color="CBD5E1"),
)

HEADER_FILL = PatternFill("solid", fgColor="1E293B")
HEADER_FONT = Font(name="Calibri", bold=True, color="F8FAFC", size=11)
TITLE_FONT = Font(name="Calibri", bold=True, color="0F172A", size=16)
SUB_FONT = Font(name="Calibri", color="475569", size=10, italic=True)
BODY_FONT = Font(name="Calibri", size=10, color="0F172A")
WRAP = Alignment(wrap_text=True, vertical="top")
CENTER = Alignment(wrap_text=True, vertical="center", horizontal="center")

# Soft alternating fills by pathway id (stable pastel rotation)
ROW_FILLS = [
    PatternFill("solid", fgColor="F8FAFC"),
    PatternFill("solid", fgColor="EEF2FF"),
    PatternFill("solid", fgColor="ECFDF5"),
    PatternFill("solid", fgColor="FFF7ED"),
    PatternFill("solid", fgColor="FDF2F8"),
    PatternFill("solid", fgColor="F0F9FF"),
]


def style_header(ws, row: int, cols: int):
    for c in range(1, cols + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
        cell.border = THIN


def autosize(ws, widths: dict[int, float]):
    for col, w in widths.items():
        ws.column_dimensions[get_column_letter(col)].width = w


def freeze_and_filter(ws, header_row: int = 3):
    ws.freeze_panes = f"A{header_row + 1}"
    ws.auto_filter.ref = ws.dimensions


def add_title(ws, title: str, subtitle: str, cols: int):
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=cols)
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=cols)
    t = ws.cell(1, 1, title)
    t.font = TITLE_FONT
    t.alignment = Alignment(vertical="center")
    s = ws.cell(2, 1, subtitle)
    s.font = SUB_FONT
    ws.row_dimensions[1].height = 24
    ws.row_dimensions[2].height = 18


def build():
    pathways = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    wb = Workbook()

    # ── Sheet 1: Pathways Overview ─────────────────────────────────────
    ws1 = wb.active
    ws1.title = "Pathways Overview"
    cols1 = [
        "X#", "Roman", "Major Arcana", "LoTM Pathway", "Primary Lever",
        "Playstyle", "Chaos Timing", "Chaos Event"
    ]
    add_title(
        ws1,
        "Lord of the Mysteries Tarot — Pathways Overview",
        "Playstyle focus + Major Arcana Chaos Event for each pathway (source: src/data/constants.js)",
        len(cols1),
    )
    for i, h in enumerate(cols1, 1):
        ws1.cell(3, i, h)
    style_header(ws1, 3, len(cols1))

    for r, p in enumerate(pathways, 4):
        fill = ROW_FILLS[p["id"] % len(ROW_FILLS)]
        vals = [
            f"X{p['id']}",
            p["roman"],
            p["arcana"],
            p["lotm"],
            p["lever"],
            p["playstyle"],
            p["chaosTiming"],
            p["chaosDesc"],
        ]
        for c, v in enumerate(vals, 1):
            cell = ws1.cell(r, c, v)
            cell.font = BODY_FONT
            cell.border = THIN
            cell.fill = fill
            cell.alignment = CENTER if c in (1, 2, 7) else WRAP
        ws1.row_dimensions[r].height = 48

    autosize(ws1, {1: 6, 2: 8, 3: 18, 4: 22, 5: 24, 6: 55, 7: 12, 8: 62})
    freeze_and_filter(ws1)
    ws1.auto_filter.ref = f"A3:H{3 + len(pathways)}"

    # ── Sheet 2: Sequence Abilities ────────────────────────────────────
    ws2 = wb.create_sheet("Sequence Abilities")
    cols2 = [
        "X#", "Arcana", "Pathway", "Seq", "Sequence Name",
        "Ability Effect", "Acting / Digestion Requirement", "Engine Tag", "Playstyle"
    ]
    add_title(
        ws2,
        "Sequence Abilities (S9 → S1) & Acting Requirements",
        "Acting column = Digestion / advancement requirement to unlock next sequence progression pressure",
        len(cols2),
    )
    for i, h in enumerate(cols2, 1):
        ws2.cell(3, i, h)
    style_header(ws2, 3, len(cols2))

    row = 4
    for p in pathways:
        fill = ROW_FILLS[p["id"] % len(ROW_FILLS)]
        for seq in p["sequences"]:
            vals = [
                f"X{p['id']}",
                p["arcana"],
                p["lotm"],
                seq["sequence"],
                seq["name"],
                seq["ability"],
                seq["actingRequirement"],
                seq["tag"],
                p["playstyle"],
            ]
            for c, v in enumerate(vals, 1):
                cell = ws2.cell(row, c, v)
                cell.font = BODY_FONT
                cell.border = THIN
                cell.fill = fill
                cell.alignment = CENTER if c in (1, 4) else WRAP
            ws2.row_dimensions[row].height = 42
            row += 1

    last = row - 1
    autosize(ws2, {1: 6, 2: 18, 3: 22, 4: 6, 5: 22, 6: 58, 7: 42, 8: 22, 9: 40})
    ws2.freeze_panes = "A4"
    ws2.auto_filter.ref = f"A3:I{last}"

    # ── Sheet 3: Chaos Events ──────────────────────────────────────────
    ws3 = wb.create_sheet("Chaos Events")
    cols3 = [
        "Major ID", "Roman", "Arcana Card", "Linked Pathway", "LoTM Name",
        "Timing", "Chaos Effect", "Grave Recycle Hint", "Playstyle"
    ]
    add_title(
        ws3,
        "Major Arcana Chaos Events (X0–X21)",
        "Playing a Major as Chaos Instant / Trick Major triggers its event, then Grave Recycle of X cards (X = Major ID) unless skipRecycle",
        len(cols3),
    )
    for i, h in enumerate(cols3, 1):
        ws3.cell(3, i, h)
    style_header(ws3, 3, len(cols3))

    for r, p in enumerate(pathways, 4):
        fill = ROW_FILLS[p["id"] % len(ROW_FILLS)]
        recycle = (
            "0 — Fool recycles none beyond the Major itself"
            if p["id"] == 0
            else f"Recycle top {p['id']} Grave card(s) with the Major into the Deck"
        )
        vals = [
            p["id"],
            p["roman"],
            p["arcana"],
            p["lotm"],
            p["lotm"].split("(")[0].strip() if "(" in p["lotm"] else p["lotm"],
            p["chaosTiming"],
            p["chaosDesc"],
            recycle,
            p["playstyle"],
        ]
        for c, v in enumerate(vals, 1):
            cell = ws3.cell(r, c, v)
            cell.font = BODY_FONT
            cell.border = THIN
            cell.fill = fill
            cell.alignment = CENTER if c in (1, 2, 6) else WRAP
        ws3.row_dimensions[r].height = 48

    autosize(ws3, {1: 10, 2: 8, 3: 18, 4: 22, 5: 16, 6: 12, 7: 62, 8: 42, 9: 40})
    freeze_and_filter(ws3)
    ws3.auto_filter.ref = f"A3:I{3 + len(pathways)}"

    # ── Sheet 4: Quick Matrix (pathway × seq name) ─────────────────────
    ws4 = wb.create_sheet("Sequence Matrix")
    headers = ["X#", "Arcana", "Pathway", "Playstyle"] + [f"S{s}" for s in range(9, 0, -1)]
    add_title(
        ws4,
        "Sequence Name Matrix",
        "At-a-glance Sequence titles per pathway (S9 → S1)",
        len(headers),
    )
    for i, h in enumerate(headers, 1):
        ws4.cell(3, i, h)
    style_header(ws4, 3, len(headers))

    for r, p in enumerate(pathways, 4):
        fill = ROW_FILLS[p["id"] % len(ROW_FILLS)]
        vals = [f"X{p['id']}", p["arcana"], p["lotm"], p["playstyle"]]
        vals += [next(s["name"] for s in p["sequences"] if s["sequence"] == seq) for seq in range(9, 0, -1)]
        for c, v in enumerate(vals, 1):
            cell = ws4.cell(r, c, v)
            cell.font = BODY_FONT
            cell.border = THIN
            cell.fill = fill
            cell.alignment = CENTER if c == 1 or c >= 5 else WRAP
        ws4.row_dimensions[r].height = 36

    widths = {1: 6, 2: 18, 3: 22, 4: 42}
    for i in range(5, 14):
        widths[i] = 16
    autosize(ws4, widths)
    ws4.freeze_panes = "E4"
    ws4.auto_filter.ref = f"A3:M{3 + len(pathways)}"

    # ── Sheet 5: Legend ────────────────────────────────────────────────
    ws5 = wb.create_sheet("Legend")
    add_title(ws5, "How to read this workbook", "Rules mirror the live browser game data", 2)
    legend = [
        ("Pathways Overview", "One row per Major Arcana / LoTM pathway with playstyle and Chaos Event."),
        ("Sequence Abilities", "All 198 sequence rows (22 pathways × 9 sequences). Ability = effect; Acting = digestion requirement."),
        ("Chaos Events", "What happens when you play that Major as a Chaos Instant / Trick Major."),
        ("Sequence Matrix", "Compact name grid for quick comparison."),
        ("Timing: Anytime", "Chaos can be cast as an Instant outside the trick play."),
        ("Timing: Trick", "Chaos resolves when the Major is played as your trick card."),
        ("Acting / Digestion", "Condition that digests (acts) the Sequence so Ascension discards 0 instead of 3."),
        ("Grave Recycle", "After Chaos, the Major + up to X top Grave cards are shuffled into the Deck (X = Major ID)."),
        ("Engine Tag", "Internal ability tag used by headless / engineCore.js."),
    ]
    ws5.cell(3, 1, "Topic").font = HEADER_FONT
    ws5.cell(3, 2, "Meaning").font = HEADER_FONT
    ws5.cell(3, 1).fill = HEADER_FILL
    ws5.cell(3, 2).fill = HEADER_FILL
    for i, (k, v) in enumerate(legend, 4):
        ws5.cell(i, 1, k).font = Font(name="Calibri", bold=True, size=10)
        ws5.cell(i, 2, v).font = BODY_FONT
        ws5.cell(i, 1).alignment = WRAP
        ws5.cell(i, 2).alignment = WRAP
        ws5.cell(i, 1).border = THIN
        ws5.cell(i, 2).border = THIN
        ws5.row_dimensions[i].height = 28
    autosize(ws5, {1: 22, 2: 90})

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT_PATH)
    print(f"Wrote {OUT_PATH}")
    print(f"  Pathways: {len(pathways)}")
    print(f"  Sequence rows: {sum(len(p['sequences']) for p in pathways)}")


if __name__ == "__main__":
    build()
