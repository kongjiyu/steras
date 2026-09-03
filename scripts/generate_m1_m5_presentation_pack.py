#!/usr/bin/env python3
"""Generate the presentation handout and production E2E evidence report."""

from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf"
SCREENSHOTS = ROOT / "output" / "playwright" / "production-m1-m5"

INK = colors.HexColor("#17231B")
GREEN = colors.HexColor("#26451F")
OLIVE = colors.HexColor("#587024")
GOLD = colors.HexColor("#C79A24")
CREAM = colors.HexColor("#F6F1E7")
PALE = colors.HexColor("#EEF3E8")
MUTED = colors.HexColor("#5D685F")


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="TitleGreen", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=28, leading=32, textColor=GREEN, spaceAfter=8))
styles.add(ParagraphStyle(name="Subtitle", parent=styles["Normal"], fontName="Helvetica", fontSize=13, leading=18, textColor=MUTED, spaceAfter=12))
styles.add(ParagraphStyle(name="Section", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=19, leading=23, textColor=GREEN, spaceAfter=8))
styles.add(ParagraphStyle(name="Subsection", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12, leading=16, textColor=INK, spaceBefore=6, spaceAfter=4))
styles.add(ParagraphStyle(name="BodySteras", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.5, leading=14, textColor=INK, spaceAfter=6))
styles.add(ParagraphStyle(name="SmallSteras", parent=styles["BodyText"], fontName="Helvetica", fontSize=7.8, leading=11, textColor=MUTED))
styles.add(ParagraphStyle(name="Kicker", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8, leading=10, tracking=1.2, textColor=GOLD, spaceAfter=4))
styles.add(ParagraphStyle(name="CenterSmall", parent=styles["SmallSteras"], alignment=TA_CENTER))


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#DDD4C3"))
    canvas.line(18 * mm, 12 * mm, doc.pagesize[0] - 18 * mm, 12 * mm)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 7.5 * mm, "STERAS · M1–M5 production demonstration")
    canvas.drawRightString(doc.pagesize[0] - 18 * mm, 7.5 * mm, f"Page {doc.page}")
    canvas.restoreState()


def p(text: str, style: str = "BodySteras") -> Paragraph:
    return Paragraph(text, styles[style])


def bullet(text: str) -> Paragraph:
    return Paragraph(f"• {text}", ParagraphStyle(name=f"bullet-{hash(text)}", parent=styles["BodySteras"], leftIndent=10, firstLineIndent=-7, spaceAfter=4))


def screenshot(path: Path, max_width: float, max_height: float) -> Image:
    image = Image(str(path))
    scale = min(max_width / image.imageWidth, max_height / image.imageHeight)
    image.drawWidth = image.imageWidth * scale
    image.drawHeight = image.imageHeight * scale
    image.hAlign = "CENTER"
    return image


