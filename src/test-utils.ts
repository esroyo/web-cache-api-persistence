export interface TestServer {
    path: string;
    port: number;
    process: Deno.ChildProcess;
}

export async function startRedis({
    port = 6379,
    clusterEnabled = false,
    makeClusterConfigFile = false,
}): Promise<TestServer> {
    const path = tempPath(String(port));
    if (!(await exists(path))) {
        await Deno.mkdir(path);
    }

    // Setup redis.conf
    const destPath = `${path}/redis.conf`;
    let config = await Deno.readTextFile('redis.conf');
    config += `dir ${path}\nport ${port}\n`;
    if (clusterEnabled) {
        config += 'cluster-enabled yes\n';
        if (makeClusterConfigFile) {
            const clusterConfigFile = `${path}/cluster.conf`;
            config += `cluster-config-file ${clusterConfigFile}`;
        }
    }
    await Deno.writeFile(destPath, new TextEncoder().encode(config));

    // Start redis server
    const process = new Deno.Command('redis-server', {
        args: [`${path}/redis.conf`],
        stdin: 'null',
        stdout: 'null',
        stderr: 'piped',
    }).spawn();

    await waitForPort(port);
    return { path, port, process };
}

export async function stopRedis(server: TestServer): Promise<void> {
    try {
        await Deno.remove(server.path, { recursive: true });
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
            throw error;
        }
    }

    await ensureTerminated(server.process);
}

export async function ensureTerminated(
    process: Deno.ChildProcess,
): Promise<void> {
    try {
        await process.stderr.cancel();
        process.kill('SIGKILL');
        await process.status;
    } catch (error) {
        const alreadyKilled = error instanceof TypeError &&
            error.message === 'Child process has already terminated';
        if (alreadyKilled) {
            return;
        }
        throw error;
    }
}

async function exists(path: string): Promise<boolean> {
    try {
        await Deno.stat(path);
        return true;
    } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
            return false;
        }
        throw err;
    }
}

let currentPort = 7000;
export function nextPort(): number {
    return currentPort++;
}

async function waitForPort(port: number): Promise<void> {
    let retries = 0;
    const maxRetries = 5;
    while (true) {
        try {
            const conn = await Deno.connect({ port });
            conn.close();
            break;
        } catch (e) {
            retries++;
            if (retries === maxRetries) {
                throw e;
            }
            await new Promise((res) => {
                setTimeout(res, 200);
            });
        }
    }
}

function tempPath(fileName: string): string {
    const url = new URL(`./../tmp/${fileName}`, import.meta.url);
    return url.pathname;
}

export function usesRedisVersion(version: '6' | '7'): boolean {
    return !!Deno.env.get('REDIS_VERSION')?.startsWith(`${version}.`);
}

export function generateRandomRequest(): Request {
    // List of example URLs, HTTP methods, and headers
    const urls = [
        'https://example.com/api/v1/resource',
        'https://api.example.com/data',
        'https://myapp.com/api/user',
        'https://service.example.com/endpoint',
    ];
    //const methods: RequestInit["method"][] = ["GET", "POST", "PUT", "DELETE", "PATCH"];
    const methods: RequestInit['method'][] = ['GET'];
    const headersList: Record<string, string>[] = [
        { 'Content-Type': 'application/json' },
        { 'Authorization': 'Bearer someRandomToken123' },
        { 'Accept': 'application/json' },
        { 'User-Agent': 'RandomUserAgent/1.0' },
    ];

    // Helper function to generate random data for the body
    function getRandomBody(): string | undefined {
        const bodyData = [
            JSON.stringify({ key: 'value' }),
            JSON.stringify({
                id: Math.floor(Math.random() * 100),
                name: 'RandomName',
            }),
            JSON.stringify({ action: 'delete', target: 'resource' }),
            JSON.stringify({ message: 'Hello, world!' }),
        ];
        return bodyData[Math.floor(Math.random() * bodyData.length)];
    }

    // Choose random URL, method, and headers
    const randomUrl = urls[Math.floor(Math.random() * urls.length)];
    const randomMethod = methods[Math.floor(Math.random() * methods.length)];
    const randomHeaders = new Headers(
        headersList[Math.floor(Math.random() * headersList.length)],
    );

    // Only add body data for methods that support a body
    const requestInit: RequestInit = {
        method: randomMethod,
        headers: randomHeaders,
        body: ['POST', 'PUT', 'PATCH'].includes(randomMethod as string)
            ? getRandomBody()
            : undefined,
    };

    // Generate and return the random Request object
    return new Request(randomUrl, requestInit);
}

export function generateRandomResponse(): Response {
    // List of possible status codes, status texts, headers, and body data
    const statuses = [
        { status: 200, statusText: 'OK' },
        { status: 201, statusText: 'Created' },
        { status: 400, statusText: 'Bad Request' },
        { status: 401, statusText: 'Unauthorized' },
        { status: 403, statusText: 'Forbidden' },
        { status: 404, statusText: 'Not Found' },
        { status: 500, statusText: 'Internal Server Error' },
    ];
    const headersList: Record<string, string>[] = [
        { 'Content-Type': 'application/json' },
        { 'Content-Type': 'text/plain' },
        { 'Cache-Control': 'no-cache' },
        { 'X-Custom-Header': 'RandomValue123' },
    ];

    // Helper function to generate random JSON data for the body
    function getRandomBody(): string | undefined {
        const bodyData = [
            JSON.stringify({
                message: 'Success',
                data: { id: Math.floor(Math.random() * 100) },
            }),
            JSON.stringify({ error: 'Something went wrong' }),
            JSON.stringify({
                status: 'ok',
                timestamp: new Date().toISOString(),
            }),
            JSON.stringify({ detail: 'Resource not found', code: 404 }),
        ];
        return bodyData[Math.floor(Math.random() * bodyData.length)];
    }

    // Choose random status, headers, and body
    const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
    const randomHeaders = new Headers(
        headersList[Math.floor(Math.random() * headersList.length)],
    );
    const randomBody = getRandomBody();

    // Generate and return the random Response object
    return new Response(randomBody, {
        status: randomStatus.status,
        statusText: randomStatus.statusText,
        headers: randomHeaders,
    });
}
