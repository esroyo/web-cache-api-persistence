import { create3, type Hasher } from '@jabr/xxhash64';
import { monotonicUlid } from '@std/ulid';
import msgpack from 'msgpack-lite';
import { type Codec } from 'npm:@types/msgpack-lite@0.1.11';

import type {
    CachePersistenceBaseOptions,
    PlainReq,
    PlainReqRes,
    PlainReqResMeta,
    PlainRes,
} from './types.ts';

export abstract class CachePersistenceBase {
    protected _decoder: TextDecoder = new TextDecoder();
    protected _maxExpireIn: number =
        2_592_000_000; /* 1000 * 60 * 60 * 24 * 30 */
    protected _encoder: TextEncoder = new TextEncoder();
    protected _counter: Record<number, number> = Object.create(null);
    protected _hasherPromise: Promise<Hasher> = create3();
    protected _msgpackCodec: Codec = msgpack.createCodec({
        uint8array: true,
        preset: true,
    });
    protected _options: CachePersistenceBaseOptions = {};
    protected get _defaultOptions(): CachePersistenceBaseOptions {
        return { compress: false };
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
        const cacheControl = response.headers.get('cache-control');
        const cacheControlParts = cacheControl?.split(',');
        if (cacheControl && cacheControlParts) {
            const includesMaxAge = cacheControl.includes('max-age');
            const includesSharedMaxAge = cacheControl.includes('s-maxage');
            const priorityFieldName = includesSharedMaxAge
                ? 's-maxage'
                : 'max-age';
            if (includesMaxAge || includesSharedMaxAge) {
                for (const fieldValue of cacheControlParts) {
                    const [field, value] = fieldValue.trim().split('=');
                    if (field === priorityFieldName) {
                        const dateValue = response.headers.get('date');
                        const ageValue = Number(response.headers.get('age')) ||
                            0;
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
                        return Math.min(Math.round(msLeft), this._maxExpireIn);
                    }
                }
            }
        }
        const expireDate = response.headers.get('expires');
        if (expireDate) {
            const expireEpochMs = new Date(expireDate).getTime();
            const msLeft = Math.max(expireEpochMs - now, 0);
            return Math.min(Math.round(msLeft), this._maxExpireIn);
        }
        return this._maxExpireIn;
    }

    protected _hasExpired(meta: PlainReqResMeta): boolean {
        return Date.now() > +meta.expires;
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
        reqUrl.hash = '';
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
        if (expiresIn <= 0) {
            return null;
        }

        const [plainReq, plainRes] = await Promise.all([
            this._requestToPlain(request),
            this._responseToPlain(response),
        ]);
        const created = this._created();
        return [{
            created: created.join('-'),
            expires: String(created[0] + expiresIn),
            id: await this._randomId(),
            ...plainReq,
            ...plainRes,
        }, expiresIn];
    }

    protected _joinKey(key: string[]): string {
        return key.join(':');
    }

    protected _splitKey(key: string): string[] {
        return key.split(':');
    }

    protected _serialize(plainReqRes: PlainReqRes): Uint8Array {
        if (this._options.compress) {
            return msgpack.encode(plainReqRes, { codec: this._msgpackCodec });
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
}
