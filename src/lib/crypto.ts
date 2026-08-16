import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/config/env";

/**
 * Encryption at rest for stored secrets — §89, ticket 07.
 *
 * The only current caller is product demo credentials, which §9 requires be
 * "stored securely and only exposed according to product configuration". This
 * module is the "stored securely" half; the exposure half is the product
 * service's job.
 *
 * ## AES-256-GCM, not AES-CBC
 *
 * GCM is *authenticated*: `open()` fails if a single byte of the ciphertext,
 * the IV, or the associated data has changed. With CBC a tampered ciphertext
 * decrypts to garbage that the application then treats as a password — the
 * failure is silent, which is the worst property a security primitive can have.
 *
 * ## Associated data binds a secret to its owner
 *
 * `seal()` takes an `aad` — for a demo credential, the product id. It is not
 * encrypted, but it *is* authenticated: a `passwordCipher` copied from one
 * product's document into another's fails to open. Without it, a stored
 * ciphertext is portable, and "move this blob and read it in a context that is
 * allowed to decrypt" is a real escalation path.
 *
 * Deliberately **not** part of the AAD: anything editable. Binding to a
 * credential's `role` would mean renaming "Admin" to "Administrator" silently
 * destroys the password.
 *
 * ## Key versioning is real, not decorative
 *
 * `passwordCipher.keyVersion` exists in the schema with a default of 1. This
 * module makes it mean something: `seal()` stamps the current version, `open()`
 * looks up the key that version names. Without that, rotating the key is a data
 * migration over every stored secret. With it, rotation is: put the old key in
 * `ENCRYPTION_KEYS_PREVIOUS`, bump `ENCRYPTION_KEY_VERSION`, and let old
 * ciphertexts keep opening while new ones use the new key.
 *
 * ## Never log a SealedBox
 *
 * Not in a `console.log`, not in an audit `before`/`after`, not in an error
 * message. `src/services/audit/` has a redactor for exactly this, but the
 * primary defence is not putting one where it could be logged.
 */

/** GCM's standard IV length. 96 bits is what the mode is specified around. */
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface SealedBox {
  /** base64. Random per call — sealing the same plaintext twice differs. */
  iv: string;
  /** base64 GCM authentication tag. */
  tag: string;
  /** base64. */
  ciphertext: string;
  /** Which key opened it. See the note above. */
  keyVersion: number;
}

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

/* ────────────────────────────────────────────── keys */

let keyCache: Map<number, Buffer> | undefined;
let currentVersionCache: number | undefined;

function keys(): { keys: Map<number, Buffer>; current: number } {
  if (keyCache && currentVersionCache !== undefined) {
    return { keys: keyCache, current: currentVersionCache };
  }

  const env = serverEnv();
  const map = new Map<number, Buffer>();

  const current = env.ENCRYPTION_KEY_VERSION;
  map.set(current, decodeKey(env.ENCRYPTION_KEY, `ENCRYPTION_KEY`));

  // "1:<hex>,2:<hex>" — retired keys that must still open old ciphertexts.
  if (env.ENCRYPTION_KEYS_PREVIOUS) {
    for (const entry of env.ENCRYPTION_KEYS_PREVIOUS.split(",")) {
      const trimmed = entry.trim();
      if (!trimmed) continue;

      const separator = trimmed.indexOf(":");
      const version = Number.parseInt(trimmed.slice(0, separator), 10);
      const hex = trimmed.slice(separator + 1);

      if (!Number.isInteger(version) || version < 1) {
        throw new CryptoError(
          `ENCRYPTION_KEYS_PREVIOUS has an entry with no valid version prefix. ` +
            `Expected "1:<64 hex chars>,2:<64 hex chars>".`,
        );
      }
      if (version === current) {
        throw new CryptoError(
          `ENCRYPTION_KEYS_PREVIOUS lists version ${version}, which is also ` +
            `ENCRYPTION_KEY_VERSION. A version names exactly one key.`,
        );
      }
      map.set(version, decodeKey(hex, `ENCRYPTION_KEYS_PREVIOUS[${version}]`));
    }
  }

  keyCache = map;
  currentVersionCache = current;
  return { keys: map, current };
}

function decodeKey(hex: string, label: string): Buffer {
  const key = Buffer.from(hex.trim(), "hex");
  // env.ts already enforces 64 hex characters, but a key of the wrong length
  // silently changes the cipher (AES-128 vs AES-256), so assert the bytes too.
  if (key.length !== KEY_BYTES) {
    throw new CryptoError(
      `${label} must decode to ${KEY_BYTES} bytes, got ${key.length}. ` +
        `Generate one with: openssl rand -hex 32`,
    );
  }
  return key;
}

/** Tests only — the cache is process-wide and env is read once. */
export function resetKeyCache(): void {
  keyCache = undefined;
  currentVersionCache = undefined;
}

/* ────────────────────────────────────────────── seal / open */

/**
 * Encrypt a secret. `aad` binds the result to a context — pass the product id.
 */
export function seal(plaintext: string, aad?: string): SealedBox {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new CryptoError("Nothing to encrypt.");
  }

  const { keys: available, current } = keys();
  const key = available.get(current)!;
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    keyVersion: current,
  };
}

/**
 * Decrypt. Throws on tampering, on a wrong `aad`, and on a key version this
 * deployment has no key for — never returns a partially trusted value.
 */
export function open(box: SealedBox, aad?: string): string {
  if (!isSealed(box)) {
    throw new CryptoError("Not an encrypted value.");
  }

  const { keys: available } = keys();
  const key = available.get(box.keyVersion);
  if (!key) {
    throw new CryptoError(
      `This value was encrypted with key version ${box.keyVersion}, which is not ` +
        `configured. Add it to ENCRYPTION_KEYS_PREVIOUS to read it.`,
    );
  }

  const iv = Buffer.from(box.iv, "base64");
  const tag = Buffer.from(box.tag, "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new CryptoError("Encrypted value is malformed.");
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));

    return Buffer.concat([
      decipher.update(Buffer.from(box.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // The underlying error distinguishes a bad tag from a bad key, which is
    // more than a caller should learn. One message for every failure.
    throw new CryptoError("Could not decrypt this value. It may have been altered.");
  }
}

export function isSealed(value: unknown): value is SealedBox {
  if (typeof value !== "object" || value === null) return false;
  const box = value as Partial<SealedBox>;
  return (
    typeof box.iv === "string" &&
    typeof box.tag === "string" &&
    typeof box.ciphertext === "string" &&
    typeof box.keyVersion === "number"
  );
}

/**
 * Constant-time comparison, for the rare case where a stored secret is checked
 * rather than displayed. `===` on secrets leaks length and prefix through
 * timing.
 */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
