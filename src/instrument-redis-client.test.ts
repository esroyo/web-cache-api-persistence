import { assertEquals } from '@std/assert';
import { assertSpyCalls, returnsNext, spy } from '@std/testing/mock';
import { instrumentRedisClient } from './instrument-redis-client.ts';

type InstrumenRedisClientParams = Parameters<typeof instrumentRedisClient>;
type PartialOpenTelemetry = NonNullable<InstrumenRedisClientParams[1]>;

const createRedisClientMock = (replies: Array<string | null>) => {
    const nextReply = returnsNext(replies);
    const redisClientMock = {
        sendCommand: spy(async (
            _c: string,
            _a?: string[],
            _o?: Record<string, unknown>,
        ): Promise<string | null> => nextReply()),
        pipeline: spy(function _pipe() {
            const acc: typeof replies = [];
            return ({
                sendCommand: spy(
                    (
                        _c: string,
                        _a?: string[],
                        _o?: Record<string, unknown>,
                    ): any => {
                        acc.push(nextReply());
                    },
                ),
                flush: spy(async () => acc),
                pipeline: _pipe,
            });
        }),
    };
    return redisClientMock;
};

const createOpenTelementryMock = (
    createSpanMock = spy(() => ({ end: spy(() => {}) })),
) => ({
    trace: {
        getTracer: spy(() => ({
            startActiveSpan: spy(
                (async (_n: string, _o: object, fn: (...args: any) => any) => {
                    return fn(createSpanMock());
                }) as ReturnType<
                    PartialOpenTelemetry['trace']['getTracer']
                >['startActiveSpan'],
            ),
        })),
    },
});

Deno.test('instrumentRedisClient', async (t) => {
    const originalClient = createRedisClientMock(['FOO']);
    const otelMock = createOpenTelementryMock();
    const client = await instrumentRedisClient(
        Promise.resolve(originalClient),
        otelMock as unknown as PartialOpenTelemetry,
    );

    await t.step('should return the same client', async () => {
        assertEquals(originalClient, client);
    });
});

Deno.test('when `sendCommand` is called', async (t) => {
    const originalClient = createRedisClientMock(['FOO']);
    const originalClientSendCommand = originalClient.sendCommand;
    const createSpanMock = spy(() => ({ end: spy(() => {}) }));
    const otelMock = createOpenTelementryMock(createSpanMock);
    const client = await instrumentRedisClient(
        Promise.resolve(originalClient),
        otelMock as unknown as PartialOpenTelemetry,
    );
    const args: Parameters<typeof client['sendCommand']> = [
        'GET',
        ['key'],
        {},
    ];
    const reply = await client.sendCommand(...args);

    await t.step('should start an active Span', async () => {
        assertSpyCalls(
            otelMock.trace.getTracer.calls[0].returned?.startActiveSpan!,
            1,
        );
    });

    await t.step('should add the Span attribute "command"', async () => {
        assertEquals(
            otelMock.trace.getTracer.calls[0].returned?.startActiveSpan.calls[0]
                .args[1].attributes?.['db.statement'],
            'GET key',
        );
    });

    await t.step('should forward the `sendCommand` call ', async () => {
        assertEquals(
            args,
            originalClientSendCommand.calls[0].args,
        );
        assertEquals(originalClientSendCommand.calls[0].self, originalClient);
    });

    await t.step(
        'should end the Span once the `sendCommand` promise settles',
        async () => {
            assertSpyCalls(createSpanMock, 1);
            assertSpyCalls(createSpanMock.calls[0].returned?.end!, 1);
        },
    );

    await t.step(
        'should return the same value returned by the original `sendCommand`',
        async () => {
            assertEquals(
                reply,
                await originalClientSendCommand.calls[0].returned,
            );
        },
    );
});

Deno.test('when `pipeline` is used', async (t) => {
    const originalClient = createRedisClientMock(['FOO', 'BAR']);
    const originalClientPipeline = originalClient.pipeline;
    const createSpanMock = spy(() => ({ end: spy(() => {}) }));
    const otelMock = createOpenTelementryMock(createSpanMock);
    const client = await instrumentRedisClient(
        Promise.resolve(originalClient),
        otelMock as unknown as PartialOpenTelemetry,
    );

    const pl = client.pipeline();

    await t.step('should not start an active Span', async () => {
        for (const getTracerCalls of otelMock.trace.getTracer.calls) {
            assertSpyCalls(
                getTracerCalls.returned?.startActiveSpan!,
                0,
            );
        }
    });

    await t.step('should forward the `pipeline` call ', async () => {
        assertSpyCalls(
            originalClientPipeline,
            1,
        );
        assertEquals(originalClientPipeline.calls[0].self, originalClient);
    });

    const args: Parameters<typeof client['sendCommand']> = [
        'GET',
        ['key'],
        {},
    ];
    pl.sendCommand(...args);
    pl.sendCommand(...args);

    await t.step('should not start an active Span', async () => {
        for (const getTracerCalls of otelMock.trace.getTracer.calls) {
            assertSpyCalls(
                getTracerCalls.returned?.startActiveSpan!,
                0,
            );
        }
    });

    await t.step('when flush is called', async (t) => {
        const reply = await pl.flush();

        await t.step('should start an active Span', async () => {
            assertSpyCalls(
                otelMock.trace.getTracer.calls.at(-1)?.returned
                    ?.startActiveSpan!,
                1,
            );
        });

        await t.step('should add the Span attribute "command"', async () => {
            assertEquals(
                otelMock.trace.getTracer.calls.at(-1)?.returned?.startActiveSpan
                    .calls[0]
                    .args[1].attributes?.['db.statement'],
                'PIPELINE | GET key | GET key',
            );
        });

        await t.step(
            'should end the Span once the `flush` promise settles',
            async () => {
                assertSpyCalls(createSpanMock, 1);
                assertSpyCalls(createSpanMock.calls[0].returned?.end!, 1);
            },
        );

        await t.step(
            'should return the same value returned by the original `flush`',
            async () => {
                assertEquals(reply, ['FOO', 'BAR']);
            },
        );
    });
});
