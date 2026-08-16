const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

/**
 * Byte counts as a person would write them.
 *
 * It lives in `lib/` rather than beside the storage policy that first needed it
 * because both a **client** component (the dropzone's "that file is too big")
 * and a **server** one (the policy error the same upload would get) must use
 * it. Had it stayed in `services/storage/`, the dropzone would be importing a
 * service — the wrong direction — and one `import "server-only"` added to that
 * file later would break the client build for no reason anyone could see.
 *
 * The two paths sharing this function is what makes the client-side courtesy
 * message and the server's authoritative rejection read as the same sentence.
 */
export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(bytes % GB === 0 ? 0 : 1)}GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(bytes % MB === 0 ? 0 : 1)}MB`;
  if (bytes >= KB) return `${Math.round(bytes / KB)}KB`;
  return `${bytes} bytes`;
}
