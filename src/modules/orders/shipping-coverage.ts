export function isPostalCodeCovered(
  coverage: string | null,
  postalCode: string | null | undefined,
) {
  if (!coverage || !postalCode) return false;
  const normalized = postalCode.trim().toUpperCase().replace(/\s/g, "");
  const basic = /^[A-Z]\d{4}[A-Z]{3}$/.test(normalized) ? normalized.slice(1, 5) : normalized;
  const codes = coverage
    .split(/[,;\n]/)
    .map((value) => value.trim().toUpperCase().replace(/\s/g, ""))
    .filter(Boolean);
  return codes.includes(normalized) || codes.includes(basic);
}
