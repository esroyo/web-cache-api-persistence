import {
    assert,
    assertEquals,
    assertExists,
    assertFalse,
    assertNotStrictEquals,
    assertRejects,
    assertStrictEquals,
} from '@std/assert';
import type { CacheStorageLike } from './types.ts';
import { CacheStorage } from './cache-storage.ts';

declare var caches: CacheStorageLike;

const now = () => (Math.floor(Date.now() / 1000) * 1000);

Deno.test('CacheStorage', async (t) => {
    let cache: Cache | null = null;

    await t.step('open()', async (t) => {
        await t.step('should resolve to a Cache instance', async () => {
            cache = await caches.open('v1');
            assertExists(cache);
        });
        await t.step(
            'should resolve the same Cache instance for that same cache name',
            async () => {
                assertStrictEquals(
                    cache,
                    await caches.open('v1'),
                );
            },
        );
    });

    await t.step('has()', async (t) => {
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
    });

    await t.step('delete()', async (t) => {
        await t.step('should resolve to true for that cache name', async () => {
            assert(await caches.delete('v1'));
        });
        await t.step(
            'should resolve to false for that cache name (now deleted)',
            async () => {
                assertFalse(await caches.delete('v1'));
            },
        );
        await t.step(
            'should remove all stored reponses',
            async () => {
                {
                    const cache = await caches.open('v1');
                    const request = new Request('http://localhost/hello');
                    const response = new Response('Hello, world!');
                    await cache.put(request, response);
                    const cachedResponses = await cache.matchAll();
                    assert(cachedResponses.length > 0);
                    await caches.delete('v1');
                }
                const cache = await caches.open('v1');
                const cachedResponses = await cache.matchAll();
                assert(cachedResponses.length === 0);
                await caches.delete('v1');
            },
        );
    });

    await t.step('open()', async (t) => {
        await t.step(
            'should resolve to a new Cache instance (after deletion)',
            async () => {
                const secondCache = await caches.open('v1');
                assertNotStrictEquals(secondCache, cache);
            },
        );
    });

    await t.step({
        name: 'keys()',
        ignore: caches instanceof CacheStorage === false,
        fn: async (t) => {
            await t.step(
                'should resolve to a list of cache names',
                async () => {
                    await caches.open('v1');
                    await caches.open('v2');
                    const cacheNames = caches.keys();
                    assertEquals(cacheNames.length, 2);
                    assert(cacheNames.includes('v1'));
                    assert(cacheNames.includes('v2'));
                    await caches.delete('v1');
                    await caches.delete('v2');
                },
            );
        },
    });
});

