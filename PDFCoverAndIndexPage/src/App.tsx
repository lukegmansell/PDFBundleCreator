import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
} from "react";
import { buildBundle, extractPdfText, inspectPdfFile, renderPdfPage } from "./pdf-utils";
import type {
  AppTab,
  CoverSettings,
  OcrState,
  PaginationSettings,
  PreviewState,
  RedactionMap,
  RedactionRect,
  UploadedPdf,
} from "./types";

const DEFAULT_COVER_SETTINGS: CoverSettings = {
  title: "Quarterly Governance Bundle",
  subtitle: "Board materials, appendices, and supporting exhibits.",
  reference: "GOV-2026-Q2",
  preparedFor: "Executive steering committee",
  preparedBy: "Document operations",
  notes: "Front cover and pagination are generated locally so sensitive files never leave the browser.",
  accentColor: "#5b8def",
  theme: "ink",
  includeManifest: true,
};

const DEFAULT_PAGINATION: PaginationSettings = {
  enabled: true,
  startNumber: 1,
  prefix: "",
  position: "footer-right",
  fontSize: 10,
  margin: 28,
  skipCover: true,
};

const EMPTY_OCR_STATE: OcrState = {
  status: "idle",
  progress: 0,
  message: "Select a document and page range to extract text or run OCR.",
  text: "",
  source: null,
  error: null,
};

const EMPTY_PREVIEW: PreviewState = {
  width: 1,
  height: 1.414,
  isRendering: false,
  error: null,
};

const TAB_ORDER: Array<{ id: AppTab; label: string; blurb: string }> = [
  {
    id: "upload",
    label: "Initial Batch",
    blurb: "Bring PDFs in, review counts, and run OCR checks.",
  },
  {
    id: "ordering",
    label: "Ordering",
    blurb: "Re-sequence the bundle and burn in redactions.",
  },
  {
    id: "cover",
    label: "Front Page",
    blurb: "Design the cover sheet and bundle metadata.",
  },
  {
    id: "pagination",
    label: "Pagination",
    blurb: "Set numbering rules and export the final bundle.",
  },
];

