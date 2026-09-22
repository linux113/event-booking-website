/**
 * Razorpay Checkout loader (browser only).
 *
 * The checkout script is injected on demand rather than added to every page: no
 * third-party request happens until a customer actually decides to pay, and the
 * page keeps working if the script never loads (the wizard then reports that the
 * payment window is unavailable and the booking stays pending).
 *
 * The key secret is not here and cannot be — this module only receives the public
 * key id and the order id.
 */

const CHECKOUT_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
const SCRIPT_TIMEOUT_MS = 15_000;

type RazorpayCheckoutOptions = {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description?: string;
  prefill?: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  retry?: { enabled: boolean };
  modal?: { ondismiss?: () => void; confirm_close?: boolean; escape?: boolean };
  handler: (result: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }) => void;
};

type RazorpayCheckoutInstance = {
  open: () => void;
  close: () => void;
  on: (event: "payment.failed", callback: (payload: unknown) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance;
  }
}

let loadPromise: Promise<boolean> | null = null;

/** Injects the Checkout script once; resolves false if it cannot be loaded. */
export function loadRazorpayCheckout(): Promise<boolean> {
  if (typeof window === "undefined") {
    return Promise.resolve(false);
  }

  if (window.Razorpay) {
    return Promise.resolve(true);
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = new Promise<boolean>((resolve) => {
    const script = document.createElement("script");
    const timer = window.setTimeout(() => resolve(false), SCRIPT_TIMEOUT_MS);

    script.src = CHECKOUT_SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      window.clearTimeout(timer);
      resolve(Boolean(window.Razorpay));
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      resolve(false);
    };

    document.body.appendChild(script);
  });

  return loadPromise;
}

export type OpenCheckoutOptions = RazorpayCheckoutOptions;

/**
 * Opens the Checkout modal. Returns false when the script could not be loaded, so
 * the caller can tell the customer instead of leaving a dead button.
 */
export function openRazorpayCheckout(options: OpenCheckoutOptions, onFailed?: (reason: string) => void): boolean {
  if (typeof window === "undefined" || !window.Razorpay) {
    return false;
  }

  const instance = new window.Razorpay(options);

  if (onFailed) {
    instance.on("payment.failed", (payload) => {
      const description =
        typeof payload === "object" && payload !== null && "error" in payload
          ? String((payload as { error?: { description?: string } }).error?.description ?? "")
          : "";

      onFailed(description || "The payment was not completed.");
    });
  }

  instance.open();

  return true;
}
