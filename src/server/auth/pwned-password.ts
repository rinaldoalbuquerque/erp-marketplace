import { createHash } from "node:crypto";

// Have I Been Pwned "Pwned Passwords" range API (free, no API key).
// k-anonymity: only the first 5 characters of the password's SHA-1 hash are sent;
// the password itself never leaves the server.
// Docs: https://haveibeenpwned.com/API/v3#PwnedPasswords
const RANGE_URL = "https://api.pwnedpasswords.com/range/";
const TIMEOUT_MS = 3000;

/**
 * Returns true if the password appears in known data breaches.
 * Fails open (returns false) if the service is unreachable, so an outage
 * doesn't block sign-ups; the strength check still applies.
 */
export async function isPwnedPassword(
  password: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  const hash = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  try {
    const response = await fetchFn(RANGE_URL + prefix, {
      // Padding hides the real number of matches from network observers.
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`Pwned Passwords check skipped: HTTP ${response.status}`);
      return false;
    }
    const body = await response.text();
    return body.split("\n").some((line) => {
      const [lineSuffix, count] = line.trim().split(":");
      // Padding entries have count 0.
      return lineSuffix === suffix && Number(count) > 0;
    });
  } catch {
    console.warn("Pwned Passwords check skipped: service unreachable");
    return false;
  }
}
