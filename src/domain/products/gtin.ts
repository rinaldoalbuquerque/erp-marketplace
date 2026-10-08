// GTIN (EAN-8, UPC-A/GTIN-12, EAN-13, GTIN-14) check digit validation.
// Algorithm: GS1 "mod 10" (https://www.gs1.org/services/how-calculate-check-digit-manually)

export function isValidGtin(value: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(value)) return false;
  const digits = value.split("").map(Number);
  const checkDigit = digits.pop() as number;
  // From the right (excluding the check digit), weights alternate 3, 1, 3, 1...
  const sum = digits
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === checkDigit;
}
