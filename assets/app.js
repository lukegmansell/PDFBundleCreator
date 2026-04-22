(() => {
  "use strict";

  const initialStatus =
    "Add PDF files to begin. The app merges locally and uses the bundled English OCR model when requested.";

  const state = {
    activeTab: "build",
    busy: false,
    documents: [],
    selectedDocumentId: null,
    reviewPage: 1,
    logs: ["Waiting for the first bundle build."],
    statusTone: "idle",
    statusText: initialStatus,
    cover: {
      title: "",
      subtitle: "",
      reference: "",
      preparedBy: "",
      note: "",
      includeCover: true,
    },
    pagination: {
      applyPagination: true,
      prefix: "",
      startNumber: 1,
      position: "bottom-right",
      ocrMode: "auto",
      includeIndexPage: false,
      outputFilename: "bundle-builder.pdf",
    },
    theme: "dark",
    output: {
      url: "",
      filename: "",
      summary: "",
      ocrPages: 0,
    },
    currentOcrLabel: "",
    reviewRenderToken: 0,
    dragDocumentId: null,
  };

  const elements = {
    metricDocuments: document.getElementById("metricDocuments"),
    metricPages: document.getElementById("metricPages"),
    metricOcrMode: document.getElementById("metricOcrMode"),
    statusBadge: document.getElementById("statusBadge"),
    statusText: document.getElementById("statusText"),
    tabList: document.getElementById("tabList"),
    panels: Array.from(document.querySelectorAll("[data-panel]")),
    tabs: Array.from(document.querySelectorAll("[data-tab]")),
    dropzone: document.getElementById("dropzone"),
    fileInput: document.getElementById("fileInput"),
    clearQueueButton: document.getElementById("clearQueueButton"),
    queueList: document.getElementById("queueList"),
    summaryDocuments: document.getElementById("summaryDocuments"),
    summaryPages: document.getElementById("summaryPages"),
    summaryCover: document.getElementById("summaryCover"),
    summaryOcr: document.getElementById("summaryOcr"),
    reviewList: document.getElementById("reviewList"),
    reviewDocName: document.getElementById("reviewDocName"),
    reviewBundlePosition: document.getElementById("reviewBundlePosition"),
    reviewDocPages: document.getElementById("reviewDocPages"),
    reviewHeaderStatus: document.getElementById("reviewHeaderStatus"),
    reviewTextLayerStatus: document.getElementById("reviewTextLayerStatus"),
    reviewPrevPageButton: document.getElementById("reviewPrevPageButton"),
    reviewNextPageButton: document.getElementById("reviewNextPageButton"),
    reviewPageIndicator: document.getElementById("reviewPageIndicator"),
    reviewCanvasWrap: document.getElementById("reviewCanvasWrap"),
    reviewEmptyState: document.getElementById("reviewEmptyState"),
    reviewCanvas: document.getElementById("reviewCanvas"),
    coverTitle: document.getElementById("coverTitle"),
    coverSubtitle: document.getElementById("coverSubtitle"),
    coverReference: document.getElementById("coverReference"),
    coverPreparedBy: document.getElementById("coverPreparedBy"),
    coverNote: document.getElementById("coverNote"),
    includeCover: document.getElementById("includeCover"),
    coverPreviewTitle: document.getElementById("coverPreviewTitle"),
    coverPreviewSubtitle: document.getElementById("coverPreviewSubtitle"),
    coverPreviewReference: document.getElementById("coverPreviewReference"),
    coverPreviewPreparedBy: document.getElementById("coverPreviewPreparedBy"),
    coverPreviewDocumentCount: document.getElementById("coverPreviewDocumentCount"),
    coverPreviewPageCount: document.getElementById("coverPreviewPageCount"),
    coverPreviewNote: document.getElementById("coverPreviewNote"),
    pagePrefix: document.getElementById("pagePrefix"),
    pageStart: document.getElementById("pageStart"),
    pagePosition: document.getElementById("pagePosition"),
    applyPagination: document.getElementById("applyPagination"),
    ocrMode: document.getElementById("ocrMode"),
    includeIndexPage: document.getElementById("includeIndexPage"),
    outputFilename: document.getElementById("outputFilename"),
    themeToggle: document.getElementById("themeToggle"),
    buildBundleButton: document.getElementById("buildBundleButton"),
    exportSummaryText: document.getElementById("exportSummaryText"),
    downloadLink: document.getElementById("downloadLink"),
    openLink: document.getElementById("openLink"),
    resultPreview: document.getElementById("resultPreview"),
    logOutput: document.getElementById("logOutput"),
  };

  const ocrRuntime = {
    workerPath: new URL("./runtime/tesseract/local-worker-bootstrap.js", window.location.href).toString(),
    corePath: new URL("./runtime/tesseract-core/tesseract-core-lstm.wasm.js", window.location.href).toString(),
    langPath: new URL("./runtime/tessdata/", window.location.href).toString(),
    // Chromium blocks direct file:// worker scripts from local file pages.
    // Let Tesseract bootstrap the worker through a blob URL instead.
    workerBlobURL: true,
  };

  if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "./libs/pdf.worker.min.js",
      window.location.href,
    ).toString();
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `doc-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return "0 B";
    }

    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    const fixed = value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1);
    return `${fixed} ${units[unitIndex]}`;
  }

  function formatDate(value) {
    if (!Number.isFinite(value)) {
      return "Unknown date";
    }

    return new Date(value).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function formatCount(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  function setStatus(tone, text) {
    state.statusTone = tone;
    state.statusText = text;
    elements.statusBadge.dataset.tone = tone;
    elements.statusBadge.textContent = tone.charAt(0).toUpperCase() + tone.slice(1);
    elements.statusText.textContent = text;
  }

  function addLog(text) {
    const timestamp = new Date().toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    state.logs.unshift(`[${timestamp}] ${text}`);
    elements.logOutput.textContent = state.logs.join("\n");
  }

  function resetLogs() {
    state.logs = [];
    addLog("Bundle build started.");
  }

  function setBusy(isBusy) {
    state.busy = isBusy;
    elements.fileInput.disabled = isBusy;
    elements.clearQueueButton.disabled = isBusy || state.documents.length === 0;
    elements.buildBundleButton.disabled = isBusy || state.documents.length === 0;
  }

  function getTotalPages() {
    return state.documents.reduce((sum, documentRecord) => sum + (documentRecord.pageCount || 0), 0);
  }

  function getSelectedDocument() {
    return state.documents.find((documentRecord) => documentRecord.id === state.selectedDocumentId) || null;
  }

  function getSelectedDocumentIndex() {
    return state.documents.findIndex((documentRecord) => documentRecord.id === state.selectedDocumentId);
  }

  function normalizeFilename(filename) {
    const trimmed = (filename || "").trim() || "bundle-builder";
    return trimmed.toLowerCase().endsWith(".pdf") ? trimmed : `${trimmed}.pdf`;
  }

  function syncCoverFromInputs() {
    state.cover.title = elements.coverTitle.value.trim();
    state.cover.subtitle = elements.coverSubtitle.value.trim();
    state.cover.reference = elements.coverReference.value.trim();
    state.cover.preparedBy = elements.coverPreparedBy.value.trim();
    state.cover.note = elements.coverNote.value.trim();
    state.cover.includeCover = elements.includeCover.checked;
  }

  function syncPaginationFromInputs() {
    const parsedStart = Number.parseInt(elements.pageStart.value, 10);
    state.pagination.applyPagination = elements.applyPagination.checked;
    state.pagination.prefix = elements.pagePrefix.value.trim();
    state.pagination.startNumber = Number.isFinite(parsedStart) && parsedStart > 0 ? parsedStart : 1;
    state.pagination.position = elements.pagePosition.value;
    state.pagination.ocrMode = elements.ocrMode.value;
    state.pagination.includeIndexPage = elements.includeIndexPage.checked;
    state.pagination.outputFilename = elements.outputFilename.value.trim() || "bundle-builder.pdf";
  }

  function syncFormState() {
    syncCoverFromInputs();
    syncPaginationFromInputs();
  }

  function updateSummary() {
    syncFormState();

    const documentCount = state.documents.length;
    const totalPages = getTotalPages();
    const ocrLabels = {
      auto: "Auto",
      all: "All pages",
      off: "Off",
    };

    elements.metricDocuments.textContent = String(documentCount);
    elements.metricPages.textContent = String(totalPages);
    elements.metricOcrMode.textContent = ocrLabels[state.pagination.ocrMode] || "Auto";

    elements.summaryDocuments.textContent = `${formatCount(documentCount, "document", "documents")} queued`;
    elements.summaryPages.textContent = `${formatCount(totalPages, "page", "pages")}`;
    elements.summaryCover.textContent = state.cover.includeCover ? "Included at export" : "Not included";
    elements.summaryOcr.textContent = {
      auto: "Auto-detect scanned pages",
      all: "OCR every page",
      off: "OCR disabled",
    }[state.pagination.ocrMode];

    elements.coverPreviewTitle.textContent = state.cover.title;
    elements.coverPreviewSubtitle.textContent = state.cover.subtitle;
    elements.coverPreviewReference.textContent = state.cover.reference;
    elements.coverPreviewPreparedBy.textContent = state.cover.preparedBy;
    elements.coverPreviewDocumentCount.textContent = `${formatCount(
      documentCount,
      "document",
      "documents",
    )} queued`;
    elements.coverPreviewPageCount.textContent = `${formatCount(totalPages, "page", "pages")}`;
    elements.coverPreviewNote.textContent = state.cover.note;
    elements.coverPreviewNote.hidden = !state.cover.note;
  }

  function setTheme(theme) {
    const nextTheme = theme === "light" ? "light" : "dark";
    state.theme = nextTheme;
    document.documentElement.dataset.theme = nextTheme;
    elements.themeToggle.textContent = nextTheme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    elements.themeToggle.setAttribute("aria-pressed", String(nextTheme === "light"));

    try {
      window.localStorage.setItem("bundleBuilderTheme", nextTheme);
    } catch (error) {
      console.warn("Could not persist theme preference.", error);
    }
  }

  function loadThemePreference() {
    try {
      const savedTheme = window.localStorage.getItem("bundleBuilderTheme");
      if (savedTheme === "light" || savedTheme === "dark") {
        setTheme(savedTheme);
        return;
      }
    } catch (error) {
      console.warn("Could not read theme preference.", error);
    }

    setTheme("dark");
  }

  function switchTab(nextTab) {
    state.activeTab = nextTab;

    elements.tabs.forEach((tab) => {
      const isActive = tab.dataset.tab === nextTab;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    elements.panels.forEach((panel) => {
      panel.hidden = panel.dataset.panel !== nextTab;
    });

    if (nextTab === "review") {
      renderReviewPage();
    }
  }

  function isPdfLike(file) {
    return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  }

  function bytesStartWithPdfSignature(bytes) {
    const header = new TextDecoder("ascii").decode(bytes.slice(0, 5));
    return header === "%PDF-";
  }

  async function destroyPdfProxy(documentRecord) {
    if (documentRecord && documentRecord.pdfProxy && typeof documentRecord.pdfProxy.destroy === "function") {
      try {
        await documentRecord.pdfProxy.destroy();
      } catch (error) {
        console.warn("Could not destroy PDF proxy.", error);
      }
    }
    documentRecord.pdfProxy = null;
    documentRecord.pdfProxyPromise = null;
  }

  async function getPdfProxy(documentRecord) {
    if (documentRecord.pdfProxy) {
      return documentRecord.pdfProxy;
    }

    if (!documentRecord.pdfProxyPromise) {
      const task = window.pdfjsLib.getDocument({
        data: documentRecord.bytes.slice(),
        useWorkerFetch: false,
        isEvalSupported: false,
        disableAutoFetch: true,
        disableRange: true,
      });

      documentRecord.pdfProxyPromise = task.promise.then((pdfProxy) => {
        documentRecord.pdfProxy = pdfProxy;
        documentRecord.pageCount = pdfProxy.numPages;
        return pdfProxy;
      });
    }

    return documentRecord.pdfProxyPromise;
  }

  async function detectTextLayer(documentRecord, pageNumber) {
    const cacheKey = String(pageNumber);

    if (documentRecord.textLayerCache.has(cacheKey)) {
      return documentRecord.textLayerCache.get(cacheKey);
    }

    const pdfProxy = await getPdfProxy(documentRecord);
    const page = await pdfProxy.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const hasText = textContent.items.some((item) => String(item.str || "").trim().length > 0);
    page.cleanup();
    documentRecord.textLayerCache.set(cacheKey, hasText);
    return hasText;
  }

  async function buildDocumentRecord(file) {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    if (!bytesStartWithPdfSignature(bytes)) {
      throw new Error(`${file.name} does not look like a valid PDF file.`);
    }

    const documentRecord = {
      id: createId(),
      key: `${file.name}-${file.size}-${file.lastModified}`,
      file,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      bytes,
      headerValid: true,
      pageCount: 0,
      pdfProxy: null,
      pdfProxyPromise: null,
      textLayerCache: new Map(),
    };

    const pdfProxy = await getPdfProxy(documentRecord);
    documentRecord.pageCount = pdfProxy.numPages;
    return documentRecord;
  }

  function renderQueueList() {
    elements.queueList.textContent = "";

    if (state.documents.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = "No PDFs queued.";
      elements.queueList.appendChild(empty);
      return;
    }

    state.documents.forEach((documentRecord, index) => {
      const item = document.createElement("li");
      item.className = `queue-item${documentRecord.id === state.selectedDocumentId ? " is-selected" : ""}`;

      const mainButton = document.createElement("button");
      mainButton.type = "button";
      mainButton.className = "queue-main";
      mainButton.addEventListener("click", () => {
        state.selectedDocumentId = documentRecord.id;
        state.reviewPage = 1;
        renderQueueList();
        renderReviewList();
        renderReviewPage();
      });

      const title = document.createElement("strong");
      title.textContent = `${index + 1}. ${documentRecord.name}`;

      const meta = document.createElement("small");
      meta.textContent = `${formatCount(
        documentRecord.pageCount,
        "page",
        "pages",
      )} | ${formatBytes(documentRecord.size)} | Added ${formatDate(documentRecord.lastModified)}`;

      mainButton.appendChild(title);
      mainButton.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "mini-actions";

      const moveUpButton = document.createElement("button");
      moveUpButton.type = "button";
      moveUpButton.className = "mini-button";
      moveUpButton.textContent = "Move up";
      moveUpButton.disabled = state.busy || index === 0;
      moveUpButton.addEventListener("click", () => moveDocument(index, -1));

      const moveDownButton = document.createElement("button");
      moveDownButton.type = "button";
      moveDownButton.className = "mini-button";
      moveDownButton.textContent = "Move down";
      moveDownButton.disabled = state.busy || index === state.documents.length - 1;
      moveDownButton.addEventListener("click", () => moveDocument(index, 1));

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "mini-button";
      removeButton.textContent = "Remove";
      removeButton.disabled = state.busy;
      removeButton.addEventListener("click", () => removeDocument(documentRecord.id));

      actions.appendChild(moveUpButton);
      actions.appendChild(moveDownButton);
      actions.appendChild(removeButton);

      item.appendChild(mainButton);
      item.appendChild(actions);
      elements.queueList.appendChild(item);
    });
  }

  function renderReviewList() {
    state.dragDocumentId = null;
    elements.reviewList.textContent = "";

    if (state.documents.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = "Add PDFs in Build Bundle before opening review.";
      elements.reviewList.appendChild(empty);
      return;
    }

    state.documents.forEach((documentRecord, index) => {
      const item = document.createElement("li");
      item.className = `review-item${documentRecord.id === state.selectedDocumentId ? " is-selected" : ""}`;
      item.draggable = !state.busy;
      item.dataset.documentId = documentRecord.id;

      item.addEventListener("dragstart", (event) => {
        if (state.busy) {
          event.preventDefault();
          return;
        }

        state.dragDocumentId = documentRecord.id;
        item.classList.add("is-dragging");

        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", documentRecord.id);
        }
      });

      item.addEventListener("dragover", (event) => {
        if (!state.dragDocumentId || state.dragDocumentId === documentRecord.id) {
          return;
        }

        event.preventDefault();
        item.classList.add("is-drop-target");

        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
      });

      item.addEventListener("dragleave", () => {
        item.classList.remove("is-drop-target");
      });

      item.addEventListener("drop", (event) => {
        event.preventDefault();

        const draggedDocumentId = state.dragDocumentId;
        const fromIndex = state.documents.findIndex((record) => record.id === state.dragDocumentId);
        const toIndex = state.documents.findIndex((record) => record.id === documentRecord.id);

        if (draggedDocumentId) {
          state.selectedDocumentId = draggedDocumentId;
        }

        clearReviewDragState();
        reorderDocuments(fromIndex, toIndex);
      });

      item.addEventListener("dragend", () => {
        clearReviewDragState();
      });

      const button = document.createElement("button");
      button.type = "button";
      button.className = "review-main";
      button.addEventListener("click", () => {
        state.selectedDocumentId = documentRecord.id;
        state.reviewPage = 1;
        renderQueueList();
        renderReviewList();
        renderReviewPage();
      });

      const title = document.createElement("strong");
      title.textContent = `${index + 1}. ${documentRecord.name}`;

      const meta = document.createElement("small");
      meta.textContent = `${formatCount(
        documentRecord.pageCount,
        "page",
        "pages",
      )} | ${formatBytes(documentRecord.size)}`;

      button.appendChild(title);
      button.appendChild(meta);
      item.appendChild(button);

      const handle = document.createElement("span");
      handle.className = "review-drag-handle";
      handle.textContent = "Drag";
      handle.setAttribute("aria-hidden", "true");

      item.appendChild(handle);
      elements.reviewList.appendChild(item);
    });
  }

  function renderExportResult() {
    const hasOutput = Boolean(state.output.url);

    elements.exportSummaryText.textContent = hasOutput
      ? state.output.summary
      : "No merged PDF has been built yet.";

    elements.downloadLink.href = hasOutput ? state.output.url : "#";
    elements.downloadLink.download = state.output.filename || "bundle-builder.pdf";
    elements.downloadLink.classList.toggle("is-disabled", !hasOutput);
    elements.downloadLink.setAttribute("aria-disabled", hasOutput ? "false" : "true");

    elements.openLink.href = hasOutput ? state.output.url : "#";
    elements.openLink.classList.toggle("is-disabled", !hasOutput);
    elements.openLink.setAttribute("aria-disabled", hasOutput ? "false" : "true");

    if (hasOutput) {
      elements.resultPreview.hidden = false;
      elements.resultPreview.src = state.output.url;
    } else {
      elements.resultPreview.hidden = true;
      elements.resultPreview.removeAttribute("src");
    }
  }

  function clearReviewDragState() {
    state.dragDocumentId = null;
    elements.reviewList
      .querySelectorAll(".review-item.is-dragging, .review-item.is-drop-target")
      .forEach((item) => item.classList.remove("is-dragging", "is-drop-target"));
  }

  function reorderDocuments(fromIndex, toIndex, statusText = "Queue updated. Review the new order before exporting.") {
    if (state.busy || fromIndex === toIndex) {
      return false;
    }

    if (
      fromIndex < 0 ||
      fromIndex >= state.documents.length ||
      toIndex < 0 ||
      toIndex >= state.documents.length
    ) {
      return false;
    }

    const [documentRecord] = state.documents.splice(fromIndex, 1);
    state.documents.splice(toIndex, 0, documentRecord);
    clearOutput();
    updateSummary();
    renderQueueList();
    renderReviewList();
    renderReviewPage();
    setStatus("idle", statusText);
    return true;
  }

  function renderReviewToolbar() {
    const documentRecord = getSelectedDocument();
    const maxPages = documentRecord ? documentRecord.pageCount : 0;
    const currentPage = documentRecord ? state.reviewPage : 0;

    elements.reviewPrevPageButton.disabled = state.busy || !documentRecord || currentPage <= 1;
    elements.reviewNextPageButton.disabled =
      state.busy || !documentRecord || currentPage >= maxPages;
    elements.reviewPageIndicator.textContent = `Page ${currentPage} of ${maxPages}`;
  }

  async function renderReviewPage() {
    const requestToken = ++state.reviewRenderToken;
    const documentRecord = getSelectedDocument();

    renderReviewToolbar();

    if (!documentRecord) {
      elements.reviewDocName.textContent = "No document selected";
      elements.reviewBundlePosition.textContent = "0 of 0";
      elements.reviewDocPages.textContent = "0";
      elements.reviewHeaderStatus.textContent = "Header check pending";
      elements.reviewTextLayerStatus.textContent = "Select a page";
      elements.reviewCanvas.hidden = true;
      elements.reviewEmptyState.hidden = false;
      elements.reviewEmptyState.textContent = "Select a document from the list to preview a page.";
      return;
    }

    state.reviewPage = Math.min(Math.max(state.reviewPage, 1), documentRecord.pageCount || 1);
    renderReviewToolbar();

    elements.reviewDocName.textContent = documentRecord.name;
    elements.reviewBundlePosition.textContent = `${getSelectedDocumentIndex() + 1} of ${state.documents.length}`;
    elements.reviewDocPages.textContent = String(documentRecord.pageCount);
    elements.reviewHeaderStatus.textContent = documentRecord.headerValid ? "PDF header confirmed" : "Header check failed";
    elements.reviewTextLayerStatus.textContent = "Checking selected page...";

    try {
      const pdfProxy = await getPdfProxy(documentRecord);

      if (requestToken !== state.reviewRenderToken) {
        return;
      }

      const page = await pdfProxy.getPage(state.reviewPage);
      const baseViewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(elements.reviewCanvasWrap.clientWidth - 96, 320);
      const scale = Math.min(2.1, Math.max(0.95, availableWidth / baseViewport.width));
      const viewport = page.getViewport({ scale });

      const canvas = elements.reviewCanvas;
      const context = canvas.getContext("2d", { alpha: false });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);

      await page.render({
        canvasContext: context,
        viewport,
      }).promise;

      page.cleanup();

      if (requestToken !== state.reviewRenderToken) {
        return;
      }

      const hasTextLayer = await detectTextLayer(documentRecord, state.reviewPage);

      if (requestToken !== state.reviewRenderToken) {
        return;
      }

      elements.reviewCanvas.hidden = false;
      elements.reviewEmptyState.hidden = true;
      elements.reviewTextLayerStatus.textContent = hasTextLayer
        ? "Selectable text already detected"
        : "No selectable text detected on this page";
    } catch (error) {
      console.error(error);
      elements.reviewCanvas.hidden = true;
      elements.reviewEmptyState.hidden = false;
      elements.reviewEmptyState.textContent = "The selected PDF page could not be rendered in this browser.";
      elements.reviewTextLayerStatus.textContent = "Preview unavailable";
    }
  }

  function clearOutput() {
    if (state.output.url) {
      URL.revokeObjectURL(state.output.url);
    }

    state.output = {
      url: "",
      filename: "",
      summary: "",
      ocrPages: 0,
    };

    renderExportResult();
  }

  async function clearQueue() {
    const toDispose = state.documents.slice();
    clearReviewDragState();
    state.documents = [];
    state.selectedDocumentId = null;
    state.reviewPage = 1;

    await Promise.all(toDispose.map((documentRecord) => destroyPdfProxy(documentRecord)));
    clearOutput();

    updateSummary();
    renderQueueList();
    renderReviewList();
    renderReviewPage();
    setStatus("idle", initialStatus);
    addLog("Queue cleared.");
  }

  async function removeDocument(documentId) {
    const index = state.documents.findIndex((documentRecord) => documentRecord.id === documentId);

    if (index === -1 || state.busy) {
      return;
    }

    clearReviewDragState();
    const [removedDocument] = state.documents.splice(index, 1);
    await destroyPdfProxy(removedDocument);

    if (state.selectedDocumentId === documentId) {
      state.selectedDocumentId = state.documents[0] ? state.documents[0].id : null;
      state.reviewPage = 1;
    }

    clearOutput();
    updateSummary();
    renderQueueList();
    renderReviewList();
    renderReviewPage();
    elements.clearQueueButton.disabled = state.documents.length === 0;

    if (state.documents.length === 0) {
      setStatus("idle", initialStatus);
    } else {
      setStatus("idle", "Queue updated. Review the new order before exporting.");
    }
  }

  function moveDocument(index, delta) {
    if (state.busy) {
      return;
    }

    const nextIndex = index + delta;
    reorderDocuments(index, nextIndex);
  }

  const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;
  const MAX_TOTAL_SIZE_BYTES = 500 * 1024 * 1024;

  async function addFiles(fileList) {
    const files = Array.from(fileList).filter(isPdfLike);

    if (files.length === 0) {
      setStatus("error", "No PDF files were detected in that selection.");
      return;
    }

    setBusy(true);
    setStatus("processing", "Loading PDF files.");

    const existingKeys = new Set(state.documents.map((documentRecord) => documentRecord.key));
    const addedDocuments = [];
    const failures = [];
    let currentQueuedBytes = state.documents.reduce((sum, documentRecord) => sum + documentRecord.size, 0);

    for (const file of files) {
      const key = `${file.name}-${file.size}-${file.lastModified}`;

      if (existingKeys.has(key)) {
        continue;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        failures.push(`${file.name} is too large (${formatBytes(file.size)}; limit is ${formatBytes(MAX_FILE_SIZE_BYTES)} per file).`);
        continue;
      }

      if (currentQueuedBytes + file.size > MAX_TOTAL_SIZE_BYTES) {
        failures.push(`${file.name} would exceed the ${formatBytes(MAX_TOTAL_SIZE_BYTES)} total queue limit.`);
        continue;
      }

      try {
        const documentRecord = await buildDocumentRecord(file);
        addedDocuments.push(documentRecord);
        existingKeys.add(key);
        currentQueuedBytes += file.size;
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }

    state.documents.push(...addedDocuments);

    if (!state.selectedDocumentId && state.documents[0]) {
      state.selectedDocumentId = state.documents[0].id;
    }

    updateSummary();
    renderQueueList();
    renderReviewList();
    renderReviewPage();
    clearOutput();
    setBusy(false);

    if (addedDocuments.length > 0 && failures.length === 0) {
      setStatus(
        "success",
        `${formatCount(addedDocuments.length, "PDF", "PDFs")} added. Review the queue, then continue through the tabs.`,
      );
      return;
    }

    if (addedDocuments.length > 0 && failures.length > 0) {
      setStatus(
        "error",
        `${formatCount(addedDocuments.length, "PDF", "PDFs")} added, but ${formatCount(
          failures.length,
          "file",
          "files",
        )} could not be loaded.`,
      );
      addLog(failures.join("\n"));
      return;
    }

    if (failures.length === 0) {
      setStatus("error", "Those PDF files are already in the queue.");
      return;
    }

    setStatus("error", failures[0] || "The selected files could not be loaded.");
  }

  function getOcrModeLabel(mode) {
    return {
      auto: "Auto-detect scanned pages",
      all: "OCR every page",
      off: "OCR disabled",
    }[mode];
  }

  function getPaginationLabel(pageNumber) {
    return `${state.pagination.prefix}${pageNumber}`;
  }

  function renderPageNumber(pdfPage, number, bodyFont) {
    const label = getPaginationLabel(number);
    const fontSize = 10;
    const margin = 28;
    const pageSize = pdfPage.getSize();
    const textWidth = bodyFont.widthOfTextAtSize(label, fontSize);
    let x = margin;

    if (state.pagination.position === "bottom-center") {
      x = (pageSize.width - textWidth) / 2;
    } else if (state.pagination.position === "bottom-right") {
      x = pageSize.width - textWidth - margin;
    }

    pdfPage.drawText(label, {
      x,
      y: margin,
      size: fontSize,
      font: bodyFont,
      color: window.PDFLib.rgb(0.11, 0.11, 0.1),
    });
  }

  function renderCoverPage(pdfDoc, coverFonts) {
    const page = pdfDoc.addPage([612, 792]);
    const { width, height } = page.getSize();
    const { titleFont, bodyFont, bodyBoldFont } = coverFonts;
    const totalPages = getTotalPages();

    if (state.cover.title) {
      page.drawText(state.cover.title, {
        x: 48,
        y: height - 128,
        size: 28,
        font: titleFont,
        color: window.PDFLib.rgb(0.11, 0.11, 0.1),
        maxWidth: width - 96,
      });
    }

    if (state.cover.subtitle) {
      page.drawText(state.cover.subtitle, {
        x: 48,
        y: height - 158,
        size: 14,
        font: bodyFont,
        color: window.PDFLib.rgb(0.42, 0.43, 0.45),
        maxWidth: width - 96,
      });
    }

    const metaRows = [
      ["Reference", state.cover.reference],
      ["Prepared by", state.cover.preparedBy],
      ["Prepared", new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })],
      ["Documents", formatCount(state.documents.length, "document", "documents")],
      ["Source pages", formatCount(totalPages, "page", "pages")],
    ];

    let y = height - 232;
    metaRows.forEach(([label, value]) => {
      page.drawText(label.toUpperCase(), {
        x: 48,
        y,
        size: 10,
        font: bodyBoldFont,
        color: window.PDFLib.rgb(0.43, 0.45, 0.49),
      });

      page.drawText(value, {
        x: 48,
        y: y - 18,
        size: 13,
        font: bodyFont,
        color: window.PDFLib.rgb(0.11, 0.11, 0.1),
        maxWidth: width - 96,
      });

      y -= 58;
    });

    if (state.cover.note) {
      page.drawLine({
        start: { x: 48, y: 182 },
        end: { x: width - 48, y: 182 },
        thickness: 1,
        color: window.PDFLib.rgb(0.89, 0.89, 0.86),
      });

      page.drawText(state.cover.note, {
        x: 48,
        y: 142,
        size: 12,
        font: bodyFont,
        color: window.PDFLib.rgb(0.42, 0.43, 0.45),
        lineHeight: 16,
        maxWidth: width - 96,
      });
    }

    return page;
  }

  const INDEX_PAGE_WIDTH = 612;
  const INDEX_PAGE_HEIGHT = 792;
  const INDEX_TITLE_Y_OFFSET = 74;
  const INDEX_START_Y_OFFSET = 112;
  const INDEX_ROW_HEIGHT = 22;
  const INDEX_BOTTOM_MARGIN = 48;

  function getIndexEntriesPerPage() {
    return Math.floor(
      ((INDEX_PAGE_HEIGHT - INDEX_START_Y_OFFSET) - INDEX_BOTTOM_MARGIN) / INDEX_ROW_HEIGHT,
    ) + 1;
  }

  function getIndexPageCount(entryCount) {
    const entriesPerPage = getIndexEntriesPerPage();
    return Math.max(1, Math.ceil(entryCount / entriesPerPage));
  }

  function buildIndexEntries() {
    let nextPage = 1;
    if (state.cover.includeCover) {
      nextPage += 1;
    }
    if (state.pagination.includeIndexPage) {
      nextPage += getIndexPageCount(state.documents.length);
    }

    return state.documents.map((documentRecord) => {
      const entry = {
        documentId: documentRecord.id,
        name: documentRecord.name,
        startPage: nextPage,
      };
      nextPage += documentRecord.pageCount;
      return entry;
    });
  }

  function renderIndexPage(pdfDoc, coverFonts, indexEntries) {
    const { bodyFont, bodyBoldFont } = coverFonts;
    const pageSize = [INDEX_PAGE_WIDTH, INDEX_PAGE_HEIGHT];
    const entriesPerPage = getIndexEntriesPerPage();
    const totalIndexPages = Math.max(1, Math.ceil(indexEntries.length / entriesPerPage));
    const pages = [];
    const linkTargets = [];

    for (let pageNum = 0; pageNum < totalIndexPages; pageNum++) {
      const startIndex = pageNum * entriesPerPage;
      const page = pdfDoc.addPage(pageSize);
      const { width, height } = page.getSize();
      let y = height - INDEX_START_Y_OFFSET;

      pages.push(page);

      page.drawText("DOCUMENT INDEX", {
        x: 48,
        y: height - INDEX_TITLE_Y_OFFSET,
        size: 18,
        font: bodyBoldFont,
        color: window.PDFLib.rgb(0.11, 0.11, 0.1),
      });

      indexEntries
        .slice(startIndex, startIndex + entriesPerPage)
        .forEach((entry, pageEntryIndex) => {
          const index = startIndex + pageEntryIndex;
          const label = `${index + 1}. ${entry.name}`;
          const pageLabel = `Page ${entry.startPage}`;

          page.drawText(label, {
            x: 48,
            y,
            size: 11,
            font: bodyFont,
            color: window.PDFLib.rgb(0.11, 0.11, 0.1),
            maxWidth: width - 170,
          });

          page.drawText(pageLabel, {
            x: width - 124,
            y,
            size: 11,
            font: bodyBoldFont,
            color: window.PDFLib.rgb(0.42, 0.43, 0.45),
          });

          linkTargets.push({
            indexPage: page,
            documentId: entry.documentId,
            rect: {
              x: 46,
              y: y - 4,
              width: width - 92,
              height: 16,
            },
          });

          y -= INDEX_ROW_HEIGHT;
        });
    }

    return { pages, linkTargets };
  }

  function addIndexLinkAnnotation(pdfDoc, indexPage, rect, destinationPageRef) {
    if (!destinationPageRef) {
      return;
    }

    const { PDFName } = window.PDFLib;
    const linkAnnotation = pdfDoc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
      Border: [0, 0, 0],
      Dest: [destinationPageRef, PDFName.of("Fit")],
    });

    const linkAnnotationRef = pdfDoc.context.register(linkAnnotation);
    indexPage.node.addAnnot(linkAnnotationRef);
  }

  function addIndexLinks(pdfDoc, indexLinkTargets, firstPageRefsByDocumentId) {
    indexLinkTargets.forEach((linkTarget) => {
      addIndexLinkAnnotation(
        pdfDoc,
        linkTarget.indexPage,
        linkTarget.rect,
        firstPageRefsByDocumentId.get(linkTarget.documentId),
      );
    });
  }

  async function renderPageForOcr(page) {
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.max(1.5, Math.min(2.1, 1800 / baseViewport.width, 2400 / baseViewport.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    await page.render({
      canvasContext: context,
      viewport,
    }).promise;

    return { canvas, viewport };
  }

  function parseTsvWords(tsv) {
    if (!tsv) {
      return [];
    }
    const rows = tsv.trim().split("\n");
    const items = [];
    // Skip header row; TSV columns (12 total):
    // level  page_num  block_num  par_num  line_num  word_num  left  top  width  height  conf  text
    for (let i = 1; i < rows.length; i += 1) {
      const cols = rows[i].split("\t");
      if (cols.length < 12) {
        continue;
      }
      const level = parseInt(cols[0], 10);
      if (level !== 5) {
        // Level 5 = word
        continue;
      }
      const left = parseInt(cols[6], 10);
      const top = parseInt(cols[7], 10);
      const width = parseInt(cols[8], 10);
      const height = parseInt(cols[9], 10);
      const conf = parseFloat(cols[10]);
      const text = cols.slice(11).join("\t").trim();
      if (!text || conf <= 0 || !Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height)) {
        continue;
      }
      items.push({
        text,
        bbox: { x0: left, y0: top, x1: left + width, y1: top + height },
      });
    }
    return items;
  }

  function addInvisibleTextLayer(pdfPage, viewport, textItems, bodyFont) {
    if (!Array.isArray(textItems) || textItems.length === 0) {
      return;
    }

    const drawTextItem = (item) => {
      const text = String(item.text || "").replace(/\s+/g, " ").trim();
      const bbox = item.bbox;

      if (!text || !bbox) {
        return;
      }

      const bounds = [bbox.x0, bbox.y0, bbox.x1, bbox.y1];
      if (bounds.some((value) => !Number.isFinite(value))) {
        return;
      }

      const topLeft = viewport.convertToPdfPoint(bbox.x0, bbox.y0);
      const bottomRight = viewport.convertToPdfPoint(bbox.x1, bbox.y1);

      const x = Math.min(topLeft[0], bottomRight[0]);
      const yLow = Math.min(topLeft[1], bottomRight[1]);
      const yHigh = Math.max(topLeft[1], bottomRight[1]);
      const width = Math.max(8, Math.abs(bottomRight[0] - topLeft[0]));
      const height = Math.max(6, Math.abs(yHigh - yLow));
      const fontSize = Math.max(6, height * 0.85);

      try {
        pdfPage.drawText(text, {
          x,
          y: yLow + height * 0.08,
          size: fontSize,
          font: bodyFont,
          maxWidth: width,
          color: window.PDFLib.rgb(0, 0, 0),
          // Near-zero opacity keeps the text invisible to viewers while
          // preserving it in the PDF content stream for search and copy-paste.
          opacity: 0.0001,
        });
      } catch (_err) {
        // Skip words that cannot be encoded in the standard font
      }
    };

    textItems.forEach(drawTextItem);
  }

  async function buildBundle() {
    if (state.documents.length === 0 || state.busy) {
      return;
    }

    syncFormState();
    clearOutput();
    resetLogs();
    setBusy(true);
    setStatus("processing", "Preparing merged PDF.");

    const {
      PDFDocument,
      StandardFonts,
    } = window.PDFLib;

    try {
      const mergedPdf = await PDFDocument.create();
      const titleFont = await mergedPdf.embedFont(StandardFonts.CourierBold);
      const bodyFont = await mergedPdf.embedFont(StandardFonts.Helvetica);
      const bodyBoldFont = await mergedPdf.embedFont(StandardFonts.HelveticaBold);
      const indexEntries = buildIndexEntries();
      const firstPageRefsByDocumentId = new Map();
      let indexPageArtifacts = null;

      let nextPageNumber = state.pagination.startNumber;
      let ocrAppliedPages = 0;
      let processedPages = 0;
      const totalPages = getTotalPages();

      if (state.cover.includeCover) {
        const coverPage = renderCoverPage(mergedPdf, { titleFont, bodyFont, bodyBoldFont });
        addLog("Added generated cover page.");

        if (state.pagination.applyPagination) {
          renderPageNumber(coverPage, nextPageNumber, bodyFont);
          nextPageNumber += 1;
        }
      }

      if (state.pagination.includeIndexPage) {
        indexPageArtifacts = renderIndexPage(mergedPdf, { titleFont, bodyFont, bodyBoldFont }, indexEntries);
        addLog("Added document index page.");

        if (state.pagination.applyPagination) {
          indexPageArtifacts.pages.forEach((indexPage) => {
            renderPageNumber(indexPage, nextPageNumber, bodyFont);
            nextPageNumber += 1;
          });
        }
      }

      for (const [docIndex, documentRecord] of state.documents.entries()) {
        addLog(`Merging ${documentRecord.name}.`);
        const indexEntry = indexEntries[docIndex];
        if (indexEntry) {
          addLog(`Index: ${indexEntry.name} starts on page ${indexEntry.startPage}.`);
        }

        const sourcePdf = await PDFDocument.load(documentRecord.bytes.slice(), {
          ignoreEncryption: true,
        });

        if (sourcePdf.isEncrypted) {
          addLog(`Warning: ${documentRecord.name} is encrypted. The merged output may be incomplete or unreadable for this document.`);
        }

        const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
        const pdfProxy = await getPdfProxy(documentRecord);

        for (let pageIndex = 0; pageIndex < copiedPages.length; pageIndex += 1) {
          processedPages += 1;
          setStatus("processing", `Processing page ${processedPages} of ${totalPages}.`);

          const outputPage = mergedPdf.addPage(copiedPages[pageIndex]);
          if (pageIndex === 0) {
            firstPageRefsByDocumentId.set(documentRecord.id, outputPage.ref);
          }

          if (state.pagination.applyPagination) {
            renderPageNumber(outputPage, nextPageNumber, bodyFont);
            nextPageNumber += 1;
          }

          if (state.pagination.ocrMode !== "off") {
            const sourcePage = await pdfProxy.getPage(pageIndex + 1);
            const hasTextLayer = await detectTextLayer(documentRecord, pageIndex + 1);
            const shouldRunOcr =
              state.pagination.ocrMode === "all" ||
              (state.pagination.ocrMode === "auto" && !hasTextLayer);

            if (shouldRunOcr) {
              state.currentOcrLabel = `OCR page ${processedPages} of ${totalPages}`;
              addLog(`Running OCR on ${documentRecord.name}, page ${pageIndex + 1}.`);

              const { canvas, viewport } = await renderPageForOcr(sourcePage);

              // Use the worker API directly so we can request TSV output, which
              // provides word-level bounding boxes needed for the text overlay.
              const ocrWorker = await window.Tesseract.createWorker("eng", 1, {
                workerPath: ocrRuntime.workerPath,
                corePath: ocrRuntime.corePath,
                langPath: ocrRuntime.langPath,
                workerBlobURL: ocrRuntime.workerBlobURL,
                logger: (message) => {
                  if (!state.busy || !state.currentOcrLabel) {
                    return;
                  }

                  const progress = typeof message.progress === "number"
                    ? ` ${Math.round(message.progress * 100)}%`
                    : "";
                  const status = message.status ? message.status : "OCR";
                  setStatus("processing", `${state.currentOcrLabel}. ${status}${progress}`);
                },
              });

              try {
                const recognition = await ocrWorker.recognize(canvas, {}, { tsv: true });
                const words = parseTsvWords(recognition.data.tsv);
                addInvisibleTextLayer(outputPage, viewport, words, bodyFont);
              } finally {
                await ocrWorker.terminate();
              }

              canvas.width = 0;
              canvas.height = 0;
              state.currentOcrLabel = "";
              ocrAppliedPages += 1;
            }

            sourcePage.cleanup();
          }
        }
      }

      if (indexPageArtifacts) {
        addIndexLinks(mergedPdf, indexPageArtifacts.linkTargets, firstPageRefsByDocumentId);
      }

      const mergedBytes = await mergedPdf.save();
      const blob = new Blob([mergedBytes], { type: "application/pdf" });
      const outputUrl = URL.createObjectURL(blob);
      const outputFilename = normalizeFilename(state.pagination.outputFilename);
      const outputPageCount = mergedPdf.getPageCount();

      state.output = {
        url: outputUrl,
        filename: outputFilename,
        ocrPages: ocrAppliedPages,
        summary: `Merged ${formatCount(
          state.documents.length,
          "PDF",
          "PDFs",
        )} into ${formatCount(outputPageCount, "page", "pages")}. OCR applied to ${formatCount(
          ocrAppliedPages,
          "page",
          "pages",
        )}.`,
      };

      renderExportResult();
      addLog(`Merged PDF ready: ${outputFilename}.`);
      setStatus("success", "Merged PDF built successfully.");
    } catch (error) {
      console.error(error);
      addLog(error instanceof Error ? error.message : String(error));
      setStatus(
        "error",
        error instanceof Error ? error.message : "The bundle could not be built in this browser.",
      );
    } finally {
      state.currentOcrLabel = "";
      setBusy(false);
    }
  }

  function updateAfterInputChange() {
    updateSummary();

    if (state.output.url) {
      clearOutput();
      setStatus("idle", "Export settings changed. Build the merged PDF again to refresh the output.");
    }
  }

  function bindEvents() {
    elements.tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        switchTab(tab.dataset.tab);
      });
    });

    elements.fileInput.addEventListener("change", (event) => {
      if (event.target.files && event.target.files.length > 0) {
        addFiles(event.target.files);
      }
      event.target.value = "";
    });

    elements.dropzone.addEventListener("dragenter", (event) => {
      event.preventDefault();
      elements.dropzone.classList.add("is-dragover");
    });

    elements.dropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      elements.dropzone.classList.add("is-dragover");
    });

    elements.dropzone.addEventListener("dragleave", () => {
      elements.dropzone.classList.remove("is-dragover");
    });

    elements.dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      elements.dropzone.classList.remove("is-dragover");
      if (event.dataTransfer && event.dataTransfer.files) {
        addFiles(event.dataTransfer.files);
      }
    });

    elements.dropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        elements.fileInput.click();
      }
    });

    elements.clearQueueButton.addEventListener("click", () => {
      clearQueue();
    });

    elements.reviewPrevPageButton.addEventListener("click", () => {
      const documentRecord = getSelectedDocument();
      if (!documentRecord || state.reviewPage <= 1) {
        return;
      }
      state.reviewPage -= 1;
      renderReviewPage();
    });

    elements.reviewNextPageButton.addEventListener("click", () => {
      const documentRecord = getSelectedDocument();
      if (!documentRecord || state.reviewPage >= documentRecord.pageCount) {
        return;
      }
      state.reviewPage += 1;
      renderReviewPage();
    });

    [
      elements.coverTitle,
      elements.coverSubtitle,
      elements.coverReference,
      elements.coverPreparedBy,
      elements.coverNote,
      elements.includeCover,
      elements.pagePrefix,
      elements.pageStart,
      elements.pagePosition,
      elements.applyPagination,
      elements.ocrMode,
      elements.includeIndexPage,
      elements.outputFilename,
    ].forEach((field) => {
      field.addEventListener("input", updateAfterInputChange);
      field.addEventListener("change", updateAfterInputChange);
    });

    elements.themeToggle.addEventListener("click", () => {
      setTheme(state.theme === "dark" ? "light" : "dark");
    });

    elements.buildBundleButton.addEventListener("click", () => {
      buildBundle();
    });

    [elements.downloadLink, elements.openLink].forEach((link) => {
      link.addEventListener("click", (event) => {
        if (link.getAttribute("aria-disabled") === "true") {
          event.preventDefault();
        }
      });
    });

    window.addEventListener("beforeunload", () => {
      clearOutput();
    });
  }

  function init() {
    loadThemePreference();
    updateSummary();
    renderQueueList();
    renderReviewList();
    renderReviewPage();
    renderExportResult();
    elements.logOutput.textContent = state.logs.join("\n");
    elements.clearQueueButton.disabled = true;
    elements.buildBundleButton.disabled = true;
    bindEvents();
    setStatus("idle", initialStatus);
  }

  init();
})();
