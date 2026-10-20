// Detection supplements strict output schemas. It cannot identify all confidential meaning.
export const privateTextPatterns = [
  /\b[a-z]:[\\/]/i,
  /\\\\[^\s\\/]+[\\/]/,
  /\bfile\s*:/i,
  /(?:^|[\s"'(<>=])~[\\/]/,
  /(?:^|[\s"'(<>=])\/(?:users|home|root|private|tmp|var|mnt|media|volumes|workspace|workspaces|srv|opt|etc|usr)(?:\/|\b)/i,
  /\b(?:gh[pousr]_[a-z0-9]{16,}|github_pat_[a-z0-9_]{20,}|sk-(?:proj-)?[a-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[a-z0-9._~+\/-]{16,}/i,
  /https?:\/\/[^\s/:]+:[^\s/@]+@/i,
  /\b(?:api[_ -]?key|access[_ -]?token|client[_ -]?secret|password)\s*[:=]\s*["']?[^\s"']{8,}/i
];

export function normalizePrivateText(value) {
  let result = value.normalize('NFKC').replace(/[\u200b-\u200f\ufeff]/g, '');
  for (let i = 0; i < 4; i++) {
    const before = result;
    result = result.replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\x([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(?:x([0-9a-f]+)|(\d+));?/gi, (_, hex, dec) => {
        const cp = parseInt(hex ?? dec, hex ? 16 : 10);
        return cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
      }).replace(/&(?:colon|sol|bsol|amp);/gi, entity => ({ '&colon;': ':', '&sol;': '/', '&bsol;': '\\', '&amp;': '&' })[entity.toLowerCase()])
      .replace(/\\\//g, '/');
    try { result = decodeURIComponent(result); } catch { result = result.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))); }
    if (before === result) break;
  }
  return result;
}

export function hasPrivateText(value, blockedValues = []) {
  const blocked=blockedValues.filter(value=>value.length>=4).map(value=>normalizePrivateText(value).toLowerCase());
  const privateCandidate=candidate=>privateTextPatterns.some(pattern=>pattern.test(candidate))||blocked.some(value=>candidate.toLowerCase().includes(value));
  if(privateCandidate(normalizePrivateText(value)))return true;
  // Admit one bounded decoded token at a time, never an array proportional to
  // the number of tokens in a document. This is the established token limit.
  for(const match of value.matchAll(/[A-Za-z0-9+/_-]{24,}={0,2}/g)){
    if(match[0].length>200000)return true;
    if(privateCandidate(normalizePrivateText(Buffer.from(match[0],'base64').toString('utf8'))))return true;
  }
  return false;
}
