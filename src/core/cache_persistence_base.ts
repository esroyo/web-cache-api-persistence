import { create3, type Hasher } from "@jabr/xxhash64";
import { monotonicUlid } from "@std/ulid";
import msgpack from "msgpack-lite";
import { type Codec } from "npm:@types/msgpack-lite@0.1.11";

import type {
  CachePersistenceBaseOptions,
  PlainReq,
  PlainReqRes,
  PlainReqResMeta,
  PlainRes,
} from "./types.ts";

export abstract class CachePersistenceBase {
  protected _decoder: TextDecoder = new TextDecoder();
  /**
   * Maximum time, in milliseconds, that an entry may remain in persistence.
   * Universal upper bound applied in every `staleRetention` mode and across
   * all bundled backends.
   *
   * This field is the storage-policy ceiling. It is distinct from HTTP
   * freshness (`_expiresIn(response)` is pure HTTP semantics and does NOT
   * read this field). Storage-lifetime clamping lives in
   * `_evictionDelay(httpExpiresIn)`.
   *
   * Initialised from `options.maxPersistenceTtlMs` in the base constructor.
   * Subclasses that pre-set this field at their declaration site or in
   * their own constructor continue to work: the base constructor only
   * overrides it when `options.maxPersistenceTtlMs` is explicitly provided.
   *
   * @default 2_592_000_000 (30 days)
   */
  protected _maxPersistenceTtlMs: number =
    2_592_000_000; /* 1000 * 60 * 60 * 24 * 30 */
  protected _staleRetention: "evict" | "retain" = "evict";
  protected _encoder: TextEncoder = new TextEncoder();
  protected _counter: Record<number, number> = Object.create(null);
  protected _hasherPromise: Promise<Hasher> = create3();
  protected _msgpackCodec: Codec = msgpack.createCodec({
    uint8array: true,
    preset: true,
  });
  protected _options: CachePersistenceBaseOptions = {};
  protected get _defaultOptions(): CachePersistenceBaseOptions {
    return {
      compress: false,
      staleRetention: "evict",
      maxPersistenceTtlMs: 2_592_000_000,
    };
  }

  constructor(options?: CachePersistenceBaseOptions) {
    if (options?.staleRetention !== undefined) {
      this._staleRetention = options.staleRetention;
    }
    if (options?.maxPersistenceTtlMs !== undefined) {
      this._maxPersistenceTtlMs = options.maxPersistenceTtlMs;
    }
  }

  protected _created(): readonly [number, number] {
    const now = Date.now();
    const count = this._counter[now] ?? 0;
    const created = [now, count] as const;
    this._counter[now] = count + 1;
    const past = now - 60_000;
    for (const timestamp in this._counter) {
      if (+timestamp < past) {
        delete this._counter[timestamp];
      }
    }
    return created;
  }

  protected async _randomId(): Promise<string> {
    return monotonicUlid();
  }

  protected async _persistenceKey(
    cacheName: string,
    requestOrPlainReq?: Request | (PlainReq & PlainReqResMeta),
    responseOrPlainRes?: Response | (PlainRes & PlainReqResMeta),
  ): Promise<string[]> {
    const keyParts = ["cachestorage", cacheName];
    if (requestOrPlainReq) {
      const isCachedRequest = !(requestOrPlainReq instanceof Request);
      const reqUrl = new URL(
        isCachedRequest ? requestOrPlainReq.reqUrl : requestOrPlainReq.url,
      );
      reqUrl.hash = "";
      reqUrl.search = "";
      keyParts.push(await this._digest(reqUrl.toString()));
      if (isCachedRequest) {
        keyParts.push(requestOrPlainReq.id);
      } else if (responseOrPlainRes) {
        const isCachedResponse = !(responseOrPlainRes instanceof Response);
        if (!isCachedResponse) {
          const internalId = responseOrPlainRes.headers.get(
            "x-cachestorage-id",
          );
          if (internalId) {
            keyParts.push(internalId);
          }
        } else {
          if (responseOrPlainRes.id) {
            keyParts.push(responseOrPlainRes.id);
          }
        }
      }
    }
    return keyParts;
  }