def table(data, widths, header=True):
    result = Table(data, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    commands = [
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("BACKGROUND", (0, 0), (-1, 0), GREEN),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("LEADING", (0, 0), (-1, -1), 11),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#D4CCBD")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, CREAM]),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    result.setStyle(TableStyle(commands))
    return result


def build_presentation():
    path = OUTPUT / "STERAS_M1_M5_Presentation_Pack.pdf"
    doc = SimpleDocTemplate(str(path), pagesize=landscape(A4), rightMargin=18 * mm, leftMargin=18 * mm, topMargin=16 * mm, bottomMargin=18 * mm, title="STERAS M1–M5 Presentation Pack")
    story = [
        Spacer(1, 18 * mm),
        p("PRODUCTION DEMONSTRATION", "Kicker"),
        p("STERAS M1–M5<br/>End-to-End Scenario", "TitleGreen"),
        p("Malaysia Tourism Storytelling Showcase 2026 · KLCC Convention Centre · 600 attendees", "Subtitle"),
        Spacer(1, 5 * mm),
        table([
            ["Application", "Assessment", "Decision", "Controls", "Analytics"],
            ["v1 submitted", "28 / Medium", "Approved", "3 public · 1 resubmit", "Complete coverage"],
        ], [45 * mm] * 5),
        Spacer(1, 8 * mm),
        p("This pack records a realistic fictitious demonstration. It is not evidence of a real permit or government approval.", "SmallSteras"),
        PageBreak(),
        p("THE STORY", "Kicker"),
        p("One record, five connected modules", "Section"),
        table([
            ["Module", "What happens", "What to show"],
            ["M1", "Choose scenario, upload combined application, extract, verify, submit", "Template recommendation, 100% extraction, 18/18 evidence"],
            ["M2", "Acquire context, ask MiniMax, validate, apply hard rules, calculate resources", "Eight categories, weather evidence, official 28 / Medium, seven resources"],
            ["M3", "Admin review, officer assignment, score review, final approval, controls", "Four authorities, unanimous approval, 13 verified Stage 1 documents"],
            ["M4", "Report, assess, respond, resolve", "MiniMax incident assessment and append-only response history"],
            ["M5", "Read latest valid records into privacy-safe reports", "Complete source coverage, report cards, export controls"],
        ], [24 * mm, 103 * mm, 103 * mm]),
        Spacer(1, 7 * mm),
        p("Presenter line", "Subsection"),
        p("“STERAS does not treat AI output as the decision. AI proposes; validated rules, authority review, immutable records and Admin approval form the auditable decision chain.”"),
    ]

    slide_specs = [
        ("M1", "Structured application and evidence", "m1-complete-draft.png", [
            "Core + scenario documents are accepted as one combined PDF.",
            "The organiser reviews extracted fields and corrects suspicious or missing values.",
            "Canonical venue binding and evidence ownership are checked before submission.",
        ]),
        ("M2", "Official AI-assisted assessment", "m2-official-assessment.png", [
            "MiniMax-M3 returned all eight numeric category proposals.",
            "OpenWeather supplied a fresh measured snapshot; no placeholder weather was used.",
            "Human reviews and deterministic hard rules produced the official result: 28 / Medium.",
        ]),
        ("M2", "Deterministic resource recommendation", "m2-official-resources.png", [
            "Seven canonical resources are derived from the finalized risk input.",
            "Each result retains baseline, range, assumptions, rules and source provenance.",
            "The UI clearly states that numeric ratios are internal prototype guidance.",
        ]),
        ("M3", "Admin approval with independent officer records", "m3-final-approved.png", [
            "PDRM, BOMBA, KKM and DBKL each reviewed all eight categories.",
            "Officer records are recommendations; Admin second review owns the final decision.",
            "The public event projection is created only after final approval.",
        ]),
        ("M3", "Published event-control checklist", "m3-control-list-published.png", [
            "MiniMax proposed one control for every required authority.",
            "Admin explicitly committed the four-item list.",
            "Thirteen Stage 1 documents were submitted and independently verified.",
        ]),
        ("M4", "Incident response and traceable resolution", "m4-incident-resolved.png", [
            "A public Stage 2 discrepancy becomes a current-version M4 incident.",
            "MiniMax classifies severity and immediate-action need.",
            "Resolution retains append-only history, withdraws the bad public image and requires resubmission.",
        ]),
        ("M5", "Privacy-safe operational analytics", "m5-analytics-final.png", [
            "Only latest valid records enter the portfolio.",
            "Source coverage is complete and warnings are empty for this scenario.",
            "Private narratives, evidence paths, contact details and internal notes stay out of reports.",
        ]),
    ]
    for module, title, filename, bullets in slide_specs:
        source = SCREENSHOTS / filename
        if not source.exists():
            continue
        story.extend([
            PageBreak(), p(f"{module} · LIVE PRODUCTION", "Kicker"), p(title, "Section"),
            screenshot(source, 245 * mm, 125 * mm), Spacer(1, 4 * mm),
            Table([[bullet(item) for item in bullets]], colWidths=[78 * mm] * 3, style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")])),
        ])

    story.extend([
        PageBreak(), p("RESULT", "Kicker"), p("What the demonstration proves", "Section"),
        table([
            ["Boundary", "Verified result"],
            ["Input integrity", "Version-owned documents, canonical venue identity and complete all-hazards declarations"],
            ["AI safety", "Invalid/unavailable output fails closed; accepted proposals retain model and schema provenance"],
            ["Determinism", "Hard-rule floors, weighted scoring and resource calculations reproduce from stored inputs"],
            ["Human authority", "Append-only reviews and Admin final decision remain distinct from AI proposals"],
            ["Privacy", "Organizer/public projections exclude internal rationale, restricted evidence and personal data"],
            ["Operations", "M4 history and M5 analytics connect to the same current immutable event generation"],
        ], [55 * mm, 177 * mm]),
        Spacer(1, 7 * mm),
        p("Live URL", "Subsection"),
        p("https://linkos-496505.web.app"),
        p("Application ID", "Subsection"),
        p("iTpN6WjUEKtgQFWEliE1"),
    ])
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return path


def build_evidence():
    path = OUTPUT / "STERAS_M1_M5_E2E_Evidence.pdf"
    doc = SimpleDocTemplate(str(path), pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm, topMargin=16 * mm, bottomMargin=18 * mm, title="STERAS M1–M5 Production E2E Evidence")
    checkpoints = [
        ["M1", "Combined application extraction", "PASS · 12 fields · 100%"],
        ["M1", "Evidence and canonical venue", "PASS · 18/18 · KLCC active"],
        ["M2", "OpenWeather context", "PASS · available · fresh"],
        ["M2", "MiniMax proposal", "PASS · 8 unique categories"],
        ["M2", "Official assessment/resource", "PASS · 28 Medium · 7 resources"],
        ["M3", "Authority score review", "PASS · 4 active review heads"],
        ["M3", "Application decision", "PASS · 4 officer approvals · Admin Approved"],
        ["M3", "Controls and evidence", "PASS · 4 controls · 13/13 Stage 1 · 4 Stage 2"],
        ["M4", "Incident assessment and resolution", "PASS · MiniMax · resolved"],
            ["M5", "Analytics", "PASS · 1 verified High incident · complete coverage"],
    ]
    story = [
        p("PRODUCTION EVIDENCE", "Kicker"), p("STERAS M1–M5 End-to-End Verification", "TitleGreen"),
        p("Firebase project linkos-496505 · Application iTpN6WjUEKtgQFWEliE1 · Version v1", "Subtitle"),
        table([["Module", "Checkpoint", "Production result"], *checkpoints], [18 * mm, 78 * mm, 78 * mm]),
        Spacer(1, 7 * mm),
        p("Issue found and corrected", "Section"),
        p("A new Draft’s Firestore document ID was not persisted as <b>EventRecord.eventId</b>. Provisional processing used the trigger parameter and succeeded, while official resource finalisation correctly rejected the missing source identity as <b>missing_input</b>. No partial official output was published."),
        bullet("The client now generates the document reference first and persists its exact ID."),
        bullet("Firestore rules require eventId to equal the document path and reject missing or spoofed IDs."),
        bullet("The submit boundary self-heals older Draft records."),
        bullet("The same append-only review state was retried idempotently and finalized successfully."),
        p("A second adversarial check found that M3 could previously create a public discrepancy ticket before the M4 event window opened. M3 and M4 now share one reportable-event guard, preventing orphaned report locks."),
        bullet("A production pre-event request was rejected and created no report ticket."),
        bullet("The successful M4 evidence below was created only after the event began."),
        Spacer(1, 5 * mm),
        p("Data hygiene and recovery", "Section"),
        bullet("Managed Firestore recovery export completed before destructive cleanup."),
        bullet("Obsolete fixture events, legacy incidents, test accounts and orphaned Storage objects were removed."),
        bullet("Deleted Storage objects were copied to a restricted backup prefix and verified before removal."),
        bullet("The final analytics portfolio contains one current non-synthetic demonstration application."),
        Spacer(1, 5 * mm),
        p("External services exercised", "Section"),
        table([
            ["Service", "Observed production result"],
            ["MiniMax M2", "MiniMax-M3 · v5.0.0-prd-numeric-proposal · success"],
            ["MiniMax M3", "MiniMax-M3 · v1.0.0-m3-control-list · success"],
            ["MiniMax M4", "Incident assessment success with validated severity output"],
            ["OpenWeather", "Available/fresh numeric measurement snapshot"],
        ], [42 * mm, 132 * mm]),
        Spacer(1, 5 * mm),
        p("Repository gate", "Section"),
        p("Typecheck, lint, frontend unit tests, Functions unit tests, Firestore/Storage rule tests and production build all passed. Exact counts are retained in the accompanying Markdown report."),
        Spacer(1, 5 * mm),
        p("Scope note", "SmallSteras"),
        p("All scenario names and supporting documents are realistic fictitious demonstration records. Resource ratios remain explicitly labelled internal prototype/unverified; this report is not evidence of a government permit or statutory recommendation.", "SmallSteras"),
    ]
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return path


def build_presenter_card():
    path = OUTPUT / "STERAS_M1_M5_Presenter_Quick_Card.pdf"
    doc = SimpleDocTemplate(
        str(path), pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm,
        topMargin=16 * mm, bottomMargin=18 * mm,
        title="STERAS M1–M5 Presenter Quick Card",
    )
    story = [
        p("PRESENTER QUICK CARD", "Kicker"),
        p("STERAS M1–M5 in 8 minutes", "TitleGreen"),
        p("Malaysia Tourism Storytelling Showcase 2026 · Application iTpN6WjUEKtgQFWEliE1", "Subtitle"),
        table([
            ["Time", "Screen", "One sentence to say"],
            [p("0:00", "SmallSteras"), p("Organizer application", "SmallSteras"), p("M1 turns two completed forms and supporting evidence into one reviewed, immutable application version.", "SmallSteras")],
            [p("1:30", "SmallSteras"), p("Official assessment", "SmallSteras"), p("M2 combines live context, MiniMax proposals, deterministic validation and four append-only authority reviews.", "SmallSteras")],
            [p("3:15", "SmallSteras"), p("Official resources", "SmallSteras"), p("Seven planning quantities are reproducible and clearly labelled as internal prototype guidance.", "SmallSteras")],
            [p("4:15", "SmallSteras"), p("Admin application", "SmallSteras"), p("M3 keeps officer recommendations separate from the Admin second-review decision and publication boundary.", "SmallSteras")],
            [p("5:30", "SmallSteras"), p("Event controls", "SmallSteras"), p("Four authority controls connect verified plans to sanitized public on-site evidence.", "SmallSteras")],
            [p("6:30", "SmallSteras"), p("Incident", "SmallSteras"), p("M4 converts a public discrepancy into an assessed, assigned, responded-to and resolved record.", "SmallSteras")],
            [p("7:30", "SmallSteras"), p("Reports", "SmallSteras"), p("M5 reads the latest valid records into privacy-safe analytics with explicit source coverage.", "SmallSteras")],
        ], [18 * mm, 42 * mm, 114 * mm]),
        Spacer(1, 7 * mm),
        p("Numbers worth remembering", "Section"),
        table([
            ["Application", "Risk", "Review", "Controls", "Analytics"],
            [
                p("12 fields · 18/18 evidence", "SmallSteras"),
                p("28 · Medium · 7 resources", "SmallSteras"),
                p("4 authorities", "SmallSteras"),
                p("13 Stage 1 · 3 public Stage 2", "SmallSteras"),
                p("Complete coverage", "SmallSteras"),
            ],
        ], [35 * mm] * 5),
        Spacer(1, 7 * mm),
        p("Safe phrasing", "Section"),
        bullet("Say “AI-assisted proposal”, not “AI approval”."),
        bullet("Say “official risk result”, not “authority-validated resource ratios”."),
        bullet("Say “real production flow with fictitious demonstration data”, not “real government permit”."),
        bullet("If live navigation is slow, use the presentation pack screenshots and keep the same application ID visible."),
        Spacer(1, 5 * mm),
        p("Production URL", "Subsection"),
        p("https://linkos-496505.web.app"),
    ]
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return path


if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    print(build_presentation())
    print(build_evidence())
    print(build_presenter_card())
