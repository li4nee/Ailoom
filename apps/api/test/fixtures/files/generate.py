#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Regenerates the tiny binary fixtures in this directory. Run from this directory:

    python3 generate.py

Everything is produced here rather than exported from an office suite so the bytes are
reviewable and reproducible.
"""

import io
import zipfile

PDF_PAGES = [
    ["Refund policy", "", "Our refund policy applies to every subscription."],
    [
        "Eligibility",
        "",
        "A full refund is available within 30 days of purchase.",
        "After 30 days, only unused months can be refunded.",
    ],
]


def pdf_bytes(pages: list[list[str]]) -> bytes:
    """A minimal PDF 1.4 with Helvetica text, one or more pages, and a correct xref table."""
    objects: list[bytes] = []

    def add(body: bytes) -> int:
        objects.append(body)
        return len(objects)

    catalog = len(objects) + 1
    pages_id = len(objects) + 2
    font_id = len(objects) + 3
    add(b"")  # placeholder for the catalog, filled in below
    add(b"")  # placeholder for the page tree

    page_ids = []
    for lines in pages:
        stream = ["BT", "/F1 12 Tf", "72 720 Td", "18 TL"]
        for line in lines:
            escaped = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            stream.append(f"({escaped}) Tj T*")
        stream.append("ET")
        content = "\n".join(stream).encode("latin-1")
        content_id = add(
            b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream"
        )
        page_ids.append(
            add(
                b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 612 792] "
                b"/Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
                % (pages_id, font_id, content_id)
            )
        )

    add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    objects[catalog - 1] = b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id
    kids = b" ".join(b"%d 0 R" % page_id for page_id in page_ids)
    objects[pages_id - 1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (
        kids,
        len(page_ids),
    )

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = [0]
    for number, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(b"%d 0 obj\n" % number + body + b"\nendobj\n")
    xref_at = out.tell()
    out.write(b"xref\n0 %d\n" % (len(objects) + 1))
    out.write(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        out.write(b"%010d 00000 n \n" % offset)
    out.write(
        b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n"
        % (len(objects) + 1, catalog, xref_at)
    )
    return out.getvalue()


DOCX_DOCUMENT = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Shipping policy</w:t></w:r></w:p>
    <w:p><w:r><w:t>Orders ship within two business days.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Rates</w:t></w:r></w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>Plan</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Price</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>Standard</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Free</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
  </w:body>
</w:document>
"""

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
"""

RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""


def docx_bytes() -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", CONTENT_TYPES)
        archive.writestr("_rels/.rels", RELS)
        archive.writestr("word/document.xml", DOCX_DOCUMENT)
    return out.getvalue()


def plain_zip_bytes() -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("readme.txt", "not a docx")
    return out.getvalue()


def main() -> None:
    def write(name: str, data: bytes) -> None:
        with open(name, "wb") as handle:
            handle.write(data)

    write("sample.pdf", pdf_bytes(PDF_PAGES))
    write("sample.docx", docx_bytes())
    write("plain.zip.docx", plain_zip_bytes())
    write("page.html", b"<!doctype html>\n<html><body><h1>Refund policy</h1></body></html>\n")
    write("notes.md", b"# Notes\n\nA markdown file.\n")
    write("notes.txt", b"Plain text.\n")
    write("fake.pdf", b"<!doctype html>\n<html><body>An HTML page called a PDF.</body></html>\n")
    write(
        "program.exe.pdf",
        b"MZ\x90\x00\x03\x00\x00\x00" + b"\x00" * 56 + b"This is a DOS executable.\x00",
    )
    write("binary.txt", b"looks like text\x00but is not\x01\x02")


if __name__ == "__main__":
    main()