function App() {
  const [documents, setDocuments] = useState<UploadedPdf[]>([]);
  const [activeTab, setActiveTab] = useState<AppTab>("upload");
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [activePage, setActivePage] = useState(1);
  const [coverSettings, setCoverSettings] = useState(DEFAULT_COVER_SETTINGS);
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION);
  const [redactions, setRedactions] = useState<RedactionMap>({});
  const [ocrState, setOcrState] = useState<OcrState>(EMPTY_OCR_STATE);
  const [ocrMode, setOcrMode] = useState<"auto" | "ocr">("auto");
  const [ocrPageRange, setOcrPageRange] = useState("all");
  const [isUploading, setIsUploading] = useState(false);
  const [isBundling, setIsBundling] = useState(false);
  const [bundleMessage, setBundleMessage] = useState("Ready to assemble.");
  const [bundleProgress, setBundleProgress] = useState(0);
  const [preview, setPreview] = useState<PreviewState>(EMPTY_PREVIEW);
  const [draftRect, setDraftRect] = useState<RedactionRect | null>(null);
  const [draggedDocumentId, setDraggedDocumentId] = useState<string | null>(null);

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  const activeDocument = documents.find((document) => document.id === activeDocumentId) ?? null;
  const deferredOcrText = useDeferredValue(ocrState.text);
  const totalPages = documents.reduce((sum, document) => sum + document.pageCount, 0);
  const totalSizeBytes = documents.reduce((sum, document) => sum + document.sizeBytes, 0);
  const totalRedactions = Object.values(redactions).reduce(
    (sum, pageMap) =>
      sum +
      Object.values(pageMap).reduce((pageTotal, rects) => pageTotal + rects.length, 0),
    0,
  );
  const currentPageRedactions =
    (activeDocument ? redactions[activeDocument.id]?.[activePage - 1] : undefined) ?? [];

  useEffect(() => {
    if (documents.length === 0) {
      setActiveDocumentId(null);
      setActivePage(1);
      return;
    }

    if (!activeDocumentId || !documents.some((document) => document.id === activeDocumentId)) {
      setActiveDocumentId(documents[0]!.id);
    }
  }, [documents, activeDocumentId]);

  useEffect(() => {
    if (activeDocument && activePage > activeDocument.pageCount) {
      setActivePage(1);
    }
  }, [activeDocument, activePage]);

  useEffect(() => {
    if (activeTab !== "ordering" || !activeDocument || !previewCanvasRef.current) {
      return;
    }

    let cancelled = false;

    const renderPreview = async () => {
      setPreview((current) => ({ ...current, isRendering: true, error: null }));

      try {
        const canvas = await renderPdfPage(activeDocument.bytes, activePage - 1, 1.2);

        if (cancelled || !previewCanvasRef.current) {
          return;
        }

        previewCanvasRef.current.width = canvas.width;
        previewCanvasRef.current.height = canvas.height;
        const context = previewCanvasRef.current.getContext("2d");

        if (!context) {
          throw new Error("Canvas rendering is unavailable.");
        }

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(canvas, 0, 0);
        setPreview({
          width: canvas.width,
          height: canvas.height,
          isRendering: false,
          error: null,
        });
      } catch (error) {
        if (!cancelled) {
          setPreview({
            width: 1,
            height: 1.414,
            isRendering: false,
            error: error instanceof Error ? error.message : "Unable to render that page.",
          });
        }
      }
    };

    void renderPreview();

    return () => {
      cancelled = true;
    };
  }, [activeDocument, activePage, activeTab]);

  async function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const fileList = event.target.files;

    if (!fileList?.length) {
      return;
    }

    setIsUploading(true);

    try {
      const nextDocuments: UploadedPdf[] = [];

      for (const file of Array.from(fileList)) {
        if (file.type !== "application/pdf") {
          continue;
        }

        const inspected = await inspectPdfFile(file);
        nextDocuments.push({
          id: crypto.randomUUID(),
          name: file.name,
          file,
          bytes: inspected.bytes,
          pageCount: inspected.pageCount,
          sizeBytes: file.size,
          previewUrl: inspected.previewUrl,
        });
      }

      if (nextDocuments.length > 0) {
        startTransition(() => {
          setDocuments((current) => [...current, ...nextDocuments]);
        });
        setBundleMessage("Initial batch loaded. Move to Ordering when you're ready.");
      }
    } catch (error) {
      setBundleMessage(error instanceof Error ? error.message : "Unable to load the selected PDFs.");
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  }

  function moveDocument(documentId: string, direction: -1 | 1) {
    startTransition(() => {
      setDocuments((current) => {
        const currentIndex = current.findIndex((document) => document.id === documentId);
        const targetIndex = currentIndex + direction;

        if (currentIndex < 0 || targetIndex < 0 || targetIndex >= current.length) {
          return current;
        }

        const next = [...current];
        const [moved] = next.splice(currentIndex, 1);
        next.splice(targetIndex, 0, moved!);
        return next;
      });
    });
  }

  function reorderDocuments(sourceId: string, targetId: string) {
    if (sourceId === targetId) {
      return;
    }

    startTransition(() => {
      setDocuments((current) => {
        const sourceIndex = current.findIndex((document) => document.id === sourceId);
        const targetIndex = current.findIndex((document) => document.id === targetId);

        if (sourceIndex < 0 || targetIndex < 0) {
          return current;
        }

        const next = [...current];
        const [moved] = next.splice(sourceIndex, 1);
        next.splice(targetIndex, 0, moved!);
        return next;
      });
    });
  }

  async function handleRunOcr() {
    if (!activeDocument) {
      return;
    }

    try {
      const pageIndexes = parsePageRange(ocrPageRange, activeDocument.pageCount);
      setOcrState({
        status: "running",
        progress: 0,
        message: "Preparing extraction...",
        text: "",
        source: null,
        error: null,
      });

      const result = await extractPdfText({
        bytes: activeDocument.bytes,
        pageIndexes,
        mode: ocrMode,
        onProgress: (progress, message) => {
          setOcrState((current) => ({
            ...current,
            progress,
            message,
          }));
        },
      });

      setOcrState({
        status: "complete",
        progress: 1,
        message: `Extraction complete via ${result.source === "mixed" ? "mixed sources" : result.source}.`,
        text: result.text,
        source: result.source,
        error: null,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "OCR could not start. Verify the local language data is available.";

      setOcrState({
        status: "error",
        progress: 0,
        message,
        text: "",
        source: null,
        error: message,
      });
    }
  }

  async function handleExportBundle() {
    if (documents.length === 0) {
      return;
    }

    setIsBundling(true);
    setBundleProgress(0);
    setBundleMessage("Starting PDF assembly...");

    try {
      const bytes = await buildBundle({
        documents,
        redactions,
        coverSettings,
        pagination,
        onProgress: (progress, message) => {
          setBundleProgress(progress);
          setBundleMessage(message);
        },
      });

      const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${slugify(coverSettings.title) || "dossier-builder-export"}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
      setBundleMessage("Bundle downloaded successfully.");
    } catch (error) {
      setBundleMessage(error instanceof Error ? error.message : "Unable to build the bundle.");
    } finally {
      setIsBundling(false);
    }
  }

  function handlePreviewPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!activeDocument || event.button !== 0) {
      return;
    }

    const point = eventToNormalizedPoint(event);
    dragStartRef.current = point;
    setDraftRect({
      id: "draft",
      ...rectFromPoints(point, point),
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePreviewPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current) {
      return;
    }

    setDraftRect({
      id: "draft",
      ...rectFromPoints(dragStartRef.current, eventToNormalizedPoint(event)),
    });
  }

  function handlePreviewPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!activeDocument || !dragStartRef.current) {
      return;
    }

    const rect = rectFromPoints(dragStartRef.current, eventToNormalizedPoint(event));
    dragStartRef.current = null;
    setDraftRect(null);
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (rect.width < 0.02 || rect.height < 0.02) {
      return;
    }

    setRedactions((current) => ({
      ...current,
      [activeDocument.id]: {
        ...(current[activeDocument.id] ?? {}),
        [activePage - 1]: [...(current[activeDocument.id]?.[activePage - 1] ?? []), { ...rect, id: crypto.randomUUID() }],
      },
    }));
  }

  function handleClearPageRedactions() {
    if (!activeDocument) {
      return;
    }

    setRedactions((current) => {
      const next = { ...(current[activeDocument.id] ?? {}) };
      delete next[activePage - 1];

      return {
        ...current,
        [activeDocument.id]: next,
      };
    });
  }

  function handleDeleteRedaction(rectId: string) {
    if (!activeDocument) {
      return;
    }

    setRedactions((current) => ({
      ...current,
      [activeDocument.id]: {
        ...(current[activeDocument.id] ?? {}),
        [activePage - 1]: (current[activeDocument.id]?.[activePage - 1] ?? []).filter(
          (rect) => rect.id !== rectId,
        ),
      },
    }));
  }

  function downloadOcrText() {
    if (!activeDocument || !ocrState.text) {
      return;
    }

    const blob = new Blob([ocrState.text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${slugify(activeDocument.name.replace(/\.pdf$/i, "")) || "ocr-output"}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const tabsUnlocked = documents.length > 0;

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Locked-down friendly local workspace</p>
          <h1>Dossier Builder</h1>
          <p className="hero-copy">
            Upload a batch of PDFs, sequence them, design a cover page, burn in any redactions,
            and export a numbered bundle without sending files to a server.
          </p>
        </div>

        <div className="hero-metrics" aria-label="Bundle summary">
          <div>
            <span>Documents</span>
            <strong>{documents.length}</strong>
          </div>
          <div>
            <span>Pages</span>
            <strong>{totalPages}</strong>
          </div>
          <div>
            <span>Redactions</span>
            <strong>{totalRedactions}</strong>
          </div>
        </div>
      </header>

      <section className="status-strip">
        <div>
          <strong>Security model:</strong> files stay in the browser, OCR can run against a local
          language file, and only redacted pages are rasterized to guarantee burn-in coverage.
        </div>
        <div>
          <strong>Current batch size:</strong> {formatBytes(totalSizeBytes)}
        </div>
      </section>

      <nav className="tab-nav" aria-label="Bundle workflow">
        {TAB_ORDER.map((tab) => {
          const disabled = !tabsUnlocked && tab.id !== "upload";

          return (
            <button
              key={tab.id}
              type="button"
              className={`tab-pill ${activeTab === tab.id ? "is-active" : ""}`}
              disabled={disabled}
              onClick={() => setActiveTab(tab.id)}
            >
              <span>{tab.label}</span>
              <small>{tab.blurb}</small>
            </button>
          );
        })}
      </nav>

      <main className="workspace">
        {activeTab === "upload" && (
          <section className="workspace-grid workspace-grid--upload">
            <div className="panel panel--feature">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Start here</p>
                  <h2>Initial batch intake</h2>
                </div>
                <label className="button button--primary file-picker">
                  {isUploading ? "Reading PDFs..." : "Upload PDFs"}
                  <input
                    type="file"
                    accept="application/pdf"
                    multiple
                    onChange={handleFilesSelected}
                  />
                </label>
              </div>

              <div className="dropzone">
                <div>
                  <strong>Bring in the first batch of PDFs.</strong>
                  <p>
                    Add as many source PDFs as you need. Once they are loaded you can switch to the
                    Ordering tab to drag them into the final sequence.
                  </p>
                </div>
                <ul className="checklist">
                  <li>No server round-trips required.</li>
                  <li>OCR text can be exported as plain text for review.</li>
                  <li>Redacted pages are rebuilt as images to avoid hidden text leakage.</li>
                </ul>
              </div>

              <div className="manifest">
                {documents.length === 0 ? (
                  <p className="empty-state">No PDFs loaded yet.</p>
                ) : (
                  documents.map((document, index) => (
                    <button
                      key={document.id}
                      type="button"
                      className={`manifest-item ${activeDocumentId === document.id ? "is-selected" : ""}`}
                      onClick={() => setActiveDocumentId(document.id)}
                    >
                      <img src={document.previewUrl} alt="" />
                      <div>
                        <strong>
                          {index + 1}. {document.name}
                        </strong>
                        <span>
                          {document.pageCount} pages | {formatBytes(document.sizeBytes)}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">OCR desk</p>
                  <h2>Text capture</h2>
                </div>
              </div>

              {activeDocument ? (
                <div className="stack">
                  <div className="field-row">
                    <label>
                      <span>Document</span>
                      <strong>{activeDocument.name}</strong>
                    </label>
                  </div>

                  <div className="field-grid">
                    <label>
                      <span>Extraction mode</span>
                      <select
                        value={ocrMode}
                        onChange={(event) => setOcrMode(event.target.value as "auto" | "ocr")}
                      >
                        <option value="auto">Prefer embedded text, OCR as fallback</option>
                        <option value="ocr">Force OCR on every requested page</option>
                      </select>
                    </label>

                    <label>
                      <span>Page range</span>
                      <input
                        value={ocrPageRange}
                        onChange={(event) => setOcrPageRange(event.target.value)}
                        placeholder="all or 1-5, 9"
                      />
                    </label>
                  </div>

                  <div className="button-row">
                    <button type="button" className="button button--primary" onClick={handleRunOcr}>
                      {ocrState.status === "running" ? "Processing..." : "Run extraction"}
                    </button>
                    <button
                      type="button"
                      className="button"
                      disabled={!ocrState.text}
                      onClick={downloadOcrText}
                    >
                      Download text
                    </button>
                  </div>

                  <div className="progress-shell" aria-label="OCR progress">
                    <div className="progress-bar" style={{ width: `${ocrState.progress * 100}%` }} />
                  </div>
                  <p className="helper-text">{ocrState.message}</p>

                  <label className="textarea-shell">
                    <span>Captured text</span>
                    <textarea
                      readOnly
                      value={deferredOcrText}
                      placeholder="OCR output will appear here."
                    />
                  </label>
                </div>
              ) : (
                <p className="empty-state">
                  Choose a PDF from the intake list to run text extraction or OCR.
                </p>
              )}
            </div>
          </section>
        )}

        {activeTab === "ordering" && (
          <section className="workspace-grid workspace-grid--ordering">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Sequence lane</p>
                  <h2>Drag the bundle into order</h2>
                </div>
              </div>

              <div className="ordering-list">
                {documents.map((document, index) => (
                  <div
                    key={document.id}
                    className={`ordering-item ${activeDocumentId === document.id ? "is-selected" : ""}`}
                    draggable
                    onDragStart={() => setDraggedDocumentId(document.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (draggedDocumentId) {
                        reorderDocuments(draggedDocumentId, document.id);
                        setDraggedDocumentId(null);
                      }
                    }}
                  >
                    <button type="button" className="ordering-main" onClick={() => setActiveDocumentId(document.id)}>
                      <span className="ordering-index">{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <strong>{document.name}</strong>
                        <small>{document.pageCount} pages</small>
                      </div>
                    </button>

                    <div className="ordering-actions">
                      <button type="button" className="button" onClick={() => moveDocument(document.id, -1)}>
                        Up
                      </button>
                      <button type="button" className="button" onClick={() => moveDocument(document.id, 1)}>
                        Down
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel panel--preview">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Redaction studio</p>
                  <h2>Burn in sensitive areas</h2>
                </div>
              </div>

              {activeDocument ? (
                <div className="stack">
                  <div className="field-grid field-grid--compact">
                    <label>
                      <span>Selected PDF</span>
                      <strong>{activeDocument.name}</strong>
                    </label>

                    <label>
                      <span>Page</span>
                      <div className="page-controls">
                        <button
                          type="button"
                          className="button"
                          onClick={() => setActivePage((page) => Math.max(1, page - 1))}
                        >
                          Prev
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={activeDocument.pageCount}
                          value={activePage}
                          onChange={(event) =>
                            setActivePage(clampNumber(Number.parseInt(event.target.value, 10), 1, activeDocument.pageCount))
                          }
                        />
                        <button
                          type="button"
                          className="button"
                          onClick={() =>
                            setActivePage((page) => Math.min(activeDocument.pageCount, page + 1))
                          }
                        >
                          Next
                        </button>
                      </div>
                    </label>
                  </div>

                  <div
                    className="preview-surface"
                    style={{ ["--preview-ratio" as string]: `${preview.width} / ${preview.height}` }}
                  >
                    <div
                      className="preview-stage"
                      onPointerDown={handlePreviewPointerDown}
                      onPointerMove={handlePreviewPointerMove}
                      onPointerUp={handlePreviewPointerUp}
                    >
                      <canvas ref={previewCanvasRef} />

                      {currentPageRedactions.map((rect) => (
                        <button
                          key={rect.id}
                          type="button"
                          className="redaction-box"
                          style={redactionStyle(rect)}
                          onClick={() => handleDeleteRedaction(rect.id)}
                          title="Remove this redaction block"
                        />
                      ))}

                      {draftRect ? (
                        <div className="redaction-box redaction-box--draft" style={redactionStyle(draftRect)} />
                      ) : null}

                      {preview.isRendering ? <div className="preview-overlay">Rendering page...</div> : null}
                      {preview.error ? <div className="preview-overlay">{preview.error}</div> : null}
                    </div>
                  </div>

                  <div className="button-row">
                    <button type="button" className="button button--primary" onClick={handleClearPageRedactions}>
                      Clear page redactions
                    </button>
                    <span className="helper-text">
                      Drag across the preview to add a burn-in redaction area. Click an existing box
                      to remove it.
                    </span>
                  </div>
                </div>
              ) : (
                <p className="empty-state">Add PDFs first to unlock ordering and redaction.</p>
              )}
            </div>
          </section>
        )}

        {activeTab === "cover" && (
          <section className="workspace-grid workspace-grid--cover">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Cover settings</p>
                  <h2>Front page composer</h2>
                </div>
              </div>

              <div className="field-grid">
                <label>
                  <span>Bundle title</span>
                  <input
                    value={coverSettings.title}
                    onChange={(event) =>
                      setCoverSettings((current) => ({ ...current, title: event.target.value }))
                    }
                  />
                </label>

                <label>
                  <span>Subtitle</span>
                  <input
                    value={coverSettings.subtitle}
                    onChange={(event) =>
                      setCoverSettings((current) => ({ ...current, subtitle: event.target.value }))
                    }
                  />
                </label>

                <label>
                  <span>Reference</span>
                  <input
                    value={coverSettings.reference}
                    onChange={(event) =>
                      setCoverSettings((current) => ({ ...current, reference: event.target.value }))
                    }
                  />
                </label>

                <label>
                  <span>Prepared for</span>
                  <input
                    value={coverSettings.preparedFor}
                    onChange={(event) =>
                      setCoverSettings((current) => ({ ...current, preparedFor: event.target.value }))
                    }
                  />
                </label>

                <label>
                  <span>Prepared by</span>
                  <input
                    value={coverSettings.preparedBy}
                    onChange={(event) =>
                      setCoverSettings((current) => ({ ...current, preparedBy: event.target.value }))
                    }
                  />
                </label>

                <label>
                  <span>Accent colour</span>
                  <input
                    type="color"
                    value={coverSettings.accentColor}
                    onChange={(event) =>
                      setCoverSettings((current) => ({ ...current, accentColor: event.target.value }))
                    }
                  />
                </label>

                <label>
                  <span>Theme</span>
                  <select
                    value={coverSettings.theme}
                    onChange={(event) =>
                      setCoverSettings((current) => ({
                        ...current,
                        theme: event.target.value as CoverSettings["theme"],
                      }))
                    }
                  >
                    <option value="ink">Ink archive</option>
                    <option value="marine">Marine registry</option>
                    <option value="copper">Copper ledger</option>
                  </select>
                </label>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={coverSettings.includeManifest}
                    onChange={(event) =>
                      setCoverSettings((current) => ({
                        ...current,
                        includeManifest: event.target.checked,
                      }))
                    }
                  />
                  <span>Include a manifest of uploaded PDFs</span>
                </label>
              </div>

              <label className="textarea-shell">
                <span>Cover note</span>
                <textarea
                  value={coverSettings.notes}
                  onChange={(event) =>
                    setCoverSettings((current) => ({ ...current, notes: event.target.value }))
                  }
                />
              </label>
            </div>

            <div className={`cover-preview cover-preview--${coverSettings.theme}`}>
              <div className="cover-preview__accent" style={{ backgroundColor: coverSettings.accentColor }} />
              <p>BUNDLE DOSSIER</p>
              <h2>{coverSettings.title || "Untitled PDF Bundle"}</h2>
              <h3>{coverSettings.subtitle}</h3>
              <dl>
                <div>
                  <dt>Reference</dt>
                  <dd>{coverSettings.reference || "Not supplied"}</dd>
                </div>
                <div>
                  <dt>Prepared for</dt>
                  <dd>{coverSettings.preparedFor || "Internal use"}</dd>
                </div>
                <div>
                  <dt>Prepared by</dt>
                  <dd>{coverSettings.preparedBy || "Document operations"}</dd>
                </div>
                <div>
                  <dt>Manifest</dt>
                  <dd>{coverSettings.includeManifest ? "Included" : "Hidden"}</dd>
                </div>
              </dl>
              <p className="cover-preview__note">{coverSettings.notes}</p>
            </div>
          </section>
        )}

        {activeTab === "pagination" && (
          <section className="workspace-grid workspace-grid--pagination">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Numbering rules</p>
                  <h2>Pagination and export</h2>
                </div>
              </div>

              <div className="field-grid">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={pagination.enabled}
                    onChange={(event) =>
                      setPagination((current) => ({ ...current, enabled: event.target.checked }))
                    }
                  />
                  <span>Stamp page numbers on the final bundle</span>
                </label>

                <label>
                  <span>Start number</span>
                  <input
                    type="number"
                    min={1}
                    value={pagination.startNumber}
                    onChange={(event) =>
                      setPagination((current) => ({
                        ...current,
                        startNumber: Math.max(1, Number.parseInt(event.target.value, 10) || 1),
                      }))
                    }
                  />
                </label>

                <label>
                  <span>Prefix</span>
                  <input
                    value={pagination.prefix}
                    onChange={(event) =>
                      setPagination((current) => ({ ...current, prefix: event.target.value }))
                    }
                    placeholder="A-"
                  />
                </label>

                <label>
                  <span>Placement</span>
                  <select
                    value={pagination.position}
                    onChange={(event) =>
                      setPagination((current) => ({
                        ...current,
                        position: event.target.value as PaginationSettings["position"],
                      }))
                    }
                  >
                    <option value="footer-right">Footer right</option>
                    <option value="footer-center">Footer center</option>
                    <option value="header-right">Header right</option>
                  </select>
                </label>

                <label>
                  <span>Font size</span>
                  <input
                    type="number"
                    min={8}
                    max={24}
                    value={pagination.fontSize}
                    onChange={(event) =>
                      setPagination((current) => ({
                        ...current,
                        fontSize: clampNumber(Number.parseInt(event.target.value, 10) || 10, 8, 24),
                      }))
                    }
                  />
                </label>

                <label>
                  <span>Margin</span>
                  <input
                    type="number"
                    min={12}
                    max={64}
                    value={pagination.margin}
                    onChange={(event) =>
                      setPagination((current) => ({
                        ...current,
                        margin: clampNumber(Number.parseInt(event.target.value, 10) || 28, 12, 64),
                      }))
                    }
                  />
                </label>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={pagination.skipCover}
                    onChange={(event) =>
                      setPagination((current) => ({
                        ...current,
                        skipCover: event.target.checked,
                      }))
                    }
                  />
                  <span>Start numbering after the generated cover page</span>
                </label>
              </div>

              <div className="sample-strip">
                Sample label: <strong>{`${pagination.prefix}${pagination.startNumber}`}</strong>
              </div>
            </div>

            <div className="panel panel--export">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Final assembly</p>
                  <h2>Export the bundle</h2>
                </div>
              </div>

              <ul className="summary-list">
                <li>{documents.length} PDFs queued</li>
                <li>{totalPages} source pages</li>
                <li>{totalRedactions} redaction overlays</li>
                <li>Cover page generated from local form fields</li>
              </ul>

              <div className="progress-shell">
                <div className="progress-bar" style={{ width: `${bundleProgress * 100}%` }} />
              </div>
              <p className="helper-text">{bundleMessage}</p>

              <button
                type="button"
                className="button button--primary button--wide"
                disabled={documents.length === 0 || isBundling}
                onClick={handleExportBundle}
              >
                {isBundling ? "Building bundle..." : "Build and download PDF"}
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function parsePageRange(value: string, maxPages: number) {
  if (!value.trim() || value.trim().toLowerCase() === "all") {
    return Array.from({ length: maxPages }, (_, index) => index);
  }

  const pages = new Set<number>();

  value
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .forEach((segment) => {
      if (segment.includes("-")) {
        const [startRaw, endRaw] = segment.split("-");
        const start = clampNumber(Number.parseInt(startRaw ?? "", 10), 1, maxPages);
        const end = clampNumber(Number.parseInt(endRaw ?? "", 10), 1, maxPages);

        for (let page = Math.min(start, end); page <= Math.max(start, end); page += 1) {
          pages.add(page - 1);
        }

        return;
      }

      const page = Number.parseInt(segment, 10);

      if (Number.isFinite(page) && page >= 1 && page <= maxPages) {
        pages.add(page - 1);
      }
    });

  if (pages.size === 0) {
    throw new Error("Use a page range like 1-5, 9 or all.");
  }

  return [...pages].sort((left, right) => left - right);
}

function eventToNormalizedPoint(event: PointerEvent<HTMLDivElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();

  return {
    x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
    y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
  };
}

function rectFromPoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
): Omit<RedactionRect, "id"> {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(start.x - end.x),
    height: Math.abs(start.y - end.y),
  };
}

function redactionStyle(rect: Omit<RedactionRect, "id">) {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  };
}

function formatBytes(bytes: number) {
  if (!bytes) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampNumber(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  return Math.min(maximum, Math.max(minimum, value));
}

export default App;
