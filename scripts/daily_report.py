"""
Daily Build Report Generator for Polytechnic Resources
Queries Supabase for previous day's scans, generates Excel report, emails to recipients.

Usage:
    python daily_report.py                  # Uses yesterday's date
    python daily_report.py 2025-12-17       # Specific date
    python daily_report.py --test           # Test mode (prints output, no email)
"""

import os
import sys
import re
from datetime import datetime, timedelta
from collections import defaultdict
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email.mime.text import MIMEText
from email import encoders
import tempfile

# Third-party imports
try:
    from supabase import create_client, Client
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Run: pip install supabase openpyxl")
    sys.exit(1)

# Optional: Google Sheets backup (gspread)
try:
    import gspread
    from google.oauth2.service_account import Credentials

    GSPREAD_AVAILABLE = True
except ImportError:
    GSPREAD_AVAILABLE = False
    print("[WARN] gspread not installed - Google Sheets backup disabled")

# ============================================
# CONFIGURATION (from environment variables)
# ============================================

# Supabase
SUPABASE_URL = os.environ.get(
    "SUPABASE_URL", "https://ospedluufxgpfvqtznej.supabase.co"
)
SUPABASE_KEY = os.environ.get(
    "SUPABASE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zcGVkbHV1ZnhncGZ2cXR6bmVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5ODgyMTUsImV4cCI6MjA4MTU2NDIxNX0.1AhtuANYs-eVrQIdW9gqt_KLhBxF4Vm0j6pqtrrJAag",
)

