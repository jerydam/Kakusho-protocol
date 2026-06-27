// ICAO 9303 check digit calculation. Used to sanity-check manually-entered
// MRZ fields before attempting BAC — catches typos before wasting an NFC
// tap attempt (each failed BAC handshake costs the user a ~3-5 second tap
// for nothing).

const WEIGHTS = [7, 3, 1];

const CHAR_VALUES: Record<string, number> = {
  '<': 0,
  ...Object.fromEntries('0123456789'.split('').map((c) => [c, Number(c)])),
  ...Object.fromEntries('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c, i) => [c, i + 10])),
};

export function mrzCheckDigit(field: string): number {
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    const value = CHAR_VALUES[field[i].toUpperCase()] ?? 0;
    sum += value * WEIGHTS[i % 3];
  }
  return sum % 10;
}

export function isValidDateInput(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(date).getTime());
}

export function isValidDocumentNumber(doc: string): boolean {
  return /^[A-Z0-9]{6,9}$/.test(doc.toUpperCase());
}

export function isFutureOrTodayDate(date: string): boolean {
  if (!isValidDateInput(date)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(date).getTime() >= today.getTime();
}

export function isPastDate(date: string): boolean {
  if (!isValidDateInput(date)) return false;
  return new Date(date).getTime() <= Date.now();
}