Deno.test('Cache', async (t) => {
    await t.step('put()', async (t) => {
        await t.step(
            'should store when the first argument is a Request instance',
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                const request = new Request('http://localhost/hello');
                const response = new Response('Hello, world!');
                await cache.put(request, response);
                const cachedResponse = await cache.match(request);
                assertEquals(await cachedResponse?.text(), 'Hello, world!');
                await caches.delete(cacheName);
            },
        );

        await t.step(
            'should store when the first argument is a URL instance',
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                const request = new URL('http://localhost/hello');
                const response = new Response('Hello, world!');
                await cache.put(request, response);
                const cachedResponse = await cache.match(request);
                assertEquals(await cachedResponse?.text(), 'Hello, world!');
                await caches.delete(cacheName);
            },
        );

        await t.step(
            'should store when the first argument is an string',
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                const request = 'http://localhost/hello';
                const response = new Response('Hello, world!');
                await cache.put(request, response);
                const cachedResponse = await cache.match(request);
                assertEquals(await cachedResponse?.text(), 'Hello, world!');
                await caches.delete(cacheName);
            },
        );

        await t.step(
            'should throw if the request url scheme is not http/s',
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                assertRejects(
                    async () => {
                        const request = new Request(
                            `data:text/plain;base64,${btoa('ping')}`,
                        );
                        const response = new Response('Hello, world!');
                        await cache.put(request, response);
                    },
                    TypeError,
                    'protocol',
                );
                await caches.delete(cacheName);
            },
        );

        await t.step(
            'should throw if the request method is not GET',
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                assertRejects(
                    async () => {
                        const request = new Request('http://localhost/hello', {
                            method: 'POST',
                        });
                        const response = new Response('Hello, world!');
                        await cache.put(request, response);
                    },
                    TypeError,
                    'method',
                );
                await caches.delete(cacheName);
            },
        );

        await t.step(
            'should throw if the response is 206 Partial Content',
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                assertRejects(
                    async () => {
                        const request = new Request('http://localhost/hello');
                        const response = new Response('Hello, world!', {
                            status: 206,
                        });
                        await cache.put(request, response);
                    },
                    TypeError,
                    '206',
                );
                await caches.delete(cacheName);
            },
        );

        await t.step(
            'should throw if the response Vary header contains *',
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                assertRejects(
                    async () => {
                        const request = new Request('http://localhost/hello');
                        const response = new Response('Hello, world!', {
                            headers: { 'vary': ' * ' },
                        });
                        await cache.put(request, response);
                    },
                    TypeError,
                    '*',
                );
                await caches.delete(cacheName);
            },
        );

        await t.step(
            'should throw if the response body is disturbed',
            async () => {
                const cacheName = crypto.randomUUID();
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
            },
        );

        await t.step(
            'should disregard the fragment (hash) of the request',
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                caches.delete;
                const requestTitle = new Request(
                    'http://localhost/hello#title',
                );
                const requestContent = new Request(
                    'http://localhost/hello#content',
                );
                const response = new Response('Hello, world! #1');
                const responseAlt = new Response('Hello, world! #2');
                await cache.put(requestTitle, response);
                await cache.put(requestContent, responseAlt);
                {
                    const cachedResponse = await cache.match(requestTitle);
                    assertEquals(
                        await cachedResponse?.text(),
                        'Hello, world! #2',
                    );
                }
                {
                    const cachedResponse = await cache.match(requestContent);
                    assertEquals(
                        await cachedResponse?.text(),
                        'Hello, world! #2',
                    );
                }
                await caches.delete(cacheName);
            },
        );

        await t.step(
            'should expire the entry according to Expires response header',
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                const request = new Request('http://localhost/hello');
                const TTL = 1;
                const response = new Response('Hello, world!', {
                    headers: {
                        'expires': new Date(now() + TTL * 1000)
                            .toUTCString(),
                    },
                });
                await cache.put(request, response);
                assert(await cache.match(request));
                await new Promise((res) => {
                    setTimeout(res, TTL * 1000 + 10);
                });
                assertFalse(await cache.match(request));
                await caches.delete(cacheName);
            },
        );

        await t.step(
            'should expire the entry according to Cache-Control response header',
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                const request = new Request('http://localhost/hello');
                const TTL = 1;
                const response = new Response('Hello, world!', {
                    headers: {
                        'date': new Date(now()).toUTCString(),
                        'cache-control': `public, max-age=${TTL}`,
                    },
                });
                await cache.put(request, response);
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
            },
        );

        await t.step(
            'should gracefully handle the absence of Date header (fallingback to now)',
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                const request = new Request('http://localhost/hello');
                const TTL = 1;
                const response = new Response('Hello, world!', {
                    headers: {
                        'cache-control': `public, max-age=${TTL}`,
                    },
                });
                await cache.put(request, response);
                assert(await cache.match(request));
                await new Promise((res) => {
                    setTimeout(res, TTL * 1000 + 10);
                });
                assertFalse(await cache.match(request));
                await caches.delete(cacheName);
            },
        );

        await t.step(
            'should expire the entry according to Cache-Control response header taking into account the upstream Age',
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                const request = new Request('http://localhost/hello');
                const response = new Response('Hello, world!', {
                    headers: {
                        'date': new Date(now()).toUTCString(),
                        'age': '1',
                        'cache-control': 'public, max-age=2',
                    },
                });
                await cache.put(request, response);
                assert(await cache.match(request));
                await new Promise((res) => {
                    setTimeout(res, 1000 + 10);
                });
                assertFalse(await cache.match(request));
                await caches.delete(cacheName);
            },
        );

        await t.step({
            name: 'should keep non-expiring responses of the same request',
            ignore: caches instanceof CacheStorage === false,
            fn: async () => {
                const cacheName = crypto.randomUUID();
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
                    await cache.put(request, response);
                }
                {
                    const response = new Response('Hello, world!');
                    await cache.put(request, response);
                }
                assertEquals((await cache.matchAll(request)).length, 2);
                await new Promise((res) => {
                    setTimeout(res, TTL * 1000 + 10);
                });
                assertEquals((await cache.matchAll(request)).length, 1);
                await caches.delete(cacheName);
            },
        });

        await t.step(
            'should not store if the response has already expired',
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                const request = new Request('http://localhost/hello');
                const response = new Response('Hello, world!', {
                    headers: {
                        'date': new Date(now()).toUTCString(),
                        'age': '1',
                        'cache-control': 'public, max-age=1',
                    },
                });
                await cache.put(request, response);
                assertFalse(await cache.match(request));
                await caches.delete(cacheName);
            },
        );
    });

    await t.step('match()', async (t) => {
        await t.step(
            'should retrieve the last existing cached request',
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                const request = new Request('http://localhost/hello');
                {
                    const response = new Response('Hello, world! #1');
                    await cache.put(request, response);
                }
                {
                    const response = new Response('Hello, world! #2');
                    await cache.put(request, response);
                }
                const cachedResponse = await cache.match(request);
                assertEquals(
                    await cachedResponse?.text(),
                    'Hello, world! #2',
                );
                await caches.delete(cacheName);
            },
        );

        await t.step(
            'should return undefined if not exiting cached request',
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                const request = new Request('http://localhost/hello');
                const cachedResponse = await cache.match(request);
                assertEquals(
                    cachedResponse,
                    undefined,
                );
                await caches.delete(cacheName);
            },
        );
    });

    await t.step({
        name: 'matchAll()',
        ignore: caches instanceof CacheStorage === false,
        fn: async (t) => {
            await t.step(
                'should retrieve when the first argument is a Request instance',
                async () => {
                    const cacheName = crypto.randomUUID();
                    const cache = await caches.open(cacheName);
                    const request = new Request('http://localhost/hello');
                    const response = new Response('Hello, world!');
                    await cache.put(request, response);
                    await cache.put(request, response);
                    const cachedResponses = await cache.matchAll(request);
                    assertEquals(
                        await cachedResponses?.[0]?.text(),
                        'Hello, world!',
                    );
                    assertEquals(
                        await cachedResponses?.[1]?.text(),
                        'Hello, world!',
                    );
                    await caches.delete(cacheName);
                },
            );

            await t.step(
                'should retrieve when the first argument is a URL instance',
                async () => {
                    const cacheName = crypto.randomUUID();
                    const cache = await caches.open(cacheName);
                    const request = new URL('http://localhost/hello');
                    const response = new Response('Hello, world!');
                    await cache.put(request, response);
                    await cache.put(request, response);
                    const cachedResponses = await cache.matchAll(request);
                    assertEquals(
                        await cachedResponses?.[0]?.text(),
                        'Hello, world!',
                    );
                    assertEquals(
                        await cachedResponses?.[1]?.text(),
                        'Hello, world!',
                    );
                    await caches.delete(cacheName);
                },
            );

            await t.step(
                'should retrieve when the first argument is an string',
                async () => {
                    const cacheName = crypto.randomUUID();
                    const cache = await caches.open(cacheName);
                    const request = 'http://localhost/hello';
                    const response = new Response('Hello, world!');
                    await cache.put(request, response);
                    await cache.put(request, response);
                    const cachedResponses = await cache.matchAll(request);
                    assertEquals(
                        await cachedResponses?.[0]?.text(),
                        'Hello, world!',
                    );
                    assertEquals(
                        await cachedResponses?.[1]?.text(),
                        'Hello, world!',
                    );
                    await caches.delete(cacheName);
                },
            );

            await t.step(
                'should not retrieve if the response has expired',
                async () => {
                    const cacheName = crypto.randomUUID();
                    const cache = await caches.open(cacheName);
                    const request = new Request('http://localhost/hello');
                    const TTL = 1;
                    const response = new Response('Hello, world!', {
                        headers: {
                            'expires': new Date(now() + TTL * 1000)
                                .toUTCString(),
                        },
                    });
                    await cache.put(request, response);
                    await new Promise((res) => {
                        setTimeout(res, TTL * 1000 + 10);
                    });
                    assertFalse(await cache.match(request));
                    await caches.delete(cacheName);
                },
            );

            await t.step(
                'should add the Age header to the response',
                async () => {
                    const cacheName = crypto.randomUUID();
                    const cache = await caches.open(cacheName);
                    const request = new Request('http://localhost/hello');
                    const response = new Response('Hello, world!');
                    await cache.put(request, response);
                    const cachedResponse = await cache.match(request);
                    const age = Number(cachedResponse?.headers.get('age'));
                    assert(age >= 0);
                    await caches.delete(cacheName);
                },
            );

            await t.step(
                'should add the Age header to the response taking into account upstream Age',
                async () => {
                    const cacheName = crypto.randomUUID();
                    const cache = await caches.open(cacheName);
                    const request = new Request('http://localhost/hello');
                    const response = new Response('Hello, world!', {
                        headers: { 'Age': '10' },
                    });
                    await cache.put(request, response);
                    await new Promise((res) => {
                        setTimeout(res, 100);
                    });
                    const cachedResponse = await cache.match(request);
                    const age = Number(cachedResponse?.headers.get('age'));
                    assert(age >= 10);
                    await caches.delete(cacheName);
                },
            );

            await t.step(
                'should return empty array if the request method is not GET',
                async () => {
                    const cacheName = crypto.randomUUID();
                    const cache = await caches.open(cacheName);
                    const request = new Request('http://localhost/hello', {
                        method: 'POST',
                    });
                    const cachedResponses = await cache.matchAll(request);
                    assertEquals(cachedResponses.length, 0);
                    await caches.delete(cacheName);
                },
            );

            await t.step(
                'should retrieve if the request method is not GET and options.ignoreMethod',
                async () => {
                    const cacheName = crypto.randomUUID();
                    const cache = await caches.open(cacheName);
                    {
                        const request = new Request('http://localhost/hello');
                        const response = new Response('Hello, world!');
                        await cache.put(request, response);
                    }
                    const request = new Request('http://localhost/hello', {
                        method: 'POST',
                    });
                    const cachedResponses = await cache.matchAll(request, {
                        ignoreMethod: true,
                    });
                    assertEquals(cachedResponses.length, 1);
                    await caches.delete(cacheName);
                },
            );

            await t.step(
                'should disregard the fragment (hash) of the request',
                async () => {
                    const cacheName = crypto.randomUUID();
                    const cache = await caches.open(cacheName);
                    const requestTitle = new Request(
                        'http://localhost/hello#title',
                    );
                    const requestContent = new Request(
                        'http://localhost/hello#content',
                    );
                    const response = new Response('Hello, world! #1');
                    const responseAlt = new Response('Hello, world! #2');
                    await cache.put(requestTitle, response);
                    await cache.put(requestContent, responseAlt);
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
                    assertEquals(
                        await cachedResponsesTitle?.[1]?.text(),
                        'Hello, world! #1',
                    );
                    assertEquals(
                        await cachedResponsesContent?.[1]?.text(),
                        'Hello, world! #1',
                    );
                    await caches.delete(cacheName);
                },
            );

            await t.step(
                'should not retrieve if the request search does not match',
                async () => {
                    const cacheName = crypto.randomUUID();
                    const cache = await caches.open(cacheName);
                    {
                        const request = new Request('http://localhost/hello');
                        const response = new Response('Hello, world!');
                        await cache.put(request, response);
                    }
                    const request = new Request('http://localhost/hello?foo');
                    const cachedResponses = await cache.matchAll(request);
                    assertEquals(cachedResponses.length, 0);
                    await caches.delete(cacheName);
                },
            );

            await t.step(
                'should retrieve if the request search does not match and options.ignoreSearch',
                async () => {
                    const cacheName = crypto.randomUUID();
                    const cache = await caches.open(cacheName);
                    {
                        const request = new Request('http://localhost/hello');
                        const response = new Response('Hello, world!');
                        await cache.put(request, response);
                    }
                    const request = new Request('http://localhost/hello?foo');
                    const cachedResponses = await cache.matchAll(request, {
                        ignoreSearch: true,
                    });
                    assertEquals(cachedResponses.length, 1);
                    await caches.delete(cacheName);
                },
            );

            await t.step(
                'should retrieve if the request Vary values match',
                async () => {
                    const cacheName = crypto.randomUUID();
                    const cache = await caches.open(cacheName);
                    {
                        const request = new Request('http://localhost/hello', {
                            headers: { 'accept-encoding': 'deflate' },
                        });
                        const response = new Response('Hello, world!', {
                            headers: { 'vary': 'accept-encoding' },
                        });
                        await cache.put(request, response);
                    }
                    const request = new Request('http://localhost/hello', {
                        headers: { 'accept-encoding': 'deflate' },
                    });
                    const cachedResponses = await cache.matchAll(request);
                    assertEquals(cachedResponses.length, 1);
                    await caches.delete(cacheName);
                },
            );

            await t.step(
                "should not retrieve if the request Vary values don't match",
                async () => {
                    const cacheName = crypto.randomUUID();
                    const cache = await caches.open(cacheName);
                    {
                        const request = new Request('http://localhost/hello', {
                            headers: { 'accept-encoding': 'deflate' },
                        });
                        const response = new Response('Hello, world!', {
                            headers: { 'vary': 'accept-encoding' },
                        });
                        await cache.put(request, response);
                    }
                    const request = new Request('http://localhost/hello', {
                        headers: { 'accept-encoding': 'deflate, gzip' },
                    });
                    const cachedResponses = await cache.matchAll(request);
                    assertEquals(cachedResponses.length, 0);
                    await caches.delete(cacheName);
                },
            );

            await t.step(
                "should retrieve if the request Vary values don't match, but normalize to the same value",
                async () => {
                    const cacheName = crypto.randomUUID();
                    const cache = await caches.open(cacheName);
                    {
                        const request = new Request('http://localhost/hello', {
                            headers: { 'user-agent': 'firefox1' },
                        });
                        const response = new Response('Hello, world!', {
                            headers: { 'vary': 'accept-encoding,user-agent' },
                        });
                        await cache.put(request, response);
                    }
                    const request = new Request('http://localhost/hello', {
                        headers: { 'user-agent': 'firefox2' },
                    });
                    const cachedResponses = await cache.matchAll(request);
                    assertEquals(cachedResponses.length, 1);
                    await caches.delete(cacheName);
                },
            );

            await t.step(
                "should retrieve if the request Vary values don't match and options.ignoreVary",
                async () => {
                    const cacheName = crypto.randomUUID();
                    const cache = await caches.open(cacheName);
                    {
                        const request = new Request('http://localhost/hello', {
                            headers: { 'accept-encoding': 'deflate' },
                        });
                        const response = new Response('Hello, world!', {
                            headers: { 'vary': 'accept-encoding' },
                        });
                        await cache.put(request, response);
                    }
                    const request = new Request('http://localhost/hello', {
                        headers: { 'accept-encoding': 'deflate, gzip' },
                    });
                    const cachedResponses = await cache.matchAll(request, {
                        ignoreVary: true,
                    });
                    assertEquals(cachedResponses.length, 1);
                    await caches.delete(cacheName);
                },
            );

            await t.step(
                'should retrieve everything when no request',
                async () => {
                    const cacheName = crypto.randomUUID();
                    const cache = await caches.open(cacheName);
                    {
                        const request = new Request('http://localhost/hello');
                        const response = new Response('Hello, world!');
                        await cache.put(request, response);
                    }
                    {
                        const request = new Request('http://localhost/another');
                        const response = new Response('Hello, world!');
                        await cache.put(request, response);
                    }
                    const cachedResponses = await cache.matchAll();
                    assertEquals(cachedResponses.length, 2);
                    await caches.delete(cacheName);
                },
            );
        },
    });

    await t.step('delete()', async (t) => {
        await t.step(
            'should delete when the first argument is a Request instance',
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                const request = new Request('http://localhost/hello');
                const response = new Response('Hello, world!');
                await cache.put(request, response);
                assert(await cache.delete(request));
                await caches.delete(cacheName);
            },
        );

        await t.step(
            'should delete when the first argument is a URL instance',
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                const request = new URL('http://localhost/hello');
                const response = new Response('Hello, world!');
                await cache.put(request, response);
                assert(await cache.delete(request));
                await caches.delete(cacheName);
            },
        );

        await t.step(
            'should delete when the first argument is an string',
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                const request = 'http://localhost/hello';
                const response = new Response('Hello, world!');
                await cache.put(request, response);
                assert(await cache.delete(request));
                await caches.delete(cacheName);
            },
        );

        await t.step('should return false if no match exists', async () => {
            const cacheName = crypto.randomUUID();
            const cache = await caches.open(cacheName);
            const request = new Request('http://localhost/hello');
            assertFalse(await cache.delete(request));
            await caches.delete(cacheName);
        });

        await t.step(
            'should abort if the request method is other than GET',
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                {
                    const request = new Request('http://localhost/hello');
                    const response = new Response('Hello, world!');
                    await cache.put(request, response);
                }
                const request = new Request('http://localhost/hello', {
                    method: 'POST',
                });
                assertFalse(await cache.delete(request));
                await caches.delete(cacheName);
            },
        );

        await t.step(
            'should delete if the request method is other than GET with options.ignoreMethod',
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                {
                    const request = new Request('http://localhost/hello');
                    const response = new Response('Hello, world!');
                    await cache.put(request, response);
                }
                const request = new Request('http://localhost/hello', {
                    method: 'POST',
                });
                assert(await cache.delete(request, { ignoreMethod: true }));
                await caches.delete(cacheName);
            },
        );

        await t.step(
            'should not delete if the request search does not match',
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                {
                    const request = new Request('http://localhost/hello');
                    const response = new Response('Hello, world!');
                    await cache.put(request, response);
                }
                const request = new Request('http://localhost/hello?foo');
                assertFalse(await cache.delete(request));
                await caches.delete(cacheName);
            },
        );

        await t.step(
            'should delete if the request search does not match with option.ignoreSearch',
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                {
                    const request = new Request('http://localhost/hello');
                    const response = new Response('Hello, world!');
                    await cache.put(request, response);
                }
                const request = new Request('http://localhost/hello?foo');
                assert(await cache.delete(request, { ignoreSearch: true }));
                await caches.delete(cacheName);
            },
        );

        await t.step(
            "should not delete if the request Vary values don't match",
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                {
                    const request = new Request('http://localhost/hello', {
                        headers: { 'accept-encoding': 'deflate' },
                    });
                    const response = new Response('Hello, world!', {
                        headers: { 'vary': 'accept-encoding' },
                    });
                    await cache.put(request, response);
                }
                const request = new Request('http://localhost/hello', {
                    headers: { 'accept-encoding': 'deflate, gzip' },
                });
                assertFalse(await cache.delete(request));
                await caches.delete(cacheName);
            },
        );

        await t.step(
            "should delete if the request Vary values don't match, but normalize to the same value",
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                {
                    const request = new Request('http://localhost/hello', {
                        headers: { 'user-agent': 'firefox1' },
                    });
                    const response = new Response('Hello, world!', {
                        headers: { 'vary': 'accept-encoding,user-agent' },
                    });
                    await cache.put(request, response);
                }
                const request = new Request('http://localhost/hello', {
                    headers: { 'user-agent': 'firefox2' },
                });
                assert(await cache.delete(request));
                await caches.delete(cacheName);
            },
        );

        await t.step(
            "should delete if the request Vary values don't match and options.ignoreVary",
            async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                {
                    const request = new Request('http://localhost/hello', {
                        headers: { 'accept-encoding': 'deflate' },
                    });
                    const response = new Response('Hello, world!', {
                        headers: { 'vary': 'accept-encoding' },
                    });
                    await cache.put(request, response);
                }
                const request = new Request('http://localhost/hello', {
                    headers: { 'accept-encoding': 'deflate, gzip' },
                });
                assert(await cache.delete(request, { ignoreVary: true }));
                await caches.delete(cacheName);
            },
        );

        await t.step({
            name: 'should keep non-matching cached responses',
            ignore: caches instanceof CacheStorage === false,
            fn: async () => {
                const cacheName = crypto.randomUUID();
                const cache = await caches.open(cacheName);
                {
                    const request = new Request('http://localhost/hello?foo');
                    const response = new Response('Hello, world! #1');
                    await cache.put(request, response);
                }
                {
                    const request = new Request('http://localhost/hello');
                    const response = new Response('Hello, world! #2');
                    await cache.put(request, response);
                }
                const request = new Request('http://localhost/hello?foo');
                assert(await cache.delete(request));
                assertEquals(
                    (await cache.matchAll(request, { ignoreSearch: true }))
                        .length,
                    1,
                );
                await caches.delete(cacheName);
            },
        });
    });
});
