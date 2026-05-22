import type { CacheHeaderNormalizer } from "./types.ts";

export function freshnessLifetimeMs(response: Response, now?: number): number {
  now = now ?? Date.now();
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
          const ageValue = Number(response.headers.get("age")) || 0;
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

export function isFreshResponse(response: Response, now?: number): boolean {
  return freshnessLifetimeMs(response, now) > 0;
}

export function isStaleResponse(response: Response, now?: number): boolean {
  return freshnessLifetimeMs(response, now) <= 0;
}

export function requestMatches(
  query: Request,
  cached: Request,
  response?: Response | null,
  options?: CacheQueryOptions & { ignoreRetention?: boolean },
  normalizer?: CacheHeaderNormalizer,
): boolean {
  const normalize = normalizer ??
    ((_name: string, value: string | null) => value);

  if (!options?.ignoreMethod && cached.method !== "GET") {
    return false;
  }
  const queryUrl = new URL(query.url);
  const cachedUrl = new URL(cached.url);
  if (options?.ignoreSearch) {
    queryUrl.search = "";
    cachedUrl.search = "";
  }
  queryUrl.hash = "";
  cachedUrl.hash = "";
  if (queryUrl.toString() !== cachedUrl.toString()) {
    return false;
  }
  if (
    response === null || response === undefined ||
    options?.ignoreVary ||
    !response.headers.has("vary")
  ) {
    return true;
  }
  const varyHeader = response.headers.get("vary");
  if (varyHeader) {
    for (const _fieldValue of varyHeader.toLowerCase().split(",")) {
      const fieldValue = _fieldValue.trim();
      if (
        fieldValue === "*" ||
        normalize(fieldValue, cached.headers.get(fieldValue)) !==
          normalize(fieldValue, query.headers.get(fieldValue))
      ) {
        return false;
      }
    }
  }
  return true;
}
