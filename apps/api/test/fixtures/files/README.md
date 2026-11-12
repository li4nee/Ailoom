# File fixtures

Tiny, reviewable files for the upload and extraction tests. Regenerate them with
`python3 generate.py` (from this directory) after changing the generator; the committed
bytes are the output of that script, so a diff stays readable.

| File | What it is |
| --- | --- |
| `sample.pdf` | Two-page PDF 1.4 written by `generate.py`: Helvetica text, a correct xref table. |
| `three-pages.pdf` | Three short pages, for the `maxPages` truncation test. |
| `scanned.pdf` | One page with no text operators, i.e. no text layer. |
| `encrypted.pdf` | A PDF whose trailer declares `/Encrypt`; the extractor must refuse it. |
| `sample.docx` | Zip with `[Content_Types].xml`, `_rels/.rels` and `word/document.xml`; a heading, a nested heading and a two-column table. |
| `plain.zip.docx` | A zip without `word/`, i.e. a docx by extension only. |
| `page.html` | A minimal HTML page. |
| `notes.md` | A minimal Markdown file. |
| `notes.txt` | A minimal plain-text file. |
| `fake.pdf` | HTML bytes under a `.pdf` name (the extension lies). |
| `program.exe.pdf` | The start of a DOS/PE executable under a `.pdf` name. |
| `binary.txt` | Text with a NUL byte and control characters under a `.txt` name. |
