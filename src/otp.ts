const patterns = [
  /\b(?:verification|security|login|one[- ]time|pass|otp|kode\s+verifikasi|kode\s+otp)\s*(?:code|password|pin|is|adalah|:)?\s*[:#-]?\s*([A-Z0-9]{4,8})\b/i,
  /\b(?:code|kode|pin)\s*(?:is|adalah|:)?\s*[:#-]?\s*([A-Z0-9]{4,8})\b/i
];
export function extractOtp(body: string): string | null {
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match?.[1] && /\d/.test(match[1])) return match[1];
  }
  return null;
}
