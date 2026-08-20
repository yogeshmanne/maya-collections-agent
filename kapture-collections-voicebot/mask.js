const crypto = require('crypto');

/** Masks a name for logs: "Rahul Sharma" -> "Rahul S****" */
function maskName(name) {
  if (!name) return name;
  const parts = String(name).trim().split(/\s+/);
  return parts.map((p, i) => (i === 0 ? p : `${p[0]}${'*'.repeat(Math.max(p.length - 1, 3))}`)).join(' ');
}

/** Masks a verification code entirely — it should never appear in logs. */
function maskCode() {
  return '[REDACTED]';
}

/** SHA-256 hash for storing verification codes at rest instead of raw values. */
function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

/**
 * Recursively masks known-sensitive fields in an object before it's logged
 * or persisted to tool_call_logs. Deny-list approach: anything not matched
 * passes through, so this is a floor, not a substitute for care at call sites.
 */
const SENSITIVE_KEYS = new Set(['verification_code', 'verificationCode', 'pan', 'aadhaar', 'dob']);

function maskArgsForLogging(args) {
  if (!args || typeof args !== 'object') return args;
  const out = Array.isArray(args) ? [] : {};
  for (const [key, value] of Object.entries(args)) {
    if (SENSITIVE_KEYS.has(key)) {
      out[key] = maskCode();
    } else if (key.toLowerCase().includes('name')) {
      out[key] = typeof value === 'string' ? maskName(value) : value;
    } else if (value && typeof value === 'object') {
      out[key] = maskArgsForLogging(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

module.exports = { maskName, maskCode, hashCode, maskArgsForLogging };
