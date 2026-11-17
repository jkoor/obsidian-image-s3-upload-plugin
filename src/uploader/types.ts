import type { ImageData } from "../types";

export interface UploadedObject {
  bucket: string;
  key: string;
  url: string;
}

export interface Uploader {
  upload(image: ImageData): Promise<UploadedObject>;
}

export type TaskResult<T> =
  | { source: T; success: true; object: UploadedObject }
  | { source: T; success: false; error: string };
