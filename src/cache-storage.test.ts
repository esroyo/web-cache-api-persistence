import {
    assert,
    assertEquals,
    assertExists,
    assertFalse,
    assertNotStrictEquals,
    assertRejects,
} from '@std/assert';
import { returnsNext, stub } from '@std/testing/mock';
import type { CacheStorageLike } from './types.ts';
import { CacheStorage } from './cache-storage.ts';

declare var caches: CacheStorageLike;

const now = () => (Math.floor(Date.now() / 1000) * 1000);
// Tests that should be ignored when the CacheStorage instance is not our ponyfill
const ignore = caches instanceof CacheStorage === false;

Deno.test('CacheStorage', async (t) => {
    await t.step('open()', async (t) => {
        const v1 = await caches.open('v1');

        await t.step('should resolve to a Cache instance', async () => {
            assertExists(v1);
        });

        await t.step(
            'should create a new Cache instance instance even when called with the same cache name',
            async () => {
                const anotherInstance = await caches.open('v1');
                assertNotStrictEquals(
                    v1,
                    anotherInstance,
                );
                await anotherInstance[Symbol.asyncDispose]?.();
            },
        );

        await caches.delete('v1');
        await v1[Symbol.asyncDispose]?.();
    });

    await t.step('has()', async (t) => {
        const v1 = await caches.open('v1');

        await t.step(
            'should resolve to true for that same cache name',
            async () => {
                assert(await caches.has('v1'));
            },
        );

        await t.step(
            'should resolve to false for another cache name',
            async () => {
                assertFalse(await caches.has('v2'));
            },
        );

        await t.step({
            name:
                'should resolve to true for caches with entries even when the have not been opened by the current CacheStorage instance',
            ignore, // Not worth testing in Deno
            fn: async () => {
                // Lets simulate that other pairs exist in the persistence layer bypassing CacheStorage
                // @ts-ignore
                await v1._persistence.put(
                    'v3',
                    new Request('http://localhost/hello'),
                    new Response('Hello, world!'),
                );
                assert(await caches.has('v3'));
                // clean up the simulated pair
                await caches.delete('v3');
            },
        });

        await caches.delete('v1');
        await v1[Symbol.asyncDispose]?.();
    });

    await t.step('delete()', async (t) => {
        const v1 = await caches.open('v1');

        await t.step(
            'should resolve to true when the given cache name exists',
            async () => {
                assert(await caches.has('v1'));
                assert(await caches.delete('v1'));
            },
        );

        await t.step(
            'should resolve to false when the given cache name has been deleted',
            async () => {
                assertFalse(await caches.has('v1'));
                assertFalse(await caches.delete('v1'));
            },
        );

        await t.step({
            name: 'should remove all stored reponses',
            ignore, // TODO: why does this not work in Deno?
            fn: async () => {
                {
                    const anotherInstance = await caches.open('v1');
                    const request = new Request('http://localhost/hello');
                    const response = new Response('Hello, world!');
                    await anotherInstance.put(request, response.clone());
                    const cachedResponses = await anotherInstance.matchAll();
                    assert(cachedResponses.length > 0);
                    await caches.delete('v1');
                    await anotherInstance[Symbol.asyncDispose]?.();
                }
                const anotherInstance = await caches.open('v1');
                const cachedResponses = await anotherInstance.matchAll();
                assert(cachedResponses.length === 0);
                await caches.delete('v1');
                await anotherInstance[Symbol.asyncDispose]?.();
            },
        });

        await caches.delete('v1');
        await v1[Symbol.asyncDispose]?.();
    });

    await t.step({
        name: 'keys()',
        ignore, // Not implemented in Deno
        fn: async (t) => {
            await t.step(
                'should resolve to a list of cache names that includes opened caches',
                async () => {
                    const v1 = await caches.open('v1');
                    const v2 = await caches.open('v2');
                    const cacheNames = await caches.keys();
                    assertEquals(cacheNames.length, 2);
                    assert(cacheNames.includes('v1'));
                    assert(cacheNames.includes('v2'));
                    await caches.delete('v1');
                    await caches.delete('v2');
                    await v1[Symbol.asyncDispose]?.();
                    await v2[Symbol.asyncDispose]?.();
                },
            );

            await t.step(
                'should include in the list not opened existing caches',
                async () => {
                    const v1 = await caches.open('v1');
                    const v2 = await caches.open('v2');
                    // Lets simulate that other pairs exist in the persistence layer bypassing CacheStorage
                    // @ts-ignore
                    await v1._persistence.put(
                        'v3',
                        new Request('http://localhost/hello'),
                        new Response('Hello, world!'),
                    );
                    const cacheNames = await caches.keys();
                    assertEquals(cacheNames.length, 3);
                    assert(cacheNames.includes('v1'));
                    assert(cacheNames.includes('v2'));
                    assert(cacheNames.includes('v3'));
                    await caches.delete('v1');
                    await caches.delete('v2');
                    await caches.delete('v3');
                    await v1[Symbol.asyncDispose]?.();
                    await v2[Symbol.asyncDispose]?.();
                },
            );
        },
    });

    await t.step({
        name: 'match()',
        ignore, // Not implemented in Deno
        fn: async (t) => {
            await t.step(
                'should return undefined if none of the caches matches',
                async () => {
                    const v1 = await caches.open('v1');
                    const v2 = await caches.open('v2');
                    const request = new Request('http://localhost/hello');
                    const cachedResponse = await caches.match(request);
                    assert(cachedResponse === undefined);
                    await caches.delete('v1');
                    await caches.delete('v2');
                    await v1[Symbol.asyncDispose]?.();
                    await v2[Symbol.asyncDispose]?.();
                },
            );

            await t.step(
                'should return the first matching response in the order returned by caches.keys()',
                async () => {
                    const v1 = await caches.open('v1');
                    const v2 = await caches.open('v2');
                    const v3 = await caches.open('v3');
                    const request = new Request('http://localhost/hello');
                    {
                        const response = new Response('Hello, world! #2');
                        await v2.put(request, response.clone());
                    }
                    {
                        const response = new Response('Hello, world! #3');
                        await v3.put(request, response.clone());
                    }
                    const cachedResponse = await caches.match(request);
                    assertEquals(
                        await cachedResponse?.text(),
                        'Hello, world! #2',
                    );
                    await caches.delete('v1');
                    await caches.delete('v2');
                    await caches.delete('v3');
                    await v1[Symbol.asyncDispose]?.();
                    await v2[Symbol.asyncDispose]?.();
                    await v3[Symbol.asyncDispose]?.();
                },
            );
        },
    });
});

