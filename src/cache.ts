import type {
    CacheHeaderNormalizer,
    CacheLike,
    CachePersistenceLike,
} from './types.ts';
import * as webidl from './webidl.ts';

export class Cache implements CacheLike {
    constructor(
        protected _cacheName: string,
        protected _persistence: CachePersistenceLike,
        protected _normalizeHeader: CacheHeaderNormalizer,
    ) {}

    /**
     * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/put)
     *
     * [W3C Specification](https://w3c.github.io/ServiceWorker/#dom-cache-put)
     */
    async put(
        requestOrUrl: RequestInfo | URL,
        response: Response,
    ): Promise<void> {
        const prefix = "Failed to execute 'put' on 'Cache'";
        webidl.requiredArguments(arguments.length, 2, prefix);
        // Step 1.
        let request: Request | null = null;
        // Step 2.
        if (requestOrUrl instanceof Request) {
            request = requestOrUrl;
        } else {
            // Step 3.
            request = new Request(requestOrUrl);
        }
        // Step 4.
        const reqUrl = new URL(request.url);
        if (reqUrl.protocol !== 'http:' && reqUrl.protocol !== 'https:') {
            throw new TypeError(
                `Request url protocol must be 'http:' or 'https:': received '${reqUrl.protocol}'`,
            );
        }
        if (request.method !== 'GET') {
            throw new TypeError('Request method must be GET');
        }
        // Step 5.
        // Step 6.
        if (response.status === 206) {
            throw new TypeError('Response status must not be 206');
        }
        // Step 7.
        const varyHeader = response.headers.get('vary');
        if (varyHeader) {
            for (const fieldValue of varyHeader.split(',')) {
                if (fieldValue.trim() === '*') {
                    throw new TypeError('Vary header must not contain "*"');
                }
            }
        }

        // Step 8.
        if (response.body !== null && response.bodyUsed) {
            throw new TypeError('Response body is already used');
        }

        await this._persistence.put(this._cacheName, request, response);
    }

    /**
     * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/delete)
     *
     * [W3C Specification](https://w3c.github.io/ServiceWorker/#cache-delete)
     */
    async delete(
        requestOrUrl: RequestInfo | URL,
        options?: CacheQueryOptions,
    ): Promise<boolean> {
        const prefix = "Failed to execute 'delete' on 'Cache'";
        webidl.requiredArguments(arguments.length, 1, prefix);
        // Step 1.
        let request: Request | null = null;
        // Step 2.
        if (requestOrUrl instanceof Request) {
            request = requestOrUrl;
            if (!options?.ignoreMethod && request.method !== 'GET') {
                return false;
            }
        } else {
            request = new Request(requestOrUrl);
        }

        let hasDeleted = false;
        for await (
            const [cachedRequest, cachedResponse] of this._persistence.get(
                this._cacheName,
                request,
            )
        ) {
            if (
                this._requestMatchesCachedItem(
                    request,
                    cachedRequest,
                    cachedResponse,
                    options,
                )
            ) {
                if (
                    await this._persistence.delete(
                        this._cacheName,
                        request,
                        cachedResponse,
                    )
                ) {
                    hasDeleted = true;
                }
            }
        }

        return hasDeleted;
    }

    /**
     * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/match)
     *
     * [W3C Specification](https://w3c.github.io/ServiceWorker/#cache-match)
     */
    async match(
        request: RequestInfo | URL,
        options?: CacheQueryOptions,
    ): Promise<Response | undefined> {
        const prefix = "Failed to execute 'match' on 'Cache'";
        webidl.requiredArguments(arguments.length, 1, prefix);
        const p = await this._matchMax(1, false, request, options);
        if (p.length > 0) {
            return p[0];
        }
    }

    /**
     * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/matchAll)
     *
     * [W3C Specification](https://w3c.github.io/ServiceWorker/#cache-matchall)
     */
    async matchAll(
        requestOrUrl?: RequestInfo | URL,
        options?: CacheQueryOptions,
    ): Promise<ReadonlyArray<Response>> {
        const responses = await this._matchMax(
            Infinity,
            false,
            requestOrUrl,
            options,
        );
        return Object.freeze(responses);
    }

