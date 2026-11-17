export { S3Uploader } from "./s3";
export type { UploadedObject, Uploader, TaskResult } from "./types";

/** Bound reading as well as uploading to keep mobile memory use predictable. */
export async function mapConcurrent<T, R>(
  items: T[], task: (item: T, index: number) => Promise<R>, concurrency = 3
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  }));
  return results;
}