Deno.test('Cache', async (t) => {
    const cacheName = 'v1';

    await t.step('put()', async (t) => {
        await t.step(
            'should store when the first argument is a Request instance',
            async () => {
                const cache = await caches.open(cacheName);
                const request = new Request('http://localhost/hello');
                const response = new Response('Hello, world!');
                await cache.put(request, response.clone());
                const cachedResponse = await cache.match(request);
                assertEquals(await cachedResponse?.text(), 'Hello, world!');
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        );

        await t.step(
            'should store when the first argument is a URL instance',
            async () => {
                const cache = await caches.open(cacheName);
                const request = new URL('http://localhost/hello');
                const response = new Response('Hello, world!');
                await cache.put(request, response.clone());
                const cachedResponse = await cache.match(request);
                assertEquals(await cachedResponse?.text(), 'Hello, world!');
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        );

        await t.step(
            'should store when the first argument is an string',
            async () => {
                const cache = await caches.open(cacheName);
                const request = 'http://localhost/hello';
                const response = new Response('Hello, world!');
                await cache.put(request, response.clone());
                const cachedResponse = await cache.match(request);
                assertEquals(await cachedResponse?.text(), 'Hello, world!');
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        );

        await t.step(
            'should throw if the request url scheme is not http/s',
            async () => {
                const cache = await caches.open(cacheName);
                assertRejects(
                    async () => {
                        const request = new Request(
                            `data:text/plain;base64,${btoa('ping')}`,
                        );
                        const response = new Response('Hello, world!');
                        await cache.put(request, response.clone());
                    },
                    TypeError,
                    'protocol',
                );
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        );

        await t.step(
            'should throw if the request method is not GET',
            async () => {
                const cache = await caches.open(cacheName);
                assertRejects(
                    async () => {
                        const request = new Request('http://localhost/hello', {
                            method: 'POST',
                        });
                        const response = new Response('Hello, world!');
                        await cache.put(request, response.clone());
                    },
                    TypeError,
                    'method',
                );
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        );

        await t.step(
            'should throw if the response is 206 Partial Content',
            async () => {
                const cache = await caches.open(cacheName);
                assertRejects(
                    async () => {
                        const request = new Request('http://localhost/hello');
                        const response = new Response('Hello, world!', {
                            status: 206,
                        });
                        await cache.put(request, response.clone());
                    },
                    TypeError,
                    '206',
                );
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        );

        await t.step(
            'should throw if the response Vary header contains *',
            async () => {
                const cache = await caches.open(cacheName);
                assertRejects(
                    async () => {
                        const request = new Request('http://localhost/hello');
                        const response = new Response('Hello, world!', {
                            headers: { 'vary': ' * ' },
                        });
                        await cache.put(request, response.clone());
                    },
                    TypeError,
                    '*',
                );
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        );

        await t.step(
            'should throw if the response body is disturbed',
            async () => {
                const cache = await caches.open(cacheName);
                assertRejects(
                    async () => {
                        const request = new Request('http://localhost/hello');
                        const response = new Response('Hello, world!');
                        await response.text();
                        await cache.put(request, response);
                    },
                    TypeError,
                    'used',
                );
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        );

        await t.step(
            'should replace an existing response when the request does match',
            async () => {
                const cache = await caches.open(cacheName);
                const requestWithHash = new Request(
                    'http://localhost/hello#title',
                );
                const response = new Response('Hello, world! #1');
                await cache.put(requestWithHash, response.clone());
                {
                    const cachedResponse = await cache.match(requestWithHash);
                    assertEquals(
                        await cachedResponse?.text(),
                        'Hello, world! #1',
                    );
                }
                // The hash is always disregarded so this is the same Request
                const requestWithAnotherHash = new Request(
                    'http://localhost/hello#content',
                );
                const updatedResponse = new Response('Hello, world! #2');
                await cache.put(
                    requestWithAnotherHash,
                    updatedResponse.clone(),
                );
                {
                    const cachedResponse = await cache.match(
                        requestWithAnotherHash,
                    );
                    assertEquals(
                        await cachedResponse?.text(),
                        'Hello, world! #2',
                    );
                }
                {
                    const cachedResponse = await cache.match(requestWithHash);
                    assertEquals(
                        await cachedResponse?.text(),
                        'Hello, world! #2',
                    );
                }
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        );

        await t.step(
            'should not replace an existing response when the request does not match',
            async () => {
                const cache = await caches.open(cacheName);
                const requestWithHash = new Request(
                    'http://localhost/hello#title',
                );
                const response = new Response('Hello, world! #1');
                await cache.put(requestWithHash, response.clone());
                {
                    const cachedResponse = await cache.match(requestWithHash);
                    assertEquals(
                        await cachedResponse?.text(),
                        'Hello, world! #1',
                    );
                }
                // The hash is always disregarded so this is the same Request
                const requestNotMatching = new Request(
                    'http://localhost/hello?foo',
                );
                const anotherResponse = new Response('Hello, world! #2');
                await cache.put(requestNotMatching, anotherResponse.clone());
                {
                    const cachedResponse = await cache.match(
                        requestNotMatching,
                    );
                    assertEquals(
                        await cachedResponse?.text(),
                        'Hello, world! #2',
                    );
                }
                {
                    const cachedResponse = await cache.match(requestWithHash);
                    assertEquals(
                        await cachedResponse?.text(),
                        'Hello, world! #1',
                    );
                }
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        );

        await t.step({
            name:
                'should expire the entry according to Cache-Control s-maxage response header (with priority over max-age)',
            ignore, // This is an adapter level decision
            fn: async () => {
                const cache = await caches.open(cacheName);
                const request = new Request('http://localhost/hello');
                const TTL = 1;
                // Note: s-maxage has priority over max-age
                const response = new Response('Hello, world!', {
                    headers: {
                        'date': new Date(now()).toUTCString(),
                        'cache-control':
                            `public, s-maxage=${TTL}, max-age=10000`,
                    },
                });
                await cache.put(request, response.clone());
                assert(
                    await cache.match(request),
                    'Failed asserting existence before expiration',
                );
                await new Promise((res) => {
                    setTimeout(res, TTL * 1000 + 10);
                });
                assertFalse(
                    await cache.match(request),
                    'Failed asserting non-existence after expiration',
                );
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        });

        await t.step({
            name:
                'should expire the entry according to Cache-Control max-age response header (with priority over Expires)',
            ignore, // This is an adapter level decision
            fn: async () => {
                const cache = await caches.open(cacheName);
                const request = new Request('http://localhost/hello');
                const TTL = 1;
                const response = new Response('Hello, world!', {
                    headers: {
                        'date': new Date(now()).toUTCString(),
                        'cache-control': `public, max-age=${TTL}`,
                        'expires': new Date(now() + TTL * 100000)
                            .toUTCString(),
                    },
                });
                await cache.put(request, response.clone());
                assert(
                    await cache.match(request),
                    'Failed asserting existence before expiration',
                );
                await new Promise((res) => {
                    setTimeout(res, TTL * 1000 + 10);
                });
                assertFalse(
                    await cache.match(request),
                    'Failed asserting non-existence after expiration',
                );
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        });

        await t.step({
            name:
                'should expire the entry according to Expires response header',
            ignore, // This is an adapter level decision
            fn: async () => {
                const cache = await caches.open(cacheName);
                const request = new Request('http://localhost/hello');
                const TTL = 1;
                const response = new Response('Hello, world!', {
                    headers: {
                        'expires': new Date(now() + TTL * 1000)
                            .toUTCString(),
                    },
                });
                await cache.put(request, response.clone());
                assert(await cache.match(request));
                await new Promise((res) => {
                    setTimeout(res, TTL * 1000 + 10);
                });
                assertFalse(await cache.match(request));
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        });

        await t.step({
            name:
                'should gracefully handle the absence of Date header (fallingback to now)',
            ignore, // This is an adapter level decision
            fn: async () => {
                const cache = await caches.open(cacheName);
                const request = new Request('http://localhost/hello');
                const TTL = 1;
                const response = new Response('Hello, world!', {
                    headers: {
                        'cache-control': `public, max-age=${TTL}`,
                    },
                });
                await cache.put(request, response.clone());
                assert(await cache.match(request));
                await new Promise((res) => {
                    setTimeout(res, TTL * 1000 + 10);
                });
                assertFalse(await cache.match(request));
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        });

        await t.step({
            name:
                'should expire the entry according to Cache-Control response header taking into account the upstream Age',
            ignore, // This is an adapter level decision
            fn: async () => {
                const cache = await caches.open(cacheName);
                const request = new Request('http://localhost/hello');
                const response = new Response('Hello, world!', {
                    headers: {
                        'date': new Date(now()).toUTCString(),
                        'age': '1',
                        'cache-control': 'public, max-age=2',
                    },
                });
                await cache.put(request, response.clone());
                assert(await cache.match(request));
                await new Promise((res) => {
                    setTimeout(res, 1000 + 10);
                });
                assertFalse(await cache.match(request));
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        });

        await t.step({
            name:
                'should keep non-expiring responses that have replace on expiring response',
            ignore, // This is an adapter level decision
            fn: async () => {
                const cache = await caches.open(cacheName);
                const request = new Request('http://localhost/hello');
                const TTL = 1;
                {
                    const response = new Response('Hello, world!', {
                        headers: {
                            'expires': new Date(now() + TTL * 1000)
                                .toUTCString(),
                        },
                    });
                    await cache.put(request, response.clone());
                }
                {
                    const response = new Response('Hello, world!');
                    await cache.put(request, response.clone());
                }
                assertEquals((await cache.matchAll(request)).length, 1);
                await new Promise((res) => {
                    setTimeout(res, TTL * 1000 + 10);
                });
                assertEquals((await cache.matchAll(request)).length, 1);
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        });

        await t.step({
            name: 'should not store if the response has already expired',
            ignore, // This is an adapter level decision
            fn: async () => {
                const cache = await caches.open(cacheName);
                const request = new Request('http://localhost/hello');
                const response = new Response('Hello, world!', {
                    headers: {
                        'date': new Date(now()).toUTCString(),
                        'age': '1',
                        'cache-control': 'public, max-age=1',
                    },
                });
                await cache.put(request, response.clone());
                assertFalse(await cache.match(request));
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        });
    });

    await t.step('match()', async (t) => {
        await t.step(
            'should retrieve the first existing cached request',
            async () => {
                const cache = await caches.open(cacheName);
                const request = new Request('http://localhost/hello');
                {
                    const response = new Response('Hello, world! #1');
                    await cache.put(request, response.clone());
                }
                {
                    const request = new Request('http://localhost/hello?foo');
                    const response = new Response('Hello, world! #2');
                    await cache.put(request, response.clone());
                }
                const cachedResponse = await cache.match(request, {
                    ignoreSearch: true,
                });
                assertEquals(
                    await cachedResponse?.text(),
                    'Hello, world! #1',
                );
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        );

        await t.step(
            'should return undefined if not exiting cached request',
            async () => {
                const cache = await caches.open(cacheName);
                const request = new Request('http://localhost/hello');
                const cachedResponse = await cache.match(request);
                assertEquals(
                    cachedResponse,
                    undefined,
                );
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        );

        await t.step({
            name:
                'should return undefined when request cotains "cache-control=no-cache" even if exists a cached request',
            ignore, // Not standard
            fn: async () => {
                const cache = await caches.open(cacheName);
                {
                    const request = new Request('http://localhost/hello');
                    const response = new Response('Hello, world!');
                    await cache.put(request, response.clone());
                }
                const request = new Request('http://localhost/hello', {
                    headers: { 'cache-control': 'no-cache' },
                });
                const cachedResponse = await cache.match(request);
                assertEquals(
                    cachedResponse,
                    undefined,
                );
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        });
    });

    await t.step({
        name: 'matchAll()',
        ignore, // Not implemented in Deno
        fn: async (t) => {
            await t.step(
                'should retrieve when the first argument is a Request instance',
                async () => {
                    const cache = await caches.open(cacheName);
                    const request = new Request('http://localhost/hello');
                    const response = new Response('Hello, world!');
                    await cache.put(request, response.clone());
                    const cachedResponses = await cache.matchAll(request);
                    assertEquals(
                        await cachedResponses?.[0]?.text(),
                        'Hello, world!',
                    );
                    await caches.delete(cacheName);
                    await cache[Symbol.asyncDispose]?.();
                },
            );

            await t.step(
                'should retrieve when the first argument is a URL instance',
                async () => {
                    const cache = await caches.open(cacheName);
                    const request = new URL('http://localhost/hello');
                    const response = new Response('Hello, world!');
                    await cache.put(request, response.clone());
                    const cachedResponses = await cache.matchAll(request);
                    assertEquals(
                        await cachedResponses?.[0]?.text(),
                        'Hello, world!',
                    );
                    await caches.delete(cacheName);
                    await cache[Symbol.asyncDispose]?.();
                },
            );

            await t.step(
                'should retrieve when the first argument is an string',
                async () => {
                    const cache = await caches.open(cacheName);
                    const request = 'http://localhost/hello';
                    const response = new Response('Hello, world!');
                    await cache.put(request, response.clone());
                    const cachedResponses = await cache.matchAll(request);
                    assertEquals(
                        await cachedResponses?.[0]?.text(),
                        'Hello, world!',
                    );
                    await caches.delete(cacheName);
                    await cache[Symbol.asyncDispose]?.();
                },
            );

            await t.step(
                'should not retrieve if the response has expired',
                async () => {
                    const cache = await caches.open(cacheName);
                    const request = new Request('http://localhost/hello');
                    const TTL = 1;
                    const response = new Response('Hello, world!', {
                        headers: {
                            'expires': new Date(now() + TTL * 1000)
                                .toUTCString(),
                        },
                    });
                    await cache.put(request, response.clone());
                    await new Promise((res) => {
                        setTimeout(res, TTL * 1000 + 10);
                    });
                    assertFalse(await cache.match(request));
                    await caches.delete(cacheName);
                    await cache[Symbol.asyncDispose]?.();
                },
            );

            await t.step(
                'should add the Age header to the response',
                async () => {
                    const cache = await caches.open(cacheName);
                    const request = new Request('http://localhost/hello');
                    const response = new Response('Hello, world!');
                    await cache.put(request, response.clone());
                    const cachedResponse = await cache.match(request);
                    const age = Number(cachedResponse?.headers.get('age'));
                    assert(age >= 0);
                    await caches.delete(cacheName);
                    await cache[Symbol.asyncDispose]?.();
                },
            );

            await t.step(
                'should add the Age header to the response taking into account upstream Age',
                async () => {
                    const cache = await caches.open(cacheName);
                    const request = new Request('http://localhost/hello');
                    const response = new Response('Hello, world!', {
                        headers: { 'Age': '10' },
                    });
                    await cache.put(request, response.clone());
                    await new Promise((res) => {
                        setTimeout(res, 100);
                    });
                    const cachedResponse = await cache.match(request);
                    const age = Number(cachedResponse?.headers.get('age'));
                    assert(age >= 10);
                    await caches.delete(cacheName);
                    await cache[Symbol.asyncDispose]?.();
                },
            );

            await t.step(
                'should return empty array if the request method is not GET',
                async () => {
                    const cache = await caches.open(cacheName);
                    const request = new Request('http://localhost/hello', {
                        method: 'POST',
                    });
                    const cachedResponses = await cache.matchAll(request);
                    assertEquals(cachedResponses.length, 0);
                    await caches.delete(cacheName);
                    await cache[Symbol.asyncDispose]?.();
                },
            );

            await t.step(
                'should retrieve if the request method is not GET and options.ignoreMethod',
                async () => {
                    const cache = await caches.open(cacheName);
                    {
                        const request = new Request('http://localhost/hello');
                        const response = new Response('Hello, world!');
                        await cache.put(request, response.clone());
                    }
                    const request = new Request('http://localhost/hello', {
                        method: 'POST',
                    });
                    const cachedResponses = await cache.matchAll(request, {
                        ignoreMethod: true,
                    });
                    assertEquals(cachedResponses.length, 1);
                    await caches.delete(cacheName);
                    await cache[Symbol.asyncDispose]?.();
                },
            );

            await t.step(
                'should disregard the fragment (hash) of the request',
                async () => {
                    const cache = await caches.open(cacheName);
                    const requestTitle = new Request(
                        'http://localhost/hello#title',
                    );
                    const requestContent = new Request(
                        'http://localhost/hello#content',
                    );
                    const response = new Response('Hello, world! #1');
                    const responseAlt = new Response('Hello, world! #2');
                    await cache.put(requestTitle, response.clone());
                    await cache.put(requestContent, responseAlt.clone());
                    const cachedResponsesTitle = await cache.matchAll(
                        requestTitle,
                    );
                    const cachedResponsesContent = await cache.matchAll(
                        requestContent,
                    );
                    assertEquals(
                        await cachedResponsesTitle?.[0]?.text(),
                        'Hello, world! #2',
                    );
                    assertEquals(
                        await cachedResponsesContent?.[0]?.text(),
                        'Hello, world! #2',
                    );
                    await caches.delete(cacheName);
                    await cache[Symbol.asyncDispose]?.();
                },
            );

            await t.step(
                'should not retrieve if the request search does not match',
                async () => {
                    const cache = await caches.open(cacheName);
                    {
                        const request = new Request('http://localhost/hello');
                        const response = new Response('Hello, world!');
                        await cache.put(request, response.clone());
                    }
                    const request = new Request('http://localhost/hello?foo');
                    const cachedResponses = await cache.matchAll(request);
                    assertEquals(cachedResponses.length, 0);
                    await caches.delete(cacheName);
                    await cache[Symbol.asyncDispose]?.();
                },
            );

            await t.step(
                'should retrieve if the request search does not match and options.ignoreSearch',
                async () => {
                    const cache = await caches.open(cacheName);
                    {
                        const request = new Request('http://localhost/hello');
                        const response = new Response('Hello, world!');
                        await cache.put(request, response.clone());
                    }
                    const request = new Request('http://localhost/hello?foo');
                    const cachedResponses = await cache.matchAll(request, {
                        ignoreSearch: true,
                    });
                    assertEquals(cachedResponses.length, 1);
                    await caches.delete(cacheName);
                    await cache[Symbol.asyncDispose]?.();
                },
            );

            await t.step(
                'should retrieve if the request Vary values match',
                async () => {
                    const cache = await caches.open(cacheName);
                    {
                        const request = new Request('http://localhost/hello', {
                            headers: { 'accept-encoding': 'deflate' },
                        });
                        const response = new Response('Hello, world!', {
                            headers: { 'vary': 'accept-encoding' },
                        });
                        await cache.put(request, response.clone());
                    }
                    const request = new Request('http://localhost/hello', {
                        headers: { 'accept-encoding': 'deflate' },
                    });
                    const cachedResponses = await cache.matchAll(request);
                    assertEquals(cachedResponses.length, 1);
                    await caches.delete(cacheName);
                    await cache[Symbol.asyncDispose]?.();
                },
            );

            await t.step(
                "should not retrieve if the request Vary values don't match",
                async () => {
                    const cache = await caches.open(cacheName);
                    {
                        const request = new Request('http://localhost/hello', {
                            headers: { 'accept-encoding': 'deflate' },
                        });
                        const response = new Response('Hello, world!', {
                            headers: { 'vary': 'accept-encoding' },
                        });
                        await cache.put(request, response.clone());
                    }
                    const request = new Request('http://localhost/hello', {
                        headers: { 'accept-encoding': 'deflate, gzip' },
                    });
                    const cachedResponses = await cache.matchAll(request);
                    assertEquals(cachedResponses.length, 0);
                    await caches.delete(cacheName);
                    await cache[Symbol.asyncDispose]?.();
                },
            );

            await t.step(
                "should retrieve if the request Vary values don't match, but normalize to the same value",
                async () => {
                    const cache = await caches.open(cacheName);
                    {
                        const request = new Request('http://localhost/hello', {
                            headers: { 'user-agent': 'firefox1' },
                        });
                        const response = new Response('Hello, world!', {
                            headers: { 'vary': 'accept-encoding, user-agent' },
                        });
                        await cache.put(request, response.clone());
                    }
                    const request = new Request('http://localhost/hello', {
                        headers: { 'user-agent': 'firefox2' },
                    });
                    const cachedResponses = await cache.matchAll(request);
                    assertEquals(cachedResponses.length, 1);
                    await caches.delete(cacheName);
                    await cache[Symbol.asyncDispose]?.();
                },
            );

            await t.step(
                "should retrieve if the request Vary values don't match and options.ignoreVary",
                async () => {
                    const cache = await caches.open(cacheName);
                    {
                        const request = new Request('http://localhost/hello', {
                            headers: { 'accept-encoding': 'deflate' },
                        });
                        const response = new Response('Hello, world!', {
                            headers: { 'vary': 'accept-encoding' },
                        });
                        await cache.put(request, response.clone());
                    }
                    const request = new Request('http://localhost/hello', {
                        headers: { 'accept-encoding': 'deflate, gzip' },
                    });
                    const cachedResponses = await cache.matchAll(request, {
                        ignoreVary: true,
                    });
                    assertEquals(cachedResponses.length, 1);
                    await caches.delete(cacheName);
                    await cache[Symbol.asyncDispose]?.();
                },
            );

            await t.step(
                'should retrieve everything when no request',
                async () => {
                    const cache = await caches.open(cacheName);
                    {
                        const request = new Request('http://localhost/hello');
                        const response = new Response('Hello, world!');
                        await cache.put(request, response.clone());
                    }
                    {
                        const request = new Request('http://localhost/another');
                        const response = new Response('Hello, world!');
                        await cache.put(request, response.clone());
                    }
                    const cachedResponses = await cache.matchAll();
                    assertEquals(cachedResponses.length, 2);
                    await caches.delete(cacheName);
                    await cache[Symbol.asyncDispose]?.();
                },
            );
        },
    });

    await t.step('delete()', async (t) => {
        await t.step(
            'should delete when the first argument is a Request instance',
            async () => {
                const cache = await caches.open(cacheName);
                const request = new Request('http://localhost/hello');
                const response = new Response('Hello, world!');
                await cache.put(request, response.clone());
                assert(await cache.delete(request));
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        );

        await t.step(
            'should delete when the first argument is a URL instance',
            async () => {
                const cache = await caches.open(cacheName);
                const request = new URL('http://localhost/hello');
                const response = new Response('Hello, world!');
                await cache.put(request, response.clone());
                assert(await cache.delete(request));
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        );

        await t.step(
            'should delete when the first argument is an string',
            async () => {
                const cache = await caches.open(cacheName);
                const request = 'http://localhost/hello';
                const response = new Response('Hello, world!');
                await cache.put(request, response.clone());
                assert(await cache.delete(request));
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        );

        await t.step('should return false if no match exists', async () => {
            const cache = await caches.open(cacheName);
            const request = new Request('http://localhost/hello');
            assertFalse(await cache.delete(request));
            await caches.delete(cacheName);
            await cache[Symbol.asyncDispose]?.();
        });

        await t.step(
            'should abort if the request method is other than GET',
            async () => {
                const cache = await caches.open(cacheName);
                {
                    const request = new Request('http://localhost/hello');
                    const response = new Response('Hello, world!');
                    await cache.put(request, response.clone());
                }
                const request = new Request('http://localhost/hello', {
                    method: 'POST',
                });
                assertFalse(await cache.delete(request));
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        );

        await t.step({
            name:
                'should delete if the request method is other than GET with options.ignoreMethod',
            ignore, // Not implemented in Deno
            fn: async () => {
                const cache = await caches.open(cacheName);
                {
                    const request = new Request('http://localhost/hello');
                    const response = new Response('Hello, world!');
                    await cache.put(request, response.clone());
                }
                const request = new Request('http://localhost/hello', {
                    method: 'POST',
                });
                assert(await cache.delete(request, { ignoreMethod: true }));
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        });

        await t.step(
            'should not delete if the request search does not match',
            async () => {
                const cache = await caches.open(cacheName);
                {
                    const request = new Request('http://localhost/hello');
                    const response = new Response('Hello, world!');
                    await cache.put(request, response.clone());
                }
                const request = new Request('http://localhost/hello?foo');
                assertFalse(await cache.delete(request));
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        );

        await t.step({
            name:
                'should delete if the request search does not match with option.ignoreSearch',
            ignore, // Not implemented in Deno
            fn: async () => {
                const cache = await caches.open(cacheName);
                {
                    const request = new Request('http://localhost/hello');
                    const response = new Response('Hello, world!');
                    await cache.put(request, response.clone());
                }
                const request = new Request('http://localhost/hello?foo');
                assert(await cache.delete(request, { ignoreSearch: true }));
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        });

        await t.step({
            name: "should not delete if the request Vary values don't match",
            ignore, // Not implemented in Deno
            fn: async () => {
                const cache = await caches.open(cacheName);
                {
                    const request = new Request('http://localhost/hello', {
                        headers: { 'accept-encoding': 'deflate' },
                    });
                    const response = new Response('Hello, world!', {
                        headers: { 'vary': 'accept-encoding' },
                    });
                    await cache.put(request, response.clone());
                }
                const request = new Request('http://localhost/hello', {
                    headers: { 'accept-encoding': 'deflate, gzip' },
                });
                assertFalse(await cache.delete(request));
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        });

        await t.step({
            name:
                "should delete if the request Vary values don't match, but normalize to the same value",
            ignore, // Not implemented in Deno
            fn: async () => {
                const cache = await caches.open(cacheName);
                {
                    const request = new Request('http://localhost/hello', {
                        headers: { 'user-agent': 'firefox1' },
                    });
                    const response = new Response('Hello, world!', {
                        headers: { 'vary': 'accept-encoding,user-agent' },
                    });
                    await cache.put(request, response.clone());
                }
                const request = new Request('http://localhost/hello', {
                    headers: { 'user-agent': 'firefox2' },
                });
                assert(await cache.delete(request));
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        });

        await t.step({
            name:
                "should delete if the request Vary values don't match and options.ignoreVary",
            ignore, // Not implemented in Deno
            fn: async () => {
                const cache = await caches.open(cacheName);
                {
                    const request = new Request('http://localhost/hello', {
                        headers: { 'accept-encoding': 'deflate' },
                    });
                    const response = new Response('Hello, world!', {
                        headers: { 'vary': 'accept-encoding' },
                    });
                    await cache.put(request, response.clone());
                }
                const request = new Request('http://localhost/hello', {
                    headers: { 'accept-encoding': 'deflate, gzip' },
                });
                assert(await cache.delete(request, { ignoreVary: true }));
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        });

        await t.step({
            name: 'should keep non-matching cached responses',
            ignore, // Not implemented in Deno
            fn: async () => {
                const cache = await caches.open(cacheName);
                {
                    const request = new Request('http://localhost/hello?foo');
                    const response = new Response('Hello, world! #1');
                    await cache.put(request, response.clone());
                }
                {
                    const request = new Request('http://localhost/hello');
                    const response = new Response('Hello, world! #2');
                    await cache.put(request, response.clone());
                }
                const request = new Request('http://localhost/hello?foo');
                assert(await cache.delete(request));
                assertEquals(
                    (await cache.matchAll(request, { ignoreSearch: true }))
                        .length,
                    1,
                );
                await caches.delete(cacheName);
                await cache[Symbol.asyncDispose]?.();
            },
        });
    });

    await t.step({
        name: 'add()',
        ignore, // Not implemented in Deno
        fn: async (t) => {
            await t.step(
                'should fetch the url and add the resulting response object to the cache',
                async () => {
                    const cache = await caches.open(cacheName);
                    const fetchStub = stub(
                        globalThis,
                        'fetch',
                        returnsNext([
                            Promise.resolve(new Response('Fetched!')),
                        ]),
                    );
                    const url = 'http://localhost/hello';
                    await cache.add(url);
                    const cachedResponse = await cache.match(url);
                    assertEquals(
                        await cachedResponse?.text(),
                        'Fetched!',
                    );
                    await caches.delete(cacheName);
                    fetchStub.restore();
                    await cache[Symbol.asyncDispose]?.();
                },
            );
        },
    });

    await t.step({
        name: 'addAll()',
        ignore, // Not implemented in Deno
        fn: async (t) => {
            await t.step(
                'should fetch all the urls and add the resulting response objects to the cache',
                async () => {
                    const cache = await caches.open(cacheName);
                    const fetchStub = stub(
                        globalThis,
                        'fetch',
                        returnsNext([
                            Promise.resolve(new Response('Fetched!')),
                            Promise.resolve(new Response('Fetched 2!')),
                        ]),
                    );
                    const urls = [
                        'http://localhost/hello',
                        'http://localhost/world',
                    ];
                    await cache.addAll(urls);
                    {
                        const cachedResponse = await cache.match(urls[0]);
                        assertEquals(
                            await cachedResponse?.text(),
                            'Fetched!',
                        );
                    }
                    {
                        const cachedResponse = await cache.match(urls[1]);
                        assertEquals(
                            await cachedResponse?.text(),
                            'Fetched 2!',
                        );
                    }
                    await caches.delete(cacheName);
                    fetchStub.restore();
                    await cache[Symbol.asyncDispose]?.();
                },
            );
        },
    });

    await t.step({
        name: 'keys()',
        ignore, // Not implemented in Deno
        fn: async (t) => {
            await t.step(
                'should return the cached request object',
                async () => {
                    const cache = await caches.open(cacheName);
                    {
                        const request = new Request('http://localhost/hello');
                        const response = new Response('Hello');
                        await cache.put(request, response.clone());
                    }
                    const request = new Request('http://localhost/world');
                    const response = new Response('World');
                    await cache.put(request, response.clone());
                    const cachedRequests = await cache.keys(request);
                    assertEquals(cachedRequests.length, 1);
                    assertEquals(
                        cachedRequests[0].url,
                        'http://localhost/world',
                    );
                    await caches.delete(cacheName);
                    await cache[Symbol.asyncDispose]?.();
                },
            );

            await t.step(
                'should return all request objects in the same order that they were inserted',
                async () => {
                    const cache = await caches.open(cacheName);
                    {
                        const request = new Request('http://localhost/hello');
                        const response = new Response('Hello');
                        await cache.put(request, response.clone());
                    }
                    {
                        const request = new Request('http://localhost/world');
                        const response = new Response('World');
                        await cache.put(request, response.clone());
                    }
                    const cachedRequests = await cache.keys();
                    assertEquals(cachedRequests.length, 2);
                    assertEquals(
                        cachedRequests[0].url,
                        'http://localhost/hello',
                    );
                    assertEquals(
                        cachedRequests[1].url,
                        'http://localhost/world',
                    );
                    await caches.delete(cacheName);
                    await cache[Symbol.asyncDispose]?.();
                },
            );
        },
    });

    await t.step({
        name: 'should flush pending batched operations when disposed',
        ignore, // Not possible to control this in native implementations
        fn: async (t) => {
            const requestOne = new Request('http://localhost/hello');
            const responseOne = new Response('Hello, world! #1');
            const requestTwo = new Request('http://localhost/hello?foo');
            const responseTwo = new Response('Hello, world! #2');
            {
                const cache = await caches.open(cacheName);
                // A couple of floating "put" operation
                cache.put(requestOne, responseOne.clone());
                cache.put(requestTwo, responseTwo.clone());
                // Without awaiting those operations, they are still not persisted
                const cachedResponses = await cache.matchAll(requestOne, {
                    ignoreSearch: true,
                });
                assertEquals(cachedResponses.length, 0);
                // After disposal they will have been persisted
                await cache[Symbol.asyncDispose]?.();
            }
            const cache = await caches.open(cacheName);
            const cachedResponses = await cache.matchAll(requestOne, {
                ignoreSearch: true,
            });
            assertEquals(cachedResponses.length, 2);
            assertEquals(await cachedResponses[0].text(), 'Hello, world! #1');
            assertEquals(await cachedResponses[1].text(), 'Hello, world! #2');
            await caches.delete(cacheName);
            await cache[Symbol.asyncDispose]?.();
        },
    });
});
