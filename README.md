# PDFBundleCreator

A local-first, browser-based web app that assembles multiple PDFs into a single polished bundle — complete with a styled cover page, page numbering, redactions, and OCR. No files ever leave your browser.

## Features

- **Upload & reorder** — Import multiple PDFs and drag them into the order you need.
- **Burn-in redactions** — Draw rectangles over sensitive content on any page. Redacted pages are flattened to images, making the redaction permanent.
- **OCR** — Extract text from scanned or image-based PDFs using an in-browser Tesseract engine (no internet required).
- **Cover page** — Auto-generate a styled title page with metadata (title, subtitle, reference, author, date). Choose from three colour themes: Ink, Marine, or Copper.
- **Pagination** — Stamp page numbers in the footer or header, with configurable start number, prefix, and position.
- **Export** — Download the finished bundle as a single PDF, assembled entirely client-side.

## Technology Stack

| Library | Purpose |
|---|---|
| [React 19](https://react.dev) | UI and state management |
| [TypeScript 6](https://www.typescriptlang.org) | Type safety |
| [Vite 8](https://vitejs.dev) | Development server and production bundler |
| [pdf-lib](https://pdf-lib.js.org) | PDF creation — cover page, pagination, redaction embedding |
| [pdfjs-dist](https://mozilla.github.io/pdf.js) | PDF rendering to Canvas for previews and text extraction |
| [tesseract.js](https://tesseract.projectnaptha.com) | In-browser OCR for scanned pages |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) (LTS recommended)

### Install dependencies

```bash
cd PDFCoverAndIndexPage
npm install
```

### Run the development server

```bash
npm run dev
```

The app will be available at `http://localhost:4173`.

### Build for production

```bash
npm run build
```

The compiled output is written to `PDFCoverAndIndexPage/dist/`. The `dist/` folder is committed to the repository so the app can also be opened directly from the file system without a server — just open `dist/index.html` in a browser.

## Project Structure

```
PDFBundleCreator/
└── PDFCoverAndIndexPage/
    ├── public/
    │   └── tessdata/        # Bundled Tesseract language data (English)
    ├── src/
    │   ├── main.tsx         # React entry point
    │   ├── App.tsx          # Main UI component (tabs, state, event handlers)
    │   ├── pdf-utils.ts     # All PDF processing logic (build, render, OCR, redact)
    │   ├── types.ts         # Shared TypeScript type definitions
    │   └── styles.css       # Global styles and CSS design tokens
    ├── dist/                # Pre-built production output
    ├── index.html           # HTML entry point (handles local file:// launch)
    └── package.json
```

## Usage

1. **Initial Batch** — Upload one or more PDF files. Each file's page count and a thumbnail preview are shown.
2. **Ordering** — Drag documents into the desired sequence. Select any document and page to draw redaction boxes.
3. **Front Page** — Fill in bundle metadata (title, reference, prepared by/for, notes) and choose a cover theme.
4. **Pagination** — Configure page numbering and click **Build & Download** to export the final PDF.

## Privacy

All processing happens locally in your browser. No PDF content, file names, or extracted text are transmitted to any server.

## License

MIT