# Email Configuration
SMTP_SERVER = os.environ.get("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_EMAIL = os.environ.get("SMTP_EMAIL", "polytechnicresources.dev@gmail.com")
SMTP_PASSWORD = os.environ.get(
    "SMTP_PASSWORD", "jppg ytea oqzc lsdn"
)  # Gmail App Password

# Recipients (comma-separated in a single string)
REPORT_RECIPIENTS = os.environ.get(
    "REPORT_RECIPIENTS", "eric@polytechres.com, ksilesky1@verizon.net, krogers.pri@gmail.com"
)

# Report settings
PIECES_PER_BOX = int(os.environ.get("PIECES_PER_BOX", "100"))

# Google Sheets Backup Configuration
# GSHEET_CREDENTIALS_JSON: Base64-encoded service account JSON (from GitHub Secret)
# GSHEET_SPREADSHEET_ID: The ID from the Google Sheet URL
GSHEET_CREDENTIALS_JSON = os.environ.get("GSHEET_CREDENTIALS_JSON", "")
GSHEET_SPREADSHEET_ID = os.environ.get("GSHEET_SPREADSHEET_ID", "")
GSHEET_ENABLED = bool(
    GSHEET_CREDENTIALS_JSON and GSHEET_SPREADSHEET_ID and GSPREAD_AVAILABLE
)


def get_supabase_client() -> Client:
    """Initialize Supabase client"""
    if not SUPABASE_KEY:
        raise ValueError("SUPABASE_KEY environment variable not set")
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def fetch_scans_for_date(supabase: Client, target_date: datetime) -> list:
    """
    Fetch all scans for a specific date (in EST/Eastern Time).
    Supabase stores timestamps in UTC, so we need to convert.
    """
    # Calculate UTC range for the target EST date
    # EST is UTC-5, so midnight EST = 5:00 AM UTC
    start_utc = target_date.replace(hour=5, minute=0, second=0, microsecond=0)
    end_utc = start_utc + timedelta(days=1)

    start_str = start_utc.strftime("%Y-%m-%dT%H:%M:%S+00:00")
    end_str = end_utc.strftime("%Y-%m-%dT%H:%M:%S+00:00")

    print(f"[INFO] Fetching scans from {start_str} to {end_str}")

    response = (
        supabase.table("scans")
        .select("*")
        .gte("created_at", start_str)
        .lt("created_at", end_str)
        .order("operator_name")
        .order("station_id")
        .order("part_id")
        .execute()
    )

    return response.data if response.data else []


def format_serial_ranges(serials: list) -> str:
    """
    Convert a list of serial numbers into formatted ranges.
    Uses '-' for consecutive sequences, '/' for breaks.
    Example: ['MGCK173156', 'MGCK173157', 'MGCK173158', 'MGCK173170']
             -> 'MGCK173156-173158 / MGCK173170'
    """
    if not serials:
        return ""

    # Sort serials
    serials = sorted(set(serials))

    if len(serials) == 1:
        return serials[0]

    def extract_prefix_and_num(serial):
        """
        Extract prefix and trailing numeric portion.
        'PUL9000K29498' -> ('PUL9000K', 29498)
        'MGCK173156' -> ('MGCK', 173156)
        """
        import re

        # Find trailing digits
        match = re.match(r"^(.+?)(\d+)$", serial)
        if match:
            prefix = match.group(1)
            num = int(match.group(2))
            return prefix, num
        return serial, None

    # Build ranges
    ranges = []
    current_prefix = None
    current_start = None
    current_end = None

    for serial in serials:
        prefix, num = extract_prefix_and_num(serial)

        if num is None:
            # No numeric portion, output current range and add this as-is
            if current_start is not None:
                ranges.append(format_range(current_prefix, current_start, current_end))
                current_start = None
            ranges.append(serial)
            continue

        if current_start is None:
            # Start new range
            current_prefix = prefix
            current_start = num
            current_end = num
        elif prefix == current_prefix and num == current_end + 1:
            # Extend current range (consecutive)
            current_end = num
        else:
            # End current range, start new one
            ranges.append(format_range(current_prefix, current_start, current_end))
            current_prefix = prefix
            current_start = num
            current_end = num

    # Don't forget the last range
    if current_start is not None:
        ranges.append(format_range(current_prefix, current_start, current_end))

    return " / ".join(ranges)


def format_range(prefix: str, start: int, end: int) -> str:
    """Format a range like 'MGCK173156-173158' or 'MGCK173156' if single"""
    if start == end:
        return f"{prefix}{start}"
    else:
        return f"{prefix}{start}-{end}"


def extract_serial_header(serial: str) -> str:
    """
    Extract serial header prefix (everything before trailing digits).
    'MGCK173156' -> 'MGCK1' (keeps 'MGCK1', drops '73156')
    'MGC2C12345' -> 'MGC2C'
    'MGC290527' -> 'MGC2' (6 digits)
    'MGC2900594' -> 'MGC2' (7 digits)
    'R756EL11984' -> 'R756EL' (5 digits)
    'R756EL111984' -> 'R756EL' (6 digits)
    Handles edge cases like ranges stored as single values.
    """
    if not serial:
        return "UNKNOWN"

    # If serial contains a hyphen (range stored as single value), use first part
    target = serial.split("-")[0]

    if len(target) <= 5:
        return target or "UNKNOWN"

    # Special handling for MGC serials with S/C suffix: extract header before the trailing 5+ digits
    # MGC formats: MGC + digits/K + S/C + 5+ digits
    # Examples: MGC1S17775, MGC2C20297, MGCK1S58198, MGC2S104310
    mgc_match = re.match(r"^(MGC[0-9K]*[SC])(\d{5,})$", target, re.IGNORECASE)
    if mgc_match:
        return mgc_match.group(1)  # Return everything before the trailing 5+ digits

    # Special handling for MGC serials WITHOUT S/C suffix (e.g., MGC290527, MGC2900594)
    # Pattern: MGC + optional K + single digit + 5+ trailing digits
    # Examples: MGC290527 -> MGC2, MGC2900594 -> MGC2, MGCK173156 -> MGCK1
    mgc_no_suffix_match = re.match(r"^(MGCK?\d)(\d{5,})$", target, re.IGNORECASE)
    if mgc_no_suffix_match:
        return mgc_no_suffix_match.group(1)  # Return MGC + optional K + single digit

    # General pattern: Extract prefix before trailing 5+ digits
    # This handles cases like:
    #   - R756EL11984 (5 digits) -> R756EL
    #   - R756EL111984 (6 digits) -> R756EL
    #   - R757ELMSN102345 (6 digits) -> R757ELMSN
    general_match = re.match(r"^(.+?)(\d{5,})$", target)
    if general_match:
        return general_match.group(1)  # Return prefix before trailing digits

    # Fallback: return as-is if no pattern matches
    return target


def apply_part_number_variant(part: str, serials: list) -> str:
    """
    Apply part number transformations based on serial headers and part patterns.

    Rules:
    1. Part ID 100760: Add space between "100" and "760"
       Example: '100760' -> '100 760'

    2. PFR prefix: Add '301-' prefix to all part numbers starting with 'PFR'
       Example: 'PFR60W' -> '301-PFR60W'

    3. MGC variant suffixes: For part numbers starting with '536', append suffix
       based on serial header pattern (everything before last 5 digits):
       - Pattern: MGC + any chars + S/C at end
       - Examples:
         * MGC1S17775 (header: MGC1S) -> append 'S' -> '536713-001S'
         * MGC2C10800 (header: MGC2C) -> append 'C' -> '536713-002C'
         * MGC4C93025 (header: MGC4C) -> append 'C' -> '536713-004C'
         * MGCK1S58198 (header: MGCK1S) -> append 'S' -> '536719-001S'
         * MGCK2S14399 (header: MGCK2S) -> append 'S' -> '536723-001S'
       - Ignores first 3 chars "MGC", looks for S or C at end of header

    Args:
        part: Original part number
        serials: List of serial numbers associated with this part

    Returns:
        Transformed part number string
    """
    if not part or not serials:
        return part

    # Rule 1: Format 100760 as "100 760" (add space)
    if part == "100760":
        part = "100 760"

    # Rule 2: Add 301- prefix to PFR parts
    if part.startswith("PFR"):
        part = f"301-{part}"

    # Rule 3: Add MGC variant suffix based on serial header pattern
    # Checks if ANY serial starts with "MGC" and has S/C in header (ignoring first 3 chars)
    # Examples:
    #   - MGC1S17775 (header: MGC1S) -> append 'S' -> '536713-001S'
    #   - MGC2C10800 (header: MGC2C) -> append 'C' -> '536713-002C'
    #   - MGCK1S58198 (header: MGCK1S) -> append 'S' -> '536719-001S'
    #   - MGCK2S14399 (header: MGCK2S) -> append 'S' -> '536723-001S'
    # Ignores first 3 chars "MGC", then looks for S or C at the end
    # This handles ALL parts with MGC serials (not just MGC part numbers)
    if not (part.endswith("S") or part.endswith("C")):
        # Check all serials to determine if any is MGC format
        if serials:
            for serial in serials:
                serial_str = str(serial)
                if serial_str.startswith("MGC"):
                    # Extract the serial header (everything before last 5 digits)
                    header = extract_serial_header(serial_str)

                    # Pattern: MGC + optional chars + (S or C) at the end
                    # This handles: MGC1S, MGC2S, MGC3C, MGC4C, MGCK1S, MGCK2S, etc.
                    # Ignore first 3 chars "MGC", then look for S or C at the end
                    match = re.search(r"^MGC.*(S|C)$", header, re.IGNORECASE)
                    if match:
                        suffix = match.group(1).upper()  # Extract S or C
                        part = f"{part}{suffix}"
                        break

    return part


def format_serial_numbers_only(serials: list) -> str:
    """
    Format serial numbers showing only the trailing numeric portions as ranges.
    'MGCK173156', 'MGCK173157', 'MGCK173158' -> '73156-73158'
    """
    if not serials:
        return ""

    # Extract just the last 5 digits from each serial
    numbers = []
    for serial in sorted(set(serials)):
        if serial and len(serial) > 5:
            try:
                num = int(serial[-5:])
                numbers.append(num)
            except ValueError:
                numbers.append(serial[-5:])  # Keep as string if not numeric
        else:
            numbers.append(serial)

    if not numbers:
        return ""

    # If all are integers, format as ranges
    if all(isinstance(n, int) for n in numbers):
        numbers = sorted(numbers)
        ranges = []
        start = numbers[0]
        end = numbers[0]

        for num in numbers[1:]:
            if num == end + 1:
                end = num
            else:
                if start == end:
                    ranges.append(str(start))
                else:
                    ranges.append(f"{start}-{end}")
                start = num
                end = num

        # Don't forget last range
        if start == end:
            ranges.append(str(start))
        else:
            ranges.append(f"{start}-{end}")

        return " / ".join(ranges)
    else:
        return " / ".join(str(n) for n in numbers)


def group_scans(scans: list) -> dict:
    """
    Group scans by Operator -> Station -> Part Number
    Returns nested dict with scan details
    """
    grouped = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))

    for scan in scans:
        operator = scan.get("operator_name") or "Unknown"
        station = scan.get("station_id") or "Unknown"
        part = scan.get("part_id") or "Unknown"
        serial = scan.get("serial_number") or ""

        grouped[operator][station][part].append(serial)

    return grouped


