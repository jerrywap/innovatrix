import { randomBytes } from "node:crypto";

/**
 * Licence keys — §65, ticket 14.
 *
 * `INVX-XXXX-XXXX-XXXX-XXXC` — fifteen random characters and one check
 * character, in five hyphenated groups.
 *
 * ## Unguessable, and that is a security property not a nicety
 *
 * A licence key is a bearer token for software somebody paid for. Everything
 * that would make one predictable is deliberately absent: no timestamp, no
 * sequence, no order id, no product id. The bytes come from `randomBytes`,
 * never `Math.random()` — which is seeded, shared across the process, and
 * recoverable from a handful of outputs.
 *
 * Fifteen characters from a 32-symbol alphabet is 75 bits. Guessing one is not
 * a threat model.
 *
 * ## Why there is a check character
 *
 * Keys get **read down a phone line** and typed into an installer. Without a
 * checksum, a transposed pair produces "invalid licence key" from a database
 * lookup — indistinguishable, to the customer, from "we have no record of your
 * purchase". With one, the installer can say "that key has a typo in it"
 * before any network call, which is a different conversation.
 *
 * ## The alphabet
 *
 * Crockford-ish: no `I`, `O`, `0` or `1`. Those are the four characters people
 * mishear and mistype, and excluding them costs a fraction of a bit.
 *
 * Note `INVX` — the fixed prefix — contains an `I`. That is fine: it is a
 * constant everybody already knows, read aloud as a word, and never ambiguous.
 */

export const LICENCE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const LICENCE_PREFIX = "INVX";

const GROUPS = 4;
const GROUP_SIZE = 4;
const RANDOM_CHARS = GROUPS * GROUP_SIZE - 1;

/**
 * The check character: the sum of the other characters' indices, mod 32.
 *
 * A plain mod sum catches every single-character error, which is the common
 * one. It does **not** catch a transposition — `AB` and `BA` sum the same — so
 * a position weight is folded in, which does.
 */
export function checkCharacter(chars: string): string {
  let sum = 0;

  for (let index = 0; index < chars.length; index += 1) {
    const value = LICENCE_ALPHABET.indexOf(chars[index]!);
    // An unknown character makes the key invalid rather than being skipped —
    // skipping would let `AB!CD` check out the same as `ABCD`.
    if (value < 0) return "";
    // The weight is what catches a transposition. Without it, swapping two
    // characters leaves the sum unchanged and the key looks fine.
    sum += value * (index + 1);
  }

  return LICENCE_ALPHABET[sum % LICENCE_ALPHABET.length]!;
}

export function generateLicenceKey(): string {
  // Rejection sampling rather than `% 32`. With a 32-symbol alphabet and 256
  // byte values it happens to divide evenly, so modulo would be unbiased here
  // — but the alphabet is a constant somebody will change, and a biased key
  // generator is a bug that leaves no trace.
  const chars: string[] = [];

  while (chars.length < RANDOM_CHARS) {
    for (const byte of randomBytes(RANDOM_CHARS)) {
      if (chars.length === RANDOM_CHARS) break;
      const limit = 256 - (256 % LICENCE_ALPHABET.length);
      if (byte >= limit) continue;
      chars.push(LICENCE_ALPHABET[byte % LICENCE_ALPHABET.length]!);
    }
  }

  const body = chars.join("");
  const full = body + checkCharacter(body);

  const groups: string[] = [];
  for (let index = 0; index < GROUPS; index += 1) {
    groups.push(full.slice(index * GROUP_SIZE, (index + 1) * GROUP_SIZE));
  }

  return `${LICENCE_PREFIX}-${groups.join("-")}`;
}

/**
 * Is this shaped like one of ours, and does the checksum hold?
 *
 * Deliberately **not** a claim that the key exists. It answers "is this worth
 * looking up", so an installer can reject a typo locally and a lookup endpoint
 * can refuse malformed input before touching the database — which also means a
 * key-guessing script gets no timing signal from the lookup.
 */
export function isValidLicenceKeyFormat(key: string): boolean {
  const normalised = normaliseLicenceKey(key);
  const match = new RegExp(
    `^${LICENCE_PREFIX}-([${LICENCE_ALPHABET}]{${GROUP_SIZE}}-){${GROUPS - 1}}[${LICENCE_ALPHABET}]{${GROUP_SIZE}}$`,
  ).exec(normalised);

  if (!match) return false;

  const body = normalised.slice(LICENCE_PREFIX.length + 1).replace(/-/g, "");
  const expected = checkCharacter(body.slice(0, RANDOM_CHARS));

  return expected !== "" && body.slice(RANDOM_CHARS) === expected;
}

/**
 * Tidy what a human typed.
 *
 * Uppercases, strips whitespace, and re-inserts the hyphens — because somebody
 * pasting from an email gets `invx xxxx…` or `INVXXXXXXXXXXXXXXXX` and neither
 * is a reason to refuse a valid licence.
 */
export function normaliseLicenceKey(key: string): string {
  const stripped = key.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const withoutPrefix = stripped.startsWith(LICENCE_PREFIX)
    ? stripped.slice(LICENCE_PREFIX.length)
    : stripped;

  const groups: string[] = [];
  for (let index = 0; index < withoutPrefix.length; index += GROUP_SIZE) {
    groups.push(withoutPrefix.slice(index, index + GROUP_SIZE));
  }

  return `${LICENCE_PREFIX}-${groups.join("-")}`;
}

/**
 * `INVX-••••-••••-••••-8K2P` — enough to recognise, not enough to use.
 *
 * The customer's own licence page masks by default. The key is already in that
 * browser and the mask is shoulder-surfing protection for somebody demoing on a
 * shared screen, not a security control — saying so keeps it from being
 * mistaken for one.
 */
export function maskLicenceKey(key: string): string {
  const normalised = normaliseLicenceKey(key);
  const groups = normalised.split("-").slice(1);
  if (groups.length === 0) return normalised;

  const last = groups[groups.length - 1]!;
  return [
    LICENCE_PREFIX,
    ...groups.slice(0, -1).map((group) => "•".repeat(group.length)),
    last,
  ].join("-");
}
