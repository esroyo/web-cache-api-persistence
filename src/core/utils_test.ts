import { assert, assertEquals } from "@std/assert";
import {
  freshnessLifetimeMs,
  isFreshResponse,
  isStaleResponse,
  requestMatches,
} from "./utils.ts";

const dateNow = new Date("Tue, 15 Nov 2024 12:00:00 GMT").getTime();

Deno.test("freshnessLifetimeMs", async (t) => {
  await t.step("Cache-Control: max-age with explicit Date", () => {
    const response = new Response(null, {
      headers: {
        "cache-control": "public, max-age=3600",
        "date": "Tue, 15 Nov 2024 12:00:00 GMT",
      },
    });
    assertEquals(freshnessLifetimeMs(response, dateNow), 3_600_000);
  });

  await t.step("Cache-Control: s-maxage takes priority over max-age", () => {
    const response = new Response(null, {
      headers: {
        "cache-control": "public, s-maxage=60, max-age=3600",
        "date": "Tue, 15 Nov 2024 12:00:00 GMT",
      },
    });
    assertEquals(freshnessLifetimeMs(response, dateNow), 60_000);
  });

  await t.step("Expires header when no Cache-Control max-age", () => {
    const response = new Response(null, {
      headers: {
        "expires": "Tue, 15 Nov 2024 13:00:00 GMT",
      },
    });
    assertEquals(freshnessLifetimeMs(response, dateNow), 3_600_000);
  });

  await t.step("Absence of Date header falls back to now", () => {
    const response = new Response(null, {
      headers: {
        "cache-control": "max-age=60",
      },
    });
    assertEquals(freshnessLifetimeMs(response, 1_000_000_000_000), 60_000);
  });

  await t.step("Upstream Age reduces freshness", () => {
    const response = new Response(null, {
      headers: {
        "cache-control": "public, max-age=60",
        "age": "30",
        "date": "Tue, 15 Nov 2024 12:00:00 GMT",
      },
    });
    assertEquals(freshnessLifetimeMs(response, dateNow), 30_000);
  });

  await t.step("Already-expired response returns 0", () => {
    const oneHourAgo = dateNow - 3_600_000;
    const response = new Response(null, {
      headers: {
        "cache-control": "max-age=60",
        "date": new Date(oneHourAgo).toUTCString(),
      },
    });
    assertEquals(freshnessLifetimeMs(response, oneHourAgo + 3_600_001), 0);
  });

  await t.step("No freshness headers returns 0", () => {
    const response = new Response(null, {});
    assertEquals(freshnessLifetimeMs(response, dateNow), 0);
  });
});

Deno.test("isFreshResponse / isStaleResponse", async (t) => {
  await t.step("isFreshResponse returns true for fresh response", () => {
    const response = new Response(null, {
      headers: {
        "cache-control": "max-age=3600",
        "date": "Tue, 15 Nov 2024 12:00:00 GMT",
      },
    });
    assert(isFreshResponse(response, dateNow));
  });

  await t.step("isFreshResponse returns false for stale response", () => {
    const response = new Response(null, {
      headers: {
        "cache-control": "max-age=0",
        "date": "Tue, 15 Nov 2024 12:00:00 GMT",
      },
    });
    assert(!isFreshResponse(response, dateNow));
  });

  await t.step("isStaleResponse returns false for fresh response", () => {
    const response = new Response(null, {
      headers: {
        "cache-control": "max-age=3600",
        "date": "Tue, 15 Nov 2024 12:00:00 GMT",
      },
    });
    assert(!isStaleResponse(response, dateNow));
  });

  await t.step("isStaleResponse returns true for stale response", () => {
    const response = new Response(null, {
      headers: {
        "cache-control": "max-age=0",
        "date": "Tue, 15 Nov 2024 12:00:00 GMT",
      },
    });
    assert(isStaleResponse(response, dateNow));
  });

  await t.step("Complement relationship holds", () => {
    const fresh = new Response(null, {
      headers: {
        "cache-control": "max-age=3600",
        "date": "Tue, 15 Nov 2024 12:00:00 GMT",
      },
    });
    const stale = new Response(null, {
      headers: {
        "cache-control": "max-age=0",
        "date": "Tue, 15 Nov 2024 12:00:00 GMT",
      },
    });
    assert(
      isFreshResponse(fresh, dateNow) === !isStaleResponse(fresh, dateNow),
    );
    assert(
      isFreshResponse(stale, dateNow) === !isStaleResponse(stale, dateNow),
    );
  });
});

