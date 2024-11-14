import { create3 } from '@jabr/xxhash64';
import { monotonicUlid } from '@std/ulid';
import type { PlainReq, PlainReqResMeta, PlainRes } from './types.ts';

export abstract class CachePersistenceBase {
    protected _decoder = new TextDecoder();
    protected _defaultExpireIn = 2_592_000_000; /* 1000 * 60 * 60 * 24 * 30 */
    protected _encoder = new TextEncoder();
    protected _counter: Record<number, number> = Object.create(null);
    protected _hasherPromise = create3();

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
        const keyParts = ['cachestorage', cacheName];
        if (requestOrPlainReq) {
            const isCachedRequest = !(requestOrPlainReq instanceof Request);
            const reqUrl = new URL(
                isCachedRequest
                    ? requestOrPlainReq.reqUrl
                    : requestOrPlainReq.url,
            );
            reqUrl.hash = '';
            reqUrl.search = '';
            keyParts.push(await this._digest(reqUrl.toString()));
            if (isCachedRequest) {
                keyParts.push(requestOrPlainReq.id);
            } else if (responseOrPlainRes) {
                const isCachedResponse =
                    !(responseOrPlainRes instanceof Response);
                if (!isCachedResponse) {
                    const internalId = responseOrPlainRes.headers.get(
                        'x-cachestorage-id',
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
        return (await this._hasherPromise).hash(reqUrl, 'hex') as string;
    }

    /** Calculate the milliseconds left for this response to expire */
    protected _expiresIn(
        response: Response,
    ): number {
        const now = Date.now();
        const expireDate = response.headers.get('expires');
        if (expireDate) {
            const expireEpochMs = new Date(expireDate).getTime();
            const msLeft = Math.max(expireEpochMs - now, 0);
            return Math.round(msLeft);
        }
        const cacheControl = response.headers.get('cache-control')?.split(',');
        if (cacheControl) {
            for (const fieldValue of cacheControl) {
                const [field, value] = fieldValue.trim().split('=');
                if (field === 'max-age') {
                    const dateValue = response.headers.get('date');
                    const ageValue = Number(response.headers.get('age')) || 0;
                    const dateTime = dateValue
                        ? new Date(dateValue).getTime()
                        : now;
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
        return this._defaultExpireIn;
    }

    protected _hasExpired(meta: PlainReqResMeta): boolean {
        return Date.now() > +meta.expires;
    }

    protected _plainToRequest({
        reqBody,
        reqHeaders,
        reqMethod,
        reqUrl,
    }: PlainReq): Request {
        return new Request(
            reqUrl,
            {
                ...(reqBody && { body: reqBody }),
                headers: reqHeaders,
                method: reqMethod,
            },
        );
    }

    protected _plainToResponse({
        created,
        id,
        resBody,
        resHeaders,
        resStatus,
        resStatusText,
    }: PlainRes & PlainReqResMeta): Response {
        const now = Date.now();
        const age = Math.ceil((now - Number(created.split('-')[0])) / 1000);
        const upstreamAge =
            Number(resHeaders.find((pair) => pair[0] === 'age')?.[1]) || 0;
        const cachedResponse = new Response(
            resBody ?? null,
            {
                headers: resHeaders,
                status: +resStatus,
                statusText: resStatusText,
            },
        );
        cachedResponse.headers.set('age', String(age + upstreamAge));
        cachedResponse.headers.set('x-cachestorage-id', id);
        return cachedResponse;
    }

    protected async _responseToPlain(res: Response): Promise<PlainRes> {
        const response = res.clone();
        const resBody = new Uint8Array(await response.arrayBuffer());
        return {
            ...(resBody.length ? { resBody } : undefined),
            resHeaders: [...response.headers.entries()],
            resStatus: String(response.status),
            resStatusText: response.statusText,
        };
    }

    protected async _requestToPlain(req: Request): Promise<PlainReq> {
        const request = req.clone();
        const reqUrl = new URL(request.url);
        reqUrl.hash = '';
        const reqBody = new Uint8Array(await request.arrayBuffer());
        return {
            ...(reqBody.length ? { reqBody } : undefined),
            reqHeaders: [...request.headers.entries()],
            reqMethod: request.method,
            reqUrl: reqUrl.toString(),
        };
    }

    protected _joinKey(key: string[]): string {
        return key.join(':');
    }

    protected _splitKey(key: string): string[] {
        return key.split(':');
    }
}
