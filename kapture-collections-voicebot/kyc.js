const crypto = require('crypto');
const { hashCode } = require('../utils/mask');

const { KYC_PROVIDER_API_KEY, KYC_PROVIDER_BASE_URL } = process.env;
const isConfigured = Boolean(KYC_PROVIDER_API_KEY && KYC_PROVIDER_BASE_URL);

/**
 * KYC verification adapter. This is the seam where a real provider
 * (Karza, Signzy, DigiLocker, etc.) plugs in — verifyCode() is the only
 * method the rest of the app depends on, so swapping the implementation
 * is a one-function change, not a rewrite of the tool handler.
 *
 * Without KYC_PROVIDER_* env vars set, this falls back to a mock adapter
 * that checks the submitted code against a SHA-256 hash stored on the
 * account (see accounts.verification_hash) — no raw PAN/DOB is ever stored,
 * even in mock mode.
 */
async function verifyCode({ account, submittedCode }) {
  if (isConfigured) {
    return verifyCodeViaRealProvider({ account, submittedCode });
  }
  return verifyCodeViaMock({ account, submittedCode });
}

async function verifyCodeViaMock({ account, submittedCode }) {
  const submittedHash = hashCode(submittedCode);
  // timing-safe compare to avoid leaking match/no-match via response time
  const match =
    submittedHash.length === account.verification_hash.length &&
    crypto.timingSafeEqual(Buffer.from(submittedHash), Buffer.from(account.verification_hash));

  return { verified: match, provider: 'mock' };
}

async function verifyCodeViaRealProvider({ account, submittedCode }) {
  // Real integration point. Example shape for a provider like Karza/Signzy:
  //
  // const response = await fetch(`${KYC_PROVIDER_BASE_URL}/v1/verify`, {
  //   method: 'POST',
  //   headers: {
  //     'Authorization': `Bearer ${KYC_PROVIDER_API_KEY}`,
  //     'Content-Type': 'application/json',
  //   },
  //   body: JSON.stringify({
  //     reference_id: account.account_ref,
  //     pan_last_4_or_dob: submittedCode,
  //   }),
  // });
  // const data = await response.json();
  // return { verified: data.status === 'MATCH', provider: 'live', raw: data };
  //
  // Left unimplemented on purpose — wiring this up requires a live business
  // agreement with the provider, which is outside what this codebase can
  // supply. The mock path above is fully functional in the meantime.
  throw new Error(
    'KYC_PROVIDER_* is set but verifyCodeViaRealProvider() is not implemented — see comment in src/integrations/kyc.js'
  );
}

module.exports = { verifyCode, isConfigured };