Deno.test("requestMatches", async (t) => {
  await t.step("URL equality without hash returns true", () => {
    const query = new Request("http://example.com/foo");
    const cached = new Request("http://example.com/foo");
    assert(requestMatches(query, cached));
  });

  await t.step("Hash fragment is disregarded", () => {
    const query = new Request("http://example.com/foo#section");
    const cached = new Request("http://example.com/foo");
    assert(requestMatches(query, cached));
  });

  await t.step("Mismatched search returns false", () => {
    const query = new Request("http://example.com/foo?bar=1");
    const cached = new Request("http://example.com/foo");
    assert(!requestMatches(query, cached));
  });

  await t.step("ignoreSearch bypasses search mismatch", () => {
    const query = new Request("http://example.com/foo?bar=1");
    const cached = new Request("http://example.com/foo");
    assert(requestMatches(query, cached, null, { ignoreSearch: true }));
  });

  await t.step("Non-GET method returns false by default", () => {
    const query = new Request("http://example.com/foo", { method: "GET" });
    const cached = new Request("http://example.com/foo", { method: "POST" });
    assert(!requestMatches(query, cached));
  });

  await t.step("ignoreMethod allows non-GET", () => {
    const query = new Request("http://example.com/foo", { method: "GET" });
    const cached = new Request("http://example.com/foo", { method: "POST" });
    assert(requestMatches(query, cached, null, { ignoreMethod: true }));
  });

  await t.step("Vary header matching returns true", () => {
    const query = new Request("http://example.com/foo", {
      headers: { "accept-encoding": "gzip" },
    });
    const cached = new Request("http://example.com/foo", {
      headers: { "accept-encoding": "gzip" },
    });
    const response = new Response(null, {
      headers: { "vary": "Accept-Encoding" },
    });
    assert(requestMatches(query, cached, response));
  });

  await t.step("Vary mismatch returns false", () => {
    const query = new Request("http://example.com/foo", {
      headers: { "accept-encoding": "deflate" },
    });
    const cached = new Request("http://example.com/foo", {
      headers: { "accept-encoding": "gzip" },
    });
    const response = new Response(null, {
      headers: { "vary": "Accept-Encoding" },
    });
    assert(!requestMatches(query, cached, response));
  });

  await t.step("Normalizer reconciles different values", () => {
    const normalizer = (_name: string, value: string | null) =>
      value === "gzip, br" ? "gzip" : value;
    const query = new Request("http://example.com/foo", {
      headers: { "accept-encoding": "gzip, br" },
    });
    const cached = new Request("http://example.com/foo", {
      headers: { "accept-encoding": "gzip" },
    });
    const response = new Response(null, {
      headers: { "vary": "Accept-Encoding" },
    });
    assert(requestMatches(query, cached, response, undefined, normalizer));
  });

  await t.step("ignoreVary bypasses Vary comparison", () => {
    const query = new Request("http://example.com/foo", {
      headers: { "accept-encoding": "deflate" },
    });
    const cached = new Request("http://example.com/foo", {
      headers: { "accept-encoding": "gzip" },
    });
    const response = new Response(null, {
      headers: { "vary": "Accept-Encoding" },
    });
    assert(requestMatches(query, cached, response, { ignoreVary: true }));
  });
});
