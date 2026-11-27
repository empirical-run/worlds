import type { StoreSnapshot } from "@emulators/core";

const BLOB_COLLECTIONS = ["slack.files", "slack.file_upload_sessions"];
const CHUNK_CHARS = 1_000_000;

type BlobItem = { file_id?: string; content_base64?: string };

function blobItems(snapshot: StoreSnapshot): BlobItem[] {
  return BLOB_COLLECTIONS.flatMap(
    (name) => (snapshot.collections[name]?.items ?? []) as BlobItem[],
  );
}

function chunkKey(fileId: string, index: number): string {
  return `blob:${fileId}:${index}`;
}

function countKey(fileId: string): string {
  return `blob:${fileId}`;
}

export class FileBlobs {
  private stored = new Set<string>();

  constructor(private storage: DurableObjectStorage) {}

  async split(snapshot: StoreSnapshot): Promise<StoreSnapshot> {
    const lean = structuredClone(snapshot);
    for (const item of blobItems(lean)) {
      if (!item.file_id || !item.content_base64) continue;
      if (!this.stored.has(item.file_id)) await this.write(item.file_id, item.content_base64);
      delete item.content_base64;
    }
    return lean;
  }

  async join(snapshot: StoreSnapshot): Promise<StoreSnapshot> {
    for (const item of blobItems(snapshot)) {
      if (!item.file_id || item.content_base64) continue;
      const content = await this.read(item.file_id);
      if (content !== null) item.content_base64 = content;
    }
    return snapshot;
  }

  forget(): void {
    this.stored.clear();
  }

  private async write(fileId: string, content: string): Promise<void> {
    const chunks: Record<string, string> = {};
    for (let index = 0; index * CHUNK_CHARS < content.length; index += 1) {
      chunks[chunkKey(fileId, index)] = content.slice(
        index * CHUNK_CHARS,
        (index + 1) * CHUNK_CHARS,
      );
    }
    for (const [key, value] of Object.entries(chunks)) await this.storage.put(key, value);
    await this.storage.put(countKey(fileId), Object.keys(chunks).length);
    this.stored.add(fileId);
  }

  private async read(fileId: string): Promise<string | null> {
    const count = await this.storage.get<number>(countKey(fileId));
    if (count === undefined) return null;
    const keys = Array.from({ length: count }, (_, index) => chunkKey(fileId, index));
    const chunks = await this.storage.get<string>(keys);
    this.stored.add(fileId);
    return keys.map((key) => chunks.get(key) ?? "").join("");
  }
}