def generate_excel_report(
    grouped_data: dict, scans: list, report_date: datetime, filename: str = None
) -> str:
    """
    Generate Excel report matching Build_Report format.
    Returns path to Excel file.
    """
    wb = Workbook()
    ws = wb.active
    ws.title = f"Build Summary {report_date.strftime('%m-%d-%Y')}"

    # Styles
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(
        start_color="072549", end_color="072549", fill_type="solid"
    )
    border = Border(
        left=Side(style="thin"),
        right=Side(style="thin"),
        top=Side(style="thin"),
        bottom=Side(style="thin"),
    )
    center_align = Alignment(horizontal="center", vertical="center")
    wrap_align = Alignment(horizontal="left", vertical="center", wrap_text=True)
    alt_row_fill = PatternFill(
        start_color="F2F2F2", end_color="F2F2F2", fill_type="solid"
    )  # Light gray
    subtotal_fill = PatternFill(
        start_color="D9E8FB", end_color="D9E8FB", fill_type="solid"
    )  # Light blue
    subtotal_font = Font(bold=True)

    # Collect data for tables
    table_rows = []
    part_header_totals = defaultdict(
        lambda: defaultdict(lambda: {"scans": 0, "pieces": 0, "serials": []})
    )

    for operator in grouped_data:
        for station in grouped_data[operator]:
            for part in grouped_data[operator][station]:
                serials = grouped_data[operator][station][part]
                scan_count = len(serials)
                pieces = scan_count * PIECES_PER_BOX
                serial_ranges = format_serial_ranges(serials)

                # Apply part number transformations (PFR prefix, MGC variants)
                display_part = apply_part_number_variant(part, serials)

                table_rows.append(
                    {
                        "operator": operator,
                        "station": station,
                        "part": part,
                        "display_part": display_part,
                        "scan_count": scan_count,
                        "pieces": pieces,
                        "serial_ranges": serial_ranges,
                        "serials": serials,
                    }
                )

                # Track totals by part + serial header
                for serial in serials:
                    header = extract_serial_header(serial)
                    part_header_totals[part][header]["scans"] += 1
                    part_header_totals[part][header]["pieces"] += PIECES_PER_BOX
                    part_header_totals[part][header]["serials"].append(serial)

    # Sort by Part Number -> Operator -> Station
    table_rows.sort(key=lambda x: (x["part"], x["operator"], x["station"]))

    # ===== MAIN SHEET: Build Summary by Part & Serial Header =====
    # Section Header
    ws.cell(row=1, column=1, value="Build Summary by Part & Serial Header").font = Font(
        bold=True, size=12
    )

    # Column headers
    gt_headers = [
        "Part Number",
        "Total Scans (Boxes)",
        "Total Pieces",
        "Serial Header",
        "Serial Numbers Logged",
        "QB",
        "SS",
    ]
    row = 2
    for col, header in enumerate(gt_headers, 1):
        cell = ws.cell(row=row, column=col, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = border
    row += 1

    # Data rows with subtotals per part
    sorted_parts = sorted(part_header_totals.keys())
    row_counter = 0

    for part in sorted_parts:
        part_total_scans = 0
        part_total_pieces = 0
        headers_for_part = sorted(part_header_totals[part].keys())

        # Get all serials for this part (across all headers) for variant detection
        all_part_serials = []
        for h in headers_for_part:
            all_part_serials.extend(part_header_totals[part][h]["serials"])

        for header in headers_for_part:
            totals = part_header_totals[part][header]
            serial_ranges = format_serial_ranges(sorted(totals["serials"]))

            row_fill = alt_row_fill if row_counter % 2 == 1 else None

            # Apply part number transformations (PFR prefix, MGC variants)
            # Use only the serials for THIS header, not all headers for the part
            display_part = apply_part_number_variant(part, totals["serials"])

            cell_part = ws.cell(row=row, column=1, value=display_part)
            cell_part.border = border
            cell_part.alignment = center_align
            if row_fill:
                cell_part.fill = row_fill

            cell_scans = ws.cell(row=row, column=2, value=totals["scans"])
            cell_scans.border = border
            cell_scans.alignment = center_align
            if row_fill:
                cell_scans.fill = row_fill

            cell_pieces = ws.cell(row=row, column=3, value=totals["pieces"])
            cell_pieces.border = border
            cell_pieces.alignment = center_align
            if row_fill:
                cell_pieces.fill = row_fill

            cell_header = ws.cell(row=row, column=4, value=header)
            cell_header.border = border
            cell_header.alignment = center_align
            if row_fill:
                cell_header.fill = row_fill

            cell_serial = ws.cell(row=row, column=5, value=serial_ranges)
            cell_serial.border = border
            cell_serial.alignment = wrap_align
            if row_fill:
                cell_serial.fill = row_fill

            cell_qb = ws.cell(row=row, column=6, value="")
            cell_qb.border = border
            cell_qb.alignment = center_align
            if row_fill:
                cell_qb.fill = row_fill

            cell_ss = ws.cell(row=row, column=7, value="")
            cell_ss.border = border
            cell_ss.alignment = center_align
            if row_fill:
                cell_ss.fill = row_fill

            part_total_scans += totals["scans"]
            part_total_pieces += totals["pieces"]

            row += 1
            row_counter += 1

        # Subtotal row (only if more than one serial header type)
        if len(headers_for_part) > 1:
            cell_sub_part = ws.cell(row=row, column=1, value=f"{display_part} SUBTOTAL")
            cell_sub_part.border = border
            cell_sub_part.alignment = center_align
            cell_sub_part.fill = subtotal_fill
            cell_sub_part.font = subtotal_font

            cell_sub_scans = ws.cell(row=row, column=2, value=part_total_scans)
            cell_sub_scans.border = border
            cell_sub_scans.alignment = center_align
            cell_sub_scans.fill = subtotal_fill
            cell_sub_scans.font = subtotal_font

            cell_sub_pieces = ws.cell(row=row, column=3, value=part_total_pieces)
            cell_sub_pieces.border = border
            cell_sub_pieces.alignment = center_align
            cell_sub_pieces.fill = subtotal_fill
            cell_sub_pieces.font = subtotal_font

            for col in range(4, 8):
                cell = ws.cell(row=row, column=col, value="")
                cell.border = border
                cell.fill = subtotal_fill

            row += 1
            row_counter = 0

    # ===== OPERATOR BREAKDOWN TABLE (on main sheet, below Build Summary) =====
    row += 2

    # Operator breakdown header
    ws.cell(row=row, column=1, value="Operator Breakdown").font = Font(
        bold=True, size=12
    )
    row += 1

    # Column headers for operator breakdown
    op_breakdown_headers = [
        "Operator",
        "Station",
        "Part Number",
        "Total Pieces",
        "Serial Numbers Logged",
        "Context",
    ]
    for col, header in enumerate(op_breakdown_headers, 1):
        cell = ws.cell(row=row, column=col, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = border
    row += 1

    op_row_idx = 0
    for data in table_rows:
        row_fill = alt_row_fill if op_row_idx % 2 == 1 else None

        cell = ws.cell(row=row, column=1, value=data["operator"])
        cell.border = border
        cell.alignment = center_align
        if row_fill:
            cell.fill = row_fill

        cell = ws.cell(row=row, column=2, value=data["station"])
        cell.border = border
        cell.alignment = center_align
        if row_fill:
            cell.fill = row_fill

        cell = ws.cell(row=row, column=3, value=data["display_part"])
        cell.border = border
        cell.alignment = center_align
        if row_fill:
            cell.fill = row_fill

        cell = ws.cell(row=row, column=4, value=data["pieces"])
        cell.border = border
        cell.alignment = center_align
        if row_fill:
            cell.fill = row_fill

        cell_serial = ws.cell(row=row, column=5, value=data["serial_ranges"])
        cell_serial.border = border
        cell_serial.alignment = wrap_align
        if row_fill:
            cell_serial.fill = row_fill

        cell = ws.cell(row=row, column=6, value="")
        cell.border = border
        cell.alignment = center_align
        if row_fill:
            cell.fill = row_fill

        row += 1
        op_row_idx += 1

    # ===== GRAND TOTAL BY OPERATOR (on main sheet, below Operator Breakdown) =====
    row += 2

    # Calculate operator totals
    operator_totals = {}
    for scan in scans:
        op = scan.get("operator_name", "Unknown") or "Unknown"
        if op not in operator_totals:
            operator_totals[op] = {"scans": 0, "pieces": 0}
        operator_totals[op]["scans"] += 1
        operator_totals[op]["pieces"] += PIECES_PER_BOX

    # Operator totals header
    ws.cell(row=row, column=1, value="Grand Total by Operator").font = Font(
        bold=True, size=12
    )
    row += 1

    # Operator totals column headers
    op_tot_headers = ["Operator", "Total Scans (Boxes)", "Total Pieces"]
    for col, header in enumerate(op_tot_headers, 1):
        cell = ws.cell(row=row, column=col, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
        cell.border = border
    row += 1

    # Operator totals data with alternating shading
    op_tot_row_idx = 0
    for op in sorted(operator_totals.keys()):
        row_fill = alt_row_fill if op_tot_row_idx % 2 == 1 else None

        cell = ws.cell(row=row, column=1, value=op)
        cell.border = border
        cell.alignment = center_align
        if row_fill:
            cell.fill = row_fill

        cell = ws.cell(row=row, column=2, value=operator_totals[op]["scans"])
        cell.border = border
        cell.alignment = center_align
        if row_fill:
            cell.fill = row_fill

        cell = ws.cell(row=row, column=3, value=operator_totals[op]["pieces"])
        cell.border = border
        cell.alignment = center_align
        if row_fill:
            cell.fill = row_fill

        row += 1
        op_tot_row_idx += 1

    # Auto-adjust column widths for main sheet with max cap
    max_widths = {"A": 24, "B": 18, "C": 14, "D": 14, "E": 60, "F": 10, "G": 8}
    for col_letter, max_width in max_widths.items():
        content_width = 10
        for cell in ws[col_letter]:
            if cell.value:
                cell_len = len(str(cell.value))
                if cell_len > content_width:
                    content_width = cell_len
        ws.column_dimensions[col_letter].width = min(content_width + 2, max_width)

    # Print settings
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.page_margins.left = 0.5
    ws.page_margins.right = 0.5
    ws.page_margins.top = 0.75
    ws.page_margins.bottom = 0.75

    # ===== CREATE SUMMARY SHEET =====

    ws_summary = wb.create_sheet(title="Summary")

    # Title
    ws_summary.cell(
        row=1,
        column=1,
        value=f"Daily Build Assembly Report Summary - {report_date.strftime('%m-%d-%Y')}",
    )
    ws_summary["A1"].font = Font(bold=True, size=14)

    # Total scans
    total_scans = len(scans)
    ws_summary.cell(row=3, column=1, value="Total Scans:")
    ws_summary.cell(row=3, column=2, value=total_scans)
    ws_summary["A3"].font = Font(bold=True)

    ws_summary.cell(row=4, column=1, value="Total Pieces:")
    ws_summary.cell(row=4, column=2, value=total_scans * PIECES_PER_BOX)
    ws_summary["A4"].font = Font(bold=True)

    # By Station
    row = 6
    ws_summary.cell(row=row, column=1, value="By Station:")
    ws_summary[f"A{row}"].font = Font(bold=True, size=12)
    row += 1

    station_counts = defaultdict(int)
    for scan in scans:
        station = scan.get("station_id") or "Unknown"
        station_counts[station] += 1

    for station, count in sorted(station_counts.items(), key=lambda x: -x[1]):
        ws_summary.cell(row=row, column=1, value=station)
        ws_summary.cell(row=row, column=2, value=count)
        ws_summary.cell(row=row, column=3, value=f"({count * PIECES_PER_BOX} pcs)")
        row += 1

    # By Operator
    row += 1
    ws_summary.cell(row=row, column=1, value="By Operator:")
    ws_summary[f"A{row}"].font = Font(bold=True, size=12)
    row += 1

    operator_counts = defaultdict(int)
    for scan in scans:
        operator = scan.get("operator_name") or "Unknown"
        operator_counts[operator] += 1

    for operator, count in sorted(operator_counts.items(), key=lambda x: -x[1]):
        ws_summary.cell(row=row, column=1, value=operator)
        ws_summary.cell(row=row, column=2, value=count)
        ws_summary.cell(row=row, column=3, value=f"({count * PIECES_PER_BOX} pcs)")
        row += 1

    # Batch Comment (SO Context) Summary
    row += 2
    ws_summary.cell(row=row, column=1, value="Batch Comment ('SO' Context) Summary:")
    ws_summary[f"A{row}"].font = Font(bold=True, size=12)
    row += 1

    # Count scans with and without SO context
    scans_with_so = 0
    scans_without_so = 0
    for scan in scans:
        comment = (scan.get("batch_comment") or "").upper()
        if "SO" in comment:
            scans_with_so += 1
        else:
            scans_without_so += 1

    ws_summary.cell(row=row, column=1, value="Scans with 'SO' context:")
    ws_summary.cell(
        row=row,
        column=2,
        value=f"{scans_with_so} ({scans_with_so * PIECES_PER_BOX} pieces)",
    )
    row += 1

    ws_summary.cell(row=row, column=1, value="Scans without 'SO' context:")
    ws_summary.cell(
        row=row,
        column=2,
        value=f"{scans_without_so} ({scans_without_so * PIECES_PER_BOX} pieces)",
    )

    # Auto-adjust column widths for summary sheet
    ws_summary.column_dimensions["A"].width = 35
    ws_summary.column_dimensions["B"].width = 20
    ws_summary.column_dimensions["C"].width = 15

    # ===== CREATE RAW DATA SHEET (for audit trail) =====
    ws_raw = wb.create_sheet(title="Raw Data")

    # Headers for raw data
    raw_headers = [
        "Timestamp (EST)",
        "Serial Number",
        "Part Number",
        "Operator",
        "Station",
        "Raw Barcode",
        "Comment",
        "Notes",
    ]
    for col, header in enumerate(raw_headers, 1):
        cell = ws_raw.cell(row=1, column=col, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
        cell.border = border

    # Populate raw data rows
    for row_num, scan in enumerate(scans, 2):
        # Convert UTC timestamp to EST for display
        ts = scan.get("created_at", "")
        if ts:
            try:
                dt = datetime.fromisoformat(ts.replace("+00:00", "").replace("Z", ""))
                ts_display = (dt - timedelta(hours=5)).strftime("%Y-%m-%d %H:%M:%S")
            except:
                ts_display = ts
        else:
            ts_display = ""

        ws_raw.cell(row=row_num, column=1, value=ts_display).border = border
        ws_raw.cell(
            row=row_num, column=2, value=scan.get("serial_number", "")
        ).border = border

        # Apply part number transformations
        raw_part = scan.get("part_id", "")
        raw_serial = scan.get("serial_number", "")
        display_part_raw = apply_part_number_variant(
            raw_part, [raw_serial] if raw_serial else []
        )

        ws_raw.cell(row=row_num, column=3, value=display_part_raw).border = border
        ws_raw.cell(
            row=row_num, column=4, value=scan.get("operator_name", "")
        ).border = border
        ws_raw.cell(
            row=row_num, column=5, value=scan.get("station_id", "")
        ).border = border
        ws_raw.cell(
            row=row_num, column=6, value=scan.get("raw_scan", "")
        ).border = border
        ws_raw.cell(
            row=row_num, column=7, value=scan.get("batch_comment", "")
        ).border = border
        ws_raw.cell(
            row=row_num, column=8, value=scan.get("dashboard_notes", "")
        ).border = border

    # Auto-adjust column widths for raw data sheet
    raw_widths = [22, 18, 14, 12, 10, 45, 25, 25]
    for col, width in enumerate(raw_widths, 1):
        ws_raw.column_dimensions[get_column_letter(col)].width = width

    print(f"[OK] Added Raw Data sheet with {len(scans)} records")

    # ===== CREATE PART SUMMARY SHEET (Format requested: Part, Total Pcs, Ranges) =====
    ws_part_summary = wb.create_sheet(title="Part Summary")

    # Calculate global part totals first
    # Group by TRANSFORMED part number to separate MGC variants (S/C)
    global_part_data = defaultdict(lambda: {"pieces": 0, "serials": []})

    for scan in scans:
        part = scan.get("part_id") or "Unknown"
        serial = scan.get("serial_number") or ""

        # Apply part number transformations based on this scan's serial
        # This will separate MGC variants (e.g., 536713-002S vs 536713-002C)
        display_part = apply_part_number_variant(part, [serial] if serial else [])

        global_part_data[display_part]["pieces"] += PIECES_PER_BOX
        if serial:
            global_part_data[display_part]["serials"].append(serial)

    ps_row = 1
    # Check if we have data
    if not global_part_data:
        ws_part_summary.cell(row=1, column=1, value="No scans found.")
    else:
        for display_part in sorted(global_part_data.keys()):
            data = global_part_data[display_part]

            # Format:
            # <Part Number>
            # TOTAL PIECES: <Count>
            # SERIAL SEQUENCES: <Ranges>

            # Part Part Number
            cell_part = ws_part_summary.cell(row=ps_row, column=1, value=display_part)
            cell_part.font = Font(bold=True, size=12)
            ps_row += 1

            # Total Pieces
            ws_part_summary.cell(
                row=ps_row, column=1, value=f"TOTAL PIECES: {data['pieces']}"
            )
            ps_row += 1

            # Serial Sequences
            ranges = format_serial_ranges(data["serials"])
            # Wrap text for long sequences
            cell_seq = ws_part_summary.cell(
                row=ps_row, column=1, value=f"SERIAL SEQUENCES: {ranges}"
            )
            cell_seq.alignment = Alignment(wrap_text=True)
            ps_row += 1

            # Empty lines between parts
            ps_row += 2

    # Set column width
    ws_part_summary.column_dimensions["A"].width = 100

    print(f"[OK] Added Part Summary sheet")

    # ===== CREATE PER-OPERATOR SHEETS =====
    # Get unique operators from this day's scans
    operators = sorted(
        set(scan.get("operator_name", "Unknown") or "Unknown" for scan in scans)
    )

    for operator in operators:
        # Filter scans for this operator
        operator_scans = [
            s for s in scans if (s.get("operator_name") or "Unknown") == operator
        ]

        if not operator_scans:
            continue

        # Create sheet (Excel sheet names max 31 chars, no special chars)
        sheet_name = f"{operator[:25]}"  # Truncate if too long
        # Remove any invalid characters
        sheet_name = "".join(c for c in sheet_name if c not in "[]:*?/\\")
        if not sheet_name:
            sheet_name = "Unknown"

        ws_op = wb.create_sheet(title=sheet_name)

        # Headers
        op_headers = [
            "Timestamp (EST)",
            "Serial Number",
            "Part Number",
            "Station",
            "Raw Barcode",
            "Comment",
        ]
        for col, header in enumerate(op_headers, 1):
            cell = ws_op.cell(row=1, column=col, value=header)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center")
            cell.border = border

        # Data rows
        for row_num, scan in enumerate(operator_scans, 2):
            # Convert timestamp to EST
            ts = scan.get("created_at", "")
            if ts:
                try:
                    dt = datetime.fromisoformat(
                        ts.replace("+00:00", "").replace("Z", "")
                    )
                    ts_display = (dt - timedelta(hours=5)).strftime("%Y-%m-%d %H:%M:%S")
                except:
                    ts_display = ts
            else:
                ts_display = ""

            ws_op.cell(row=row_num, column=1, value=ts_display).border = border
            ws_op.cell(
                row=row_num, column=2, value=scan.get("serial_number", "")
            ).border = border

            # Apply part number transformations
            op_part = scan.get("part_id", "")
            op_serial = scan.get("serial_number", "")
            display_part_op = apply_part_number_variant(
                op_part, [op_serial] if op_serial else []
            )

            ws_op.cell(row=row_num, column=3, value=display_part_op).border = border
            ws_op.cell(
                row=row_num, column=4, value=scan.get("station_id", "")
            ).border = border
            ws_op.cell(
                row=row_num, column=5, value=scan.get("raw_scan", "")
            ).border = border
            ws_op.cell(
                row=row_num, column=6, value=scan.get("batch_comment", "")
            ).border = border

        # Column widths
        op_widths = [22, 18, 14, 10, 45, 25]
        for col, width in enumerate(op_widths, 1):
            ws_op.column_dimensions[get_column_letter(col)].width = width

        print(f"[OK] Added sheet for {operator} with {len(operator_scans)} scans")

    # Save to temp file with predictable name
    date_str = report_date.strftime("%m-%d-%Y")
    filename = f"Build_Report_{date_str}.xlsx"
    temp_path = os.path.join(tempfile.gettempdir(), filename)
    wb.save(temp_path)
    print(f"[OK] Generated Excel report: {temp_path}")

    return temp_path


def generate_qb_import_file(scans: list, report_date: datetime) -> str:
    """
    Generate QuickBooks/SaasAnt import file for Build Assembly items.

    Format:
    - DATE (MM/DD/YYYY) - The actual date of barcode scans (prior day)
    - S.No - Auto-incrementing row number
    - Inventory Assembly Item - Part number with transformations (MGC variants, PFR prefix)
    - Memo - Blank
    - Quantity to Build - Total pieces (scans × PIECES_PER_BOX)
    - Mark Pending if Required - FALSE

    Groups by Part Number + Serial Header to separate variants (e.g., 536713-001S vs 536713-001C)
    """
    wb = Workbook()
    ws = wb.active
    ws.title = "Build Assembly"

    # Styles
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(
        start_color="4472C4", end_color="4472C4", fill_type="solid"
    )
    border = Border(
        left=Side(style="thin"),
        right=Side(style="thin"),
        top=Side(style="thin"),
        bottom=Side(style="thin"),
    )
    center_align = Alignment(horizontal="center", vertical="center")

    # Headers
    headers = [
        "DATE",
        "Inventory Assembly Item",
        "Memo",
        "Quantity to Build",
        "Mark Pending if Required",
    ]
    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center_align
        cell.border = border

    # Group scans by Part Number (with transformations applied)
    # We need to group by transformed part number to separate variants
    part_totals = defaultdict(lambda: {"pieces": 0, "serials": []})

    for scan in scans:
        part = scan.get("part_id") or "Unknown"
        serial = scan.get("serial_number") or ""

        # Apply transformations to get the display part number
        display_part = apply_part_number_variant(part, [serial] if serial else [])

        part_totals[display_part]["pieces"] += PIECES_PER_BOX
        if serial:
            part_totals[display_part]["serials"].append(serial)

    # Format date as MM/DD/YYYY
    date_str = report_date.strftime("%m/%d/%Y")

    # Populate data rows
    row = 2

    for part in sorted(part_totals.keys()):
        data = part_totals[part]

        # Format serial numbers as ranges (same as Build Report)
        serial_ranges = format_serial_ranges(sorted(data["serials"]))

        # DATE
        cell = ws.cell(row=row, column=1, value=date_str)
        cell.border = border
        cell.alignment = center_align

        # Inventory Assembly Item (Part Number with transformations)
        cell = ws.cell(row=row, column=2, value=part)
        cell.border = border
        cell.alignment = center_align

        # Memo (serial number ranges - client can delete if not needed)
        cell = ws.cell(row=row, column=3, value=serial_ranges)
        cell.border = border
        cell.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)

        # Quantity to Build
        cell = ws.cell(row=row, column=4, value=data["pieces"])
        cell.border = border
        cell.alignment = center_align

        # Mark Pending if Required
        cell = ws.cell(row=row, column=5, value="FALSE")
        cell.border = border
        cell.alignment = center_align

        row += 1

    # Auto-adjust column widths
    ws.column_dimensions["A"].width = 12  # DATE
    ws.column_dimensions["B"].width = 30  # Inventory Assembly Item
    ws.column_dimensions["C"].width = 60  # Memo (serial number ranges)
    ws.column_dimensions["D"].width = 18  # Quantity to Build
    ws.column_dimensions["E"].width = 25  # Mark Pending if Required

    # Save to temp file with predictable name
    date_str = report_date.strftime("%m-%d-%Y")
    filename = f"QB_Build_Assembly_{date_str}.xlsx"
    temp_path = os.path.join(tempfile.gettempdir(), filename)
    wb.save(temp_path)
    print(f"[OK] Generated QuickBooks import file: {temp_path}")
    print(f"   - {row - 2} part numbers")
    print(f"   - Date: {date_str}")

    return temp_path


def send_email(
    excel_path: str, qb_import_path: str, report_date: datetime, scan_count: int
):
    """Send email with Excel attachments (detailed report + QuickBooks import file)"""
    recipients = [r.strip() for r in REPORT_RECIPIENTS.split(",")]

    if not SMTP_PASSWORD:
        print("[WARN] SMTP_PASSWORD not set, skipping email send")
        return

    msg = MIMEMultipart()
    msg["From"] = SMTP_EMAIL
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = f"Daily Build Report - {report_date.strftime('%B %d, %Y')}"

    # Email body
    body = f"""
Good morning,

Please find attached the Daily Build Report for {report_date.strftime("%B %d, %Y")}.

Summary:
- Total Scans: {scan_count}
- Total Pieces: {scan_count * PIECES_PER_BOX:,}

Attachments:
1. Build_Report_{report_date.strftime("%m-%d-%Y")}.xlsx - Detailed daily report with all scan data
2. QB_Build_Assembly_{report_date.strftime("%m-%d-%Y")}.xlsx - QuickBooks import file (ready for SaasAnt)

This report was automatically generated from the Polytechnic Resources Serial Number Scan Log system.

Best regards,
Polytechnic Resources Automation
    """
    msg.attach(MIMEText(body, "plain"))

    # Attach detailed Excel report
    filename = f"Build_Report_{report_date.strftime('%m-%d-%Y')}.xlsx"
    with open(excel_path, "rb") as f:
        part = MIMEBase(
            "application", "vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        part.set_payload(f.read())
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", f'attachment; filename="{filename}"')
        msg.attach(part)

    # Attach QuickBooks import file
    qb_filename = f"QB_Build_Assembly_{report_date.strftime('%m-%d-%Y')}.xlsx"
    with open(qb_import_path, "rb") as f:
        qb_part = MIMEBase(
            "application", "vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        qb_part.set_payload(f.read())
        encoders.encode_base64(qb_part)
        qb_part.add_header(
            "Content-Disposition", f'attachment; filename="{qb_filename}"'
        )
        msg.attach(qb_part)

    # Send
    try:
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_EMAIL, SMTP_PASSWORD)
            server.sendmail(SMTP_EMAIL, recipients, msg.as_string())
        print(f"[OK] Email sent to: {', '.join(recipients)}")
    except Exception as e:
        print(f"[ERROR] Email failed: {e}")
        raise


def backup_to_google_sheets(scans: list, report_date: datetime):
    """
    Backup daily scans to a Google Sheet.
    Appends rows to the first worksheet with: Date, Timestamp, Serial, Part, Operator, Station, Comment
    """
    if not GSHEET_ENABLED:
        print("[WARN] Google Sheets backup not configured - skipping")
        return

    import base64
    import json

    try:
        # Decode service account credentials from base64
        creds_json = base64.b64decode(GSHEET_CREDENTIALS_JSON).decode("utf-8")
        creds_dict = json.loads(creds_json)

        # Authenticate with Google Sheets
        scopes = [
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive",
        ]
        credentials = Credentials.from_service_account_info(creds_dict, scopes=scopes)
        gc = gspread.authorize(credentials)

        # Open spreadsheet
        spreadsheet = gc.open_by_key(GSHEET_SPREADSHEET_ID)
        worksheet = spreadsheet.sheet1  # First worksheet

        # Format rows for append
        date_str = report_date.strftime("%Y-%m-%d")
        rows_to_append = []

        for scan in scans:
            # Convert UTC timestamp to EST for display
            ts = scan.get("created_at", "")
            if ts:
                try:
                    dt = datetime.fromisoformat(
                        ts.replace("+00:00", "").replace("Z", "")
                    )
                    ts_display = (dt - timedelta(hours=5)).strftime("%Y-%m-%d %H:%M:%S")
                except:
                    ts_display = ts
            else:
                ts_display = ""

            # Apply part number transformations
            gsheet_part = scan.get("part_id", "")
            gsheet_serial = scan.get("serial_number", "")
            display_part_gsheet = apply_part_number_variant(
                gsheet_part, [gsheet_serial] if gsheet_serial else []
            )

            rows_to_append.append(
                [
                    date_str,
                    ts_display,
                    scan.get("serial_number", ""),
                    display_part_gsheet,
                    scan.get("operator_name", ""),
                    scan.get("station_id", ""),
                    scan.get("batch_comment", ""),
                ]
            )

        # Append all rows at once
        if rows_to_append:
            worksheet.append_rows(rows_to_append, value_input_option="RAW")
            print(f"[OK] Google Sheets backup: {len(rows_to_append)} rows appended")
        else:
            print("[WARN] No rows to backup to Google Sheets")

    except Exception as e:
        print(f"[ERROR] Google Sheets backup failed: {e}")
        # Don't raise - backup failure shouldn't stop the main report


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Daily Build Report Generator")
    parser.add_argument("date", nargs="?", help="Report date (YYYY-MM-DD)")
    parser.add_argument("--test", action="store_true", help="Test mode (no email)")
    parser.add_argument(
        "--info",
        action="store_true",
        help="Show diagnostic info (date ranges, time zone)",
    )
    args = parser.parse_args()

    test_mode = args.test
    info_mode = args.info

    if info_mode:
        # Just show info, don't process
        print("=" * 70)
        print("DAILY REPORT - DIAGNOSTIC INFO")
        print("=" * 70)
        print()
        print(f"Current Local Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S %Z')}")
        print(f"Target Date: {args.date if args.date else 'yesterday'}")
        print()
        print("Time Zone Info:")
        print("  - EST (US Eastern) = UTC-5")
        print("  - During Standard Time: UTC-4")
        print("  - During Daylight Saving Time: UTC-4")
        print()
        print("Date Query Logic:")
        print("  - When 'yesterday' is specified:")
        print("    1. Parses date as YYYY-MM-DD")
        print("    2. Sets time to 00:00:00 (midnight)")
        print("    3. Converts to EST using: timedelta(hours=-5)")
        print("    4. Queries UTC range: (date 00:00:00 to next day 05:00:00)")
        print("       This equals: (date 00:00:00 to next day 05:00:00 EST)")
        print("       So you get full 24 hours of that date (00:00:00 to 23:59:59 EST)")
        print()
        print("Note: This -5 hour adjustment works if your system is in EST.")
        print(
            "      If your system is in a different time zone, scans may be misaligned."
        )
        sys.exit(0)


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Daily Build Report Generator")
    parser.add_argument("date", nargs="?", help="Report date (YYYY-MM-DD)")
    parser.add_argument("--test", action="store_true", help="Test mode (no email)")
    parser.add_argument(
        "--info",
        action="store_true",
        help="Show diagnostic info (date ranges, time zone)",
    )
    args = parser.parse_args()

    test_mode = args.test
    info_mode = args.info

    if info_mode:
        # Just show info, don't process
        print("=" * 70)
        print("DAILY REPORT - DIAGNOSTIC INFO")
        print("=" * 70)
        print()
        print(f"Current Local Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S %Z')}")
        print(f"Target Date: {args.date if args.date else 'yesterday'}")
        print()
        print("Time Zone Info:")
        print("  - EST (US Eastern) = UTC-5")
        print("  - During Standard Time: UTC-4")
        print("  - During Daylight Saving Time: UTC-4")
        print()
        print("Date Query Logic:")
        print("  - When 'yesterday' is specified:")
        print("    1. Parses date as YYYY-MM-DD")
        print("    2. Sets time to 00:00:00 (midnight)")
        print("    3. Converts to EST using: timedelta(hours=-5)")
        print("    4. Queries UTC range: (date 00:00:00 to next day 05:00:00)")
        print("       This equals: (date 00:00:00 to next day 05:00:00 EST)")
        print("       So you get full 24 hours of that date (00:00:00 to 23:59:59 EST)")
        print()
        print("Note: This -5 hour adjustment works if your system is in EST.")
        print(
            "      If your system is in a different time zone, scans may be misaligned."
        )
        sys.exit(0)

    if args.date:
        try:
            target_date = datetime.strptime(args.date, "%Y-%m-%d")
        except ValueError:
            print(f"[ERROR] Invalid date format: {args.date}. Use YYYY-MM-DD")
            sys.exit(1)
    else:
        target_date = datetime.now() - timedelta(days=1)


def main():
    """Main entry point"""
    import argparse

    parser = argparse.ArgumentParser(description="Daily Build Report Generator")
    parser.add_argument("date", nargs="?", help="Report date (YYYY-MM-DD)")
    parser.add_argument("--test", action="store_true", help="Test mode (no email)")
    parser.add_argument(
        "--info",
        action="store_true",
        help="Show diagnostic info (date ranges, time zone)",
    )
    args = parser.parse_args()

    test_mode = args.test
    info_mode = args.info

    if info_mode:
        # Just show info, don't process
        print("\n" + "=" * 70)
        print("DAILY REPORT - DIAGNOSTIC INFO")
        print("=" * 70)
        print()
        print(f"Current Local Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S %Z')}")
        print(f"Target Date: {args.date if args.date else 'yesterday'}")
        print()
        print("Time Zone Info:")
        print("  - EST (US Eastern) = UTC-5")
        print("  - During Standard Time: UTC-4")
        print("  - During Daylight Saving Time: UTC-4")
        print()
        print("Date Query Logic:")
        print("  - When 'yesterday' is specified:")
        print("    1. Parses date as YYYY-MM-DD")
        print("    2. Sets time to 00:00:00 (midnight)")
        print("    3. Converts to EST using: timedelta(hours=-5)")
        print("    4. Queries UTC range: (date 00:00:00 to next day 00:00:00)")
        print("       This equals: (date 00:00:00 to next day 05:00:00 EST)")
        print("       So you get full 24 hours of that date (00:00:00 to 23:59:59 EST)")
        print()
        print("Note: This -5 hour adjustment works if your system is in EST.")
        print(
            "      If your system is in a different time zone, scans may be misaligned."
        )
        sys.exit(0)

    if args.date:
        try:
            target_date = datetime.strptime(args.date, "%Y-%m-%d")
        except ValueError:
            # Handle case where date might be mistakenly parsed if flags are mixed order in some shells
            # But argparse handles pos args well.
            print(f"[ERROR] Invalid date format: {args.date}. Use YYYY-MM-DD")
            sys.exit(1)
    else:
        target_date = datetime.now() - timedelta(days=1)

    print(f"[INFO] Generating Build Report for {target_date.strftime('%Y-%m-%d')}")
    print(f"   Test mode: {test_mode}")

    # Fetch data
    supabase = get_supabase_client()
    scans = fetch_scans_for_date(supabase, target_date)

    print(f"[INFO] Found {len(scans)} scans")

    if len(scans) == 0:
        print("[WARN] No scans found for this date. Skipping report.")
        return

    # Group data
    grouped = group_scans(scans)

    # Generate Excel reports
    excel_path = generate_excel_report(grouped, scans, target_date)
    qb_import_path = generate_qb_import_file(scans, target_date)

    # Send email (unless test mode)
    if not test_mode:
        send_email(excel_path, qb_import_path, target_date, len(scans))
    else:
        print(f"[TEST] Test mode - Files saved:")
        print(f"   Build Report: {excel_path}")
        print(f"   QB Import: {qb_import_path}")
        print(f"   Would send to: {REPORT_RECIPIENTS}")

    # Backup to Google Sheets (always, including test mode)
    backup_to_google_sheets(scans, target_date)

    # Cleanup (unless test mode)
    if not test_mode:
        os.remove(excel_path)
        os.remove(qb_import_path)

    print("[OK] Report complete!")


if __name__ == "__main__":
    main()
