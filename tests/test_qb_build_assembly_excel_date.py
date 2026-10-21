"""Regression test for native Excel dates in the QuickBooks Build Assembly export."""

import os
import sys
import tempfile
from datetime import date, datetime
from unittest.mock import patch

from openpyxl import load_workbook

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

from daily_report import generate_qb_import_file


def test_build_assembly_date_is_a_native_excel_date():
    report_date = datetime(2026, 10, 20)
    scans = [{"part_id": "PFR60W", "serial_number": "PFR60W12345"}]

    with tempfile.TemporaryDirectory() as temp_dir:
        with patch("daily_report.tempfile.gettempdir", return_value=temp_dir):
            workbook_path = generate_qb_import_file(scans, report_date)

        try:
            workbook = load_workbook(workbook_path, data_only=False)
            sheet = workbook["Build Assembly"]

            assert sheet["A1"].value == "DATE"
            assert isinstance(sheet["A2"].value, (date, datetime)), (
                "DATE must be stored as an Excel date value, not text"
            )
            assert sheet["A2"].value.strftime("%Y-%m-%d") == report_date.strftime(
                "%Y-%m-%d"
            )
            assert sheet["A2"].number_format == "mm/dd/yyyy"
            assert sheet["B2"].value == "301-PFR60W"
            assert sheet["C2"].value == "PFR60W12345"
            assert sheet["D2"].value == 100
            assert sheet["E2"].value == "FALSE"
        finally:
            if os.path.exists(workbook_path):
                os.remove(workbook_path)


if __name__ == "__main__":
    test_build_assembly_date_is_a_native_excel_date()
    print("PASS: Build Assembly DATE is a native Excel date with unchanged import fields")