  protected async _digest(reqUrl: string): Promise<string> {
    return (await this._hasherPromise).hash(reqUrl, "hex") as string;
  }

  /**
   * Calculate the milliseconds left for this response to expire, per pure
   * HTTP freshness semantics (RFC 9111 §4.2.1).
   *
   * Returns `Math.round(msLeft)` for responses with `Cache-Control: max-age`
   * / `s-maxage` (s-maxage takes priority) or `Expires`. Returns `0` for
   * responses with neither — such responses have no explicit freshness
   * lifetime per RFC 9111 §4.2.1.
   *
   * This method represents pure HTTP semantics: it does NOT clamp at
   * `_maxPersistenceTtlMs`. Storage-lifetime clamping is the responsibility
   * of `_evictionDelay()`.
   */
  protected _expiresIn(
    response: Response,
  ): number {
    const now = Date.now();
    const cacheControl = response.headers.get("cache-control");
    const cacheControlParts = cacheControl?.split(",");
    if (cacheControl && cacheControlParts) {
      const includesMaxAge = cacheControl.includes("max-age");
      const includesSharedMaxAge = cacheControl.includes("s-maxage");
      const priorityFieldName = includesSharedMaxAge ? "s-maxage" : "max-age";
      if (includesMaxAge || includesSharedMaxAge) {
        for (const fieldValue of cacheControlParts) {
          const [field, value] = fieldValue.trim().split("=");
          if (field === priorityFieldName) {
            const dateValue = response.headers.get("date");
            const ageValue = Number(response.headers.get("age")) ||
              0;
            const dateTime = dateValue ? new Date(dateValue).getTime() : now;
            const correctedReceivedAge = Math.max(
              (now - dateTime) / 1000,
              ageValue,
            );
            const msLeft = Math.max(
              (+value - correctedReceivedAge) * 1000,
              0,
            );
            return Math.round(msLeft);
          }
        }
      }
    }
    const expireDate = response.headers.get("expires");
    if (expireDate) {
      const expireEpochMs = new Date(expireDate).getTime();
      const msLeft = Math.max(expireEpochMs - now, 0);
      return Math.round(msLeft);
    }
    return 0;
  }

  protected _hasExpired(meta: PlainReqResMeta): boolean {
    // Use `>=` so a header-less response (which gets
    // `expires === created`) is correctly classified as stale on the
    // very first read, even when `put` and `get` land in the same
    // millisecond. RFC 9111 §4.2.1: no explicit freshness directive
    // means no explicit freshness lifetime; under this library that
    // translates to "stale on arrival" rather than "fresh for one
    // millisecond".
    return Date.now() >= +meta.expires;
  }

  /**
   * Compute the eviction-primitive delay for a given HTTP-derived
   * freshness lifetime.
   *
   * - Under `'evict'`: `min(httpExpiresIn, maxPersistenceTtlMs)`. Entries
   *   are removed at the earlier of HTTP expiration or the storage
   *   ceiling.
   * - Under `'retain'`: `maxPersistenceTtlMs`. HTTP expiration does not
   *   shorten storage lifetime; the eviction primitive fires only at the
   *   ceiling.
   *
   * Storage-policy clamping lives here, not in `_expiresIn()`. The
   * eviction primitive is ALWAYS invoked in both modes — only the delay
   * value differs.
   */
  protected _evictionDelay(httpExpiresIn: number): number {
    return this._staleRetention === "evict"
      ? Math.min(httpExpiresIn, this._maxPersistenceTtlMs)
      : this._maxPersistenceTtlMs;
  }

  protected _plainToRequest({
    reqHeaders,
    reqMethod,
    reqUrl,
  }: PlainReq): Request {
    return new Request(
      reqUrl,
      {
        headers: reqHeaders,
        method: reqMethod,
      },
    );
  }

