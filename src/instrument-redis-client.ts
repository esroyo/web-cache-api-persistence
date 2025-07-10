import opentelemetry, { SpanKind } from '@opentelemetry/api';
import type { RedisReply, RedisValue, SendCommandOptions } from '@db/redis';
import type { OpenTelemetry, RedisClient } from './types.ts';

type PartialOpenTelemetry = {
    trace: {
        getTracer: (
            name: string,
        ) => Pick<
            ReturnType<OpenTelemetry['trace']['getTracer']>,
            'startActiveSpan'
        >;
    };
};

const createDefaultSpanOptions = (attrs = {}) => ({
    kind: SpanKind.CLIENT,
    attributes: {
        'span.type': 'cache',
        ...attrs,
    },
});

export const instrumentRedisClientSync = <
    T extends RedisClient & Partial<ReturnType<RedisClient['pipeline']>>,
>(
    client: T,
    pipelineCommands: string[] | null = null,
    otel: PartialOpenTelemetry = opentelemetry,
): T => {
    const tracer = otel.trace.getTracer('web');
    const _sendCommand = client.sendCommand;
    client.sendCommand = function sendCommand(
        command: string,
        args?: RedisValue[],
        options?: SendCommandOptions,
    ): Promise<RedisReply> {
        const statement = `${command} ${(args || []).join(' ')}`;
        // When `this` is a pipeline, sendCommand is not really performing the command
        // but accumulating them to be send on a single RT upon flush()
        if (pipelineCommands) {
            pipelineCommands.push(statement);
            return _sendCommand.call(client, command, args, options);
        }
        // Otherwise sendCommand will actually send the command
        const spanOptions = createDefaultSpanOptions({
            'db.statement': statement,
        });
        return tracer.startActiveSpan('command', spanOptions, (innerSpan) => {
            const replayPromise = _sendCommand.call(
                client,
                command,
                args,
                options,
            );
            replayPromise.finally(() => {
                innerSpan.end();
            });
            return replayPromise;
        });
    };
    const _pipeline = client.pipeline;
    if (_pipeline) {
        client.pipeline = function pipeline() {
            return instrumentRedisClientSync(_pipeline.call(client), [], otel);
        };
    }
    const _flush = client.flush;
    if (_flush) {
        client.flush = function flush() {
            const spanOptions = createDefaultSpanOptions({
                'db.statement': `PIPELINE | ${
                    (pipelineCommands || []).join(' | ')
                }`,
            });
            return tracer.startActiveSpan(
                'command',
                spanOptions,
                (innerSpan) => {
                    pipelineCommands = [];
                    const replayPromise = _flush.call(client);
                    replayPromise.finally(() => {
                        innerSpan.end();
                    });
                    return replayPromise;
                },
            );
        };
    }
    return client;
};

export const instrumentRedisClient = async <
    T extends RedisClient,
>(
    clientPromise: Promise<T>,
    otel: PartialOpenTelemetry = opentelemetry,
): Promise<T> => {
    const client = await clientPromise;
    return instrumentRedisClientSync(client, null, otel);
};
