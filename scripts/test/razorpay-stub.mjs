/**
 * A stand-in for the Razorpay REST API, for verification runs only.
 *
 * This sandbox holds no Razorpay account, and inventing real credentials is not an
 * option, so the payment flow is proved against this local stub instead: it speaks
 * the two endpoints the app actually uses (`POST /v1/orders` and
 * `GET /v1/payments/:id`), does the same Basic-auth check Razorpay does, and hands
 * the harness the HMAC signing helpers so signatures are computed exactly the way
 * Razorpay computes them — with the harness's own throwaway secrets, never real
 * keys.
 *
 * What it does NOT do is pretend that a payment happened by itself: the harness has
 * to register a payment explicitly (`createPayment`), which is what Razorpay does
 * after a customer completes Checkout.
 *
 * Development-only: nothing here is imported by the app or deployed.
 */
import { createHmac } from "node:crypto";
import { createServer } from "node:http";

export async function startRazorpayStub({ keyId, keySecret, webhookSecret }) {
  const orders = new Map();
  const payments = new Map();
  const requests = [];
  let orderCounter = 0;
  let paymentCounter = 0;

  function send(response, status, body) {
    const payload = JSON.stringify(body);

    response.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
    });
    response.end(payload);
  }

  function isAuthorised(request) {
    const expected = `Basic ${Buffer.from(`${keyId}:${keySecret}`, "utf8").toString("base64")}`;

    return request.headers.authorization === expected;
  }

  async function readBody(request) {
    const chunks = [];

    for await (const chunk of request) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks).toString("utf8");
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const rawBody = await readBody(request);

    requests.push({
      method: request.method,
      path: url.pathname,
      authorization: request.headers.authorization ?? null,
      body: rawBody,
    });

    if (!isAuthorised(request)) {
      return send(response, 401, {
        error: { code: "BAD_REQUEST_ERROR", description: "Authentication failed" },
      });
    }

    if (request.method === "POST" && url.pathname === "/v1/orders") {
      let parsed;

      try {
        parsed = JSON.parse(rawBody);
      } catch {
        return send(response, 400, { error: { code: "BAD_REQUEST_ERROR", description: "Invalid JSON" } });
      }

      if (!Number.isInteger(parsed?.amount) || parsed.amount <= 0) {
        return send(response, 400, {
          error: {
            code: "BAD_REQUEST_ERROR",
            description: "amount must be a positive integer in paise",
          },
        });
      }

      orderCounter += 1;

      const order = {
        id: `order_TEST${String(orderCounter).padStart(12, "0")}`,
        entity: "order",
        amount: parsed.amount,
        amount_paid: 0,
        amount_due: parsed.amount,
        currency: parsed.currency ?? "INR",
        receipt: parsed.receipt ?? null,
        status: "created",
        notes: parsed.notes ?? {},
        created_at: Math.floor(Date.now() / 1000),
      };

      orders.set(order.id, order);

      return send(response, 200, order);
    }

    if (request.method === "GET" && url.pathname.startsWith("/v1/payments/")) {
      const paymentId = decodeURIComponent(url.pathname.replace("/v1/payments/", ""));
      const payment = payments.get(paymentId);

      if (!payment) {
        return send(response, 404, {
          error: { code: "BAD_REQUEST_ERROR", description: "The payment id does not exist" },
        });
      }

      return send(response, 200, payment);
    }

    return send(response, 404, {
      error: {
        code: "BAD_REQUEST_ERROR",
        description: `the stub has no route for ${request.method} ${url.pathname}`,
      },
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    orders,
    payments,

    /** Every request the app made, in order (for asserting what it sent). */
    get requests() {
      return [...requests];
    },

    /** `POST /v1/orders` requests only. */
    orderRequests() {
      return requests.filter((entry) => entry.method === "POST" && entry.path === "/v1/orders");
    },

    /** Parsed bodies of every order request. */
    orderBodies() {
      return this.orderRequests().map((entry) => JSON.parse(entry.body));
    },

    /**
     * Records a payment for an order, the way Razorpay does once Checkout finishes.
     * `status: "captured"` is a successful payment; `"failed"` is a declined one.
     */
    createPayment({ orderId, amount, status = "captured" }) {
      paymentCounter += 1;

      const order = orders.get(orderId);

      const payment = {
        id: `pay_TEST${String(paymentCounter).padStart(12, "0")}`,
        entity: "payment",
        amount: amount ?? order?.amount ?? 0,
        currency: order?.currency ?? "INR",
        order_id: orderId,
        status,
        method: "upi",
        captured: status === "captured",
      };

      payments.set(payment.id, payment);

      return payment;
    },

    /** The signature Razorpay Checkout returns to the browser: HMAC(order|payment). */
    checkoutSignature({ orderId, paymentId }) {
      return createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`, "utf8").digest("hex");
    },

    /** The signature Razorpay puts on a webhook delivery: HMAC(raw body). */
    webhookSignature(rawBody) {
      return createHmac("sha256", webhookSecret).update(rawBody, "utf8").digest("hex");
    },

    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