    protected async _matchMax(
        max: number,
        keys: false,
        requestOrUrl?: RequestInfo | URL,
        options?: CacheQueryOptions,
    ): Promise<Array<Response>>;
    protected async _matchMax(
        max: number,
        keys: true,
        requestOrUrl?: RequestInfo | URL,
        options?: CacheQueryOptions,
    ): Promise<Array<Request>>;
    protected async _matchMax(
        max: number,
        keys: boolean,
        requestOrUrl?: RequestInfo | URL,
        options?: CacheQueryOptions,
    ): Promise<Array<Response | Request>> {
        // Step 1.
        let request: Request | null = null;
        // Step 2.
        if (requestOrUrl instanceof Request) {
            request = requestOrUrl;
            if (!options?.ignoreMethod && request.method !== 'GET') {
                return [];
            }
        } else if (requestOrUrl) {
            request = new Request(requestOrUrl);
        }

        // Step 5.
        const responsesOrRequests: Array<Response | Request> = [];
        // Step 5.2
        if (!request) {
            // Step 5.3
            // Note: we have to return all responses in the cache when
            // the request is null.
            for await (
                const [cachedRequest, cachedResponse] of this._persistence
                    [Symbol.asyncIterator](this._cacheName)
            ) {
                responsesOrRequests.push(keys ? cachedRequest : cachedResponse);
                if (responsesOrRequests.length >= max) {
                    break;
                }
            }
            return responsesOrRequests;
        }

        for await (
            const [cachedRequest, cachedResponse] of this._persistence.get(
                this._cacheName,
                request,
            )
        ) {
            if (
                this._requestMatchesCachedItem(
                    request,
                    cachedRequest,
                    cachedResponse,
                    options,
                )
            ) {
                responsesOrRequests.push(keys ? cachedRequest : cachedResponse);
                if (responsesOrRequests.length >= max) {
                    break;
                }
            }
        }

        return responsesOrRequests;
    }

    /** See https://w3c.github.io/ServiceWorker/#request-matches-cached-item */
    protected _requestMatchesCachedItem(
        requestQuery: Request,
        request: Request,
        response: Response | null = null,
        options?: CacheQueryOptions,
    ): boolean {
        // Step 1.
        if (!options?.ignoreMethod && request.method !== 'GET') {
            return false;
        }
        // Step 2.
        const queryUrl = new URL(requestQuery.url);
        // Step 3.
        const cachedUrl = new URL(request.url);
        // Step 4.
        if (options?.ignoreSearch) {
            queryUrl.search = '';
            cachedUrl.search = '';
        }
        queryUrl.hash = '';
        cachedUrl.hash = '';
        // Step 5.
        if (queryUrl.toString() !== cachedUrl.toString()) {
            return false;
        }
        // Step 6.
        if (
            response === null ||
            options?.ignoreVary ||
            !response.headers.has('vary')
        ) {
            return true;
        }
        // Step 7.
        const varyHeader = response.headers.get('vary');
        if (varyHeader) {
            for (const fieldValue of varyHeader.split(',')) {
                if (
                    fieldValue.trim() === '*' ||
                    this._normalizeHeader(
                            fieldValue,
                            request.headers.get(fieldValue),
                        ) !==
                        this._normalizeHeader(
                            fieldValue,
                            requestQuery.headers.get(fieldValue),
                        )
                ) {
                    return false;
                }
            }
        }

        return true;
    }

    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/add) */
    async add(url: RequestInfo | URL): Promise<undefined> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new TypeError('bad response status');
        }
        await this.put(url, response);
    }

    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/addAll) */
    async addAll(urls: Array<RequestInfo | URL>): Promise<undefined> {
        for (const url of urls) {
            await this.add(url);
        }
    }

    /**[MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/keys) */
    async keys(
        requestOrUrl?: RequestInfo | URL,
        options?: CacheQueryOptions,
    ): Promise<ReadonlyArray<Request>> {
        const requests = await this._matchMax(
            Infinity,
            true,
            requestOrUrl,
            options,
        );
        return Object.freeze(requests.reverse());
    }
}
