/**
 * Object storage for slip photos, voice notes and parcel photos.
 * Local folder in development; Supabase Storage when SUPABASE_URL is set.
 */
import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StorageProvider {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

class LocalStorage implements StorageProvider {
  constructor(private dir = path.resolve(".storage")) {}
  private file(key: string) {
    const f = path.resolve(this.dir, key);
    if (!f.startsWith(this.dir + path.sep)) throw new Error("Bad storage key");
    return f;
  }
  async put(key: string, data: Buffer) {
    await mkdir(path.dirname(this.file(key)), { recursive: true });
    await writeFile(this.file(key), data);
  }
  get(key: string) {
    return readFile(this.file(key));
  }
}

/** Private bucket accessed with the service-role key from the server only. */
class SupabaseStorage implements StorageProvider {
  constructor(
    private url: string,
    private key: string,
    private bucket: string,
  ) {}
  /** Works with both legacy service_role JWTs and newer sb_secret_ keys. */
  private auth() {
    return { authorization: `Bearer ${this.key}`, apikey: this.key };
  }
  private endpoint(key: string) {
    return `${this.url}/storage/v1/object/${this.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
  async put(key: string, data: Buffer, contentType: string) {
    const res = await fetch(this.endpoint(key), {
      method: "POST",
      headers: { ...this.auth(), "content-type": contentType, "x-upsert": "true" },
      body: new Uint8Array(data),
    });
    if (!res.ok) throw new Error(`Storage upload failed: ${res.status} ${await res.text()}`);
  }
  async get(key: string) {
    const res = await fetch(this.endpoint(key), { headers: this.auth() });
    if (!res.ok) throw new Error(`Storage download failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

let instance: StorageProvider | null = null;
export function storage(): StorageProvider {
  if (!instance) {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STORAGE_BUCKET } = process.env;
    instance =
      SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
        ? new SupabaseStorage(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STORAGE_BUCKET ?? "captures")
        : new LocalStorage();
  }
  return instance;
}
