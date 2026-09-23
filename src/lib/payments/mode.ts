/**
 * Razorpay key-mode guard (pure, no secrets).
 *
 * Razorpay test keys start with `rzp_test_`, live keys with `rzp_live_`. This
 * project is deliberately test-mode only: the server refuses to create an order
 * with a live key unless `RAZORPAY_ALLOW_LIVE=true` is set on purpose, so a live
 * credential cannot slip into a build by accident.
 *
 * Kept free of `server-only` and of any secret so it can be unit-tested directly.
 */

export function isLiveRazorpayKey(keyId: string): boolean {
  return keyId.trim().toLowerCase().startsWith("rzp_live_");
}

export function isTestRazorpayKey(keyId: string): boolean {
  return keyId.trim().toLowerCase().startsWith("rzp_test_");
}

/**
 * Describes why the configured key cannot be used, or null when it is fine.
 */
export function razorpayKeyIssue(keyId: string, allowLive: boolean): string | null {
  const trimmed = keyId.trim();

  if (trimmed.length === 0) {
    return "No Razorpay key id is configured.";
  }

  if (isLiveRazorpayKey(trimmed) && !allowLive) {
    return "Live Razorpay keys are disabled for this build: payments run in test mode only.";
  }

  return null;
}
