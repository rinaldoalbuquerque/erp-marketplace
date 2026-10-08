/**
 * Normalizes a Brazilian mobile number to E.164 (+55 + DDD + 9 digits).
 * Accepts any formatting: "(11) 98765-4321", "11987654321", "+55 11 98765-4321".
 * Returns null if it isn't a valid Brazilian mobile number.
 */
export function normalizeBrazilianMobile(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  // DDD (11-99, no zero digits) + mobile number starting with 9 (9 digits).
  if (!/^[1-9][1-9]9\d{8}$/.test(digits)) {
    return null;
  }
  return `+55${digits}`;
}
