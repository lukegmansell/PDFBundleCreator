# Bundle Builder

Bundle Builder is a portable, browser-based PDF bundling tool. It merges multiple PDFs into a single document, adds a generated cover page, stamps page numbers, and can run OCR — all entirely within the browser. No server, installation, or internet connection is required.

## How it works

Bundle Builder runs as a static web app. All processing (merging, OCR, cover generation, and pagination) happens locally in your browser using:

- **pdf-lib** — merges PDFs and stamps page labels
- **PDF.js** — renders page previews
- **Tesseract.js** — runs OCR using the bundled English language model at `runtime/tessdata/eng.traineddata.gz`

No files are uploaded or sent anywhere. Everything stays on your machine.

## Folder contents

- `index.html` — the app entry point
- `assets/` — application styles and scripts
- `libs/` — bundled third-party libraries
- `runtime/` — OCR language data

## Getting started

1. Keep the full folder together (all relative paths must remain intact).
2. Open `index.html` in a Chromium-based browser such as Chrome or Edge — double-click the file or drag it into a browser tab.
3. Work through the four tabs from left to right.

## How to use it

### 1. Build Bundle
Add the PDF files you want to include. Drag and drop files onto the drop zone, or click **Add PDF files** to browse for them. Reorder or remove files using the queue controls. The bundle summary on the right updates as you go.

### 2. Review Bundle
Select any queued document to preview its pages one at a time. The app checks each page for an existing text layer so you can decide whether OCR is needed.

### 3. Cover Page
Edit the fields to customise the generated first page — title, subtitle, reference number, prepared-by name, and a free-text note. A live preview updates as you type. Uncheck **Include generated cover page** to skip it.

### 4. Pagination
Configure page labels (prefix, start number, and position) and choose an OCR mode:

| Mode | Behaviour |
|------|-----------|
| Auto-detect | Only runs OCR on pages that have no existing text layer |
| OCR every page | Runs OCR on all source pages |
| Off | Skips OCR entirely |

Optionally enable **Add document index page** to insert a page that lists each source document and its starting page number. Set the output filename, then click **Build merged PDF**. When the build completes, download or open the result directly in the browser.

## Notes

- Large bundles with many scanned pages may take a moment to process during OCR.
- Pagination labels can be turned off if you only need the merged output without page stamps.
