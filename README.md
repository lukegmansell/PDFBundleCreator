# Bundle Builder (PDF-BBB)

Bundle Builder is a browser-based tool for merging multiple PDF files into a single, paginated bundle. It runs entirely in the browser — no server, no installation, and no internet connection required. All processing happens locally on your machine.

The app is aimed at users who need to combine several PDFs into a single document with a generated cover page, consistent page numbering, and optional OCR text overlays on scanned pages.

## What it does

- **Merges PDFs** — queue multiple PDF files and combine them into one output document in the order you choose.
- **Generates a cover page** — optionally creates a first page with editable title, subtitle, reference, prepared-by, and notes fields.
- **Stamps page numbers** — optionally adds page labels (e.g. `B-1`, `B-2`) at a configurable position on each page.
- **Runs OCR** — uses a bundled English language model to add a hidden, searchable text layer to scanned pages that don't already have one.
- **Produces an index page** — optionally adds a page listing each source document and its starting page number.

## How it works

Bundle Builder is a single HTML file that loads its dependencies (PDF.js, pdf-lib, and Tesseract.js) from the `libs/` folder. Everything runs inside the browser using JavaScript — no data is sent anywhere.

The workflow is split into four tabs:

1. **Build Bundle** — add PDF files by dropping them onto the page or using the file picker, then arrange them in the desired order.
2. **Review Bundle** — preview any page from any queued document and see whether it already has a selectable text layer.
3. **Cover Page** — edit the generated cover page fields (title, subtitle, reference, prepared by, notes) and see a live preview.
4. **Pagination** — set the page label prefix, start number, and position; choose OCR mode; enable/disable index page output; set the output filename; then build and download the merged PDF.

## Folder contents

- `index.html` — the app itself
- `assets/` — compiled CSS and JavaScript
- `libs/` — bundled third-party libraries (PDF.js, pdf-lib, Tesseract.js)
- `runtime/` — OCR language data (`tessdata/eng.traineddata.gz`)

## Setup

1. Keep the full folder together.
2. Open `index.html` in Edge or Chrome (double-click the file, or drag it into the browser).
3. Work through the four tabs to build, review, and export your bundle.

## Notes

- OCR uses the bundled English language model in `runtime/tessdata/eng.traineddata.gz`.
- Large bundles with many scanned pages will take longer to process due to OCR.
- No data leaves the machine while the app is in use.