  protected _plainToResponse(
    {
      created,
      id,
      resBody,
      resHeaders,
      resStatus,
      resStatusText,
    }: PlainRes & PlainReqResMeta,
    options?: { stale?: boolean },
  ): Response {
    const now = Date.now();
    const age = Math.ceil((now - Number(created.split("-")[0])) / 1000);
    const upstreamAge =
      Number(resHeaders.find((pair) => pair[0] === "age")?.[1]) || 0;
    const cachedResponse = new Response(
      resBody ?? null,
      {
        headers: resHeaders,
        status: +resStatus,
        statusText: resStatusText,
      },
    );
    cachedResponse.headers.set("age", String(age + upstreamAge));
    cachedResponse.headers.set("x-cachestorage-id", id);
    if (options?.stale === true) {
      cachedResponse.headers.set("x-cachestorage-stale", "1");
    }
    return cachedResponse;
  }

  protected async _responseToPlain(response: Response): Promise<PlainRes> {
    const resBody = await response.text();
    return {
      ...(resBody.length ? { resBody } : undefined),
      resHeaders: [...response.headers.entries()],
      resStatus: String(response.status),
      resStatusText: response.statusText,
    };
  }

  protected async _requestToPlain(request: Request): Promise<PlainReq> {
    const reqUrl = new URL(request.url);
    reqUrl.hash = "";
    return {
      reqHeaders: [...request.headers.entries()],
      reqMethod: request.method,
      reqUrl: reqUrl.toString(),
    };
  }

  protected async _pairToPlain(
    request: Request,
    response: Response,
  ): Promise<[PlainReqRes, expiresIn: number] | null> {
    const expiresIn = this._expiresIn(response);
    // Under `'evict'`, a response without explicit HTTP freshness (per
    // RFC 9111 §4.2.1, `_expiresIn` returns 0) is not stored — there is
    // no freshness signal to justify caching. Under `'retain'`, the
    // entry IS stored: the application opted into retention and may
    // consult `x-cachestorage-stale` to decide what to do with the
    // immediately-stale entry.
    if (expiresIn <= 0 && this._staleRetention === "evict") {
      return null;
    }

    const [plainReq, plainRes] = await Promise.all([
      this._requestToPlain(request),
      this._responseToPlain(response),
    ]);
    const created = this._created();
    return [{
      created: created.join("-"),
      expires: String(created[0] + expiresIn),
      id: await this._randomId(),
      ...plainReq,
      ...plainRes,
    }, expiresIn];
  }

  protected _joinKey(key: string[]): string {
    return key.join(":");
  }

  protected _splitKey(key: string): string[] {
    return key.split(":");
  }

  protected _serialize(plainReqRes: PlainReqRes): Uint8Array {
    if (this._options.compress) {
      return msgpack.encode(plainReqRes, {
        codec: this._msgpackCodec,
      }) as Uint8Array;
    }
    return this._encoder.encode(JSON.stringify({
      ...plainReqRes,
      ...(plainReqRes.resBody &&
        { resBody: plainReqRes.resBody }),
    }));
  }

  protected _parse(serializedPlainReqRes: Uint8Array): PlainReqRes {
    if (this._options.compress) {
      return msgpack.decode(serializedPlainReqRes, {
        codec: this._msgpackCodec,
      });
    }
    const plainReqRes = JSON.parse(
      this._decoder.decode(serializedPlainReqRes),
    ) as PlainReqRes;
    return plainReqRes;
  }

  protected _compareFn(keyOne: string, keyTwo: string): number {
    const ulidOne = keyOne.slice(-26);
    const ulidTwo = keyTwo.slice(-26);
    if (ulidOne < ulidTwo) {
      return -1;
    }
    if (ulidOne > ulidTwo) {
      return 1;
    }
    return 0;
  }
}
