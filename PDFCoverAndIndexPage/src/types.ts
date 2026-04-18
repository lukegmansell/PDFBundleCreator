export type AppTab = "upload" | "ordering" | "cover" | "pagination";

export interface UploadedPdf {
  id: string;
  name: string;
  file: File;
  bytes: Uint8Array;
  pageCount: number;
  sizeBytes: number;
  previewUrl: string;
}

export interface CoverSettings {
  title: string;
  subtitle: string;
  reference: string;
  preparedFor: string;
  preparedBy: string;
  notes: string;
  accentColor: string;
  theme: "ink" | "marine" | "copper";
  includeManifest: boolean;
}

export interface PaginationSettings {
  enabled: boolean;
  startNumber: number;
  prefix: string;
  position: "footer-right" | "footer-center" | "header-right";
  fontSize: number;
  margin: number;
  skipCover: boolean;
}

export interface RedactionRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type RedactionMap = Record<string, Record<number, RedactionRect[]>>;

export interface OcrState {
  status: "idle" | "running" | "complete" | "error";
  progress: number;
  message: string;
  text: string;
  source: "text-layer" | "ocr" | "mixed" | null;
  error: string | null;
}

export interface PreviewState {
  width: number;
  height: number;
  isRendering: boolean;
  error: string | null;
}
