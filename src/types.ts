import type { TFile } from "obsidian";

export interface Image {
  path: string;
  name: string;
  source: string;
  file?: TFile | null;
}

export interface ImageReference extends Image {
  start: number;
  end: number;
}

export interface ImageData {
  name: string;
  contentType: string;
  data: ArrayBuffer;
}
