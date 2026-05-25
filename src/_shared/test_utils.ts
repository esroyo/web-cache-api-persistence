export interface TestServer {
  containerId: string;
  port: number;
}

const REDIS_IMAGE = "redis:7-alpine";

export async function startRedis({
  port = 6379,
}: {
  port?: number;
}): Promise<TestServer> {
  await new Deno.Command("docker", {
    args: ["pull", REDIS_IMAGE],
    stdout: "null",
    stderr: "null",
  }).output();

  const process = new Deno.Command("docker", {
    args: [
      "run",
      "-d",
      "--rm",
      "-p",
      `${port}:6379`,
      REDIS_IMAGE,
    ],
    stdout: "piped",
    stderr: "null",
  }).spawn();

  const { stdout } = await process.output();
  const containerId = new TextDecoder().decode(stdout).trim();
  await waitForPort(port);
  return { containerId, port };
}

export async function stopRedis(server: TestServer): Promise<void> {
  await new Deno.Command("docker", {
    args: ["stop", server.containerId],
  }).output();
}

const DENOKV_IMAGE = "ghcr.io/denoland/denokv";
const DENOKV_ACCESS_TOKEN = "web-cache-api-persistence-test-token";

export async function startDenoKv({
  port = 4512,
}: {
  port?: number;
}): Promise<TestServer> {
  await new Deno.Command("docker", {
    args: ["pull", DENOKV_IMAGE],
    stdout: "null",
    stderr: "null",
  }).output();

  Deno.env.set("DENO_KV_ACCESS_TOKEN", DENOKV_ACCESS_TOKEN);

  const process = new Deno.Command("docker", {
    args: [
      "run",
      "-d",
      "--rm",
      "-p",
      `${port}:4512`,
      DENOKV_IMAGE,
      "--sqlite-path",
      "/tmp/denokv.sqlite",
      "serve",
      "--access-token",
      DENOKV_ACCESS_TOKEN,
    ],
    stdout: "piped",
    stderr: "null",
  }).spawn();

  const { stdout } = await process.output();
  const containerId = new TextDecoder().decode(stdout).trim();
  await waitForPort(port);
  return { containerId, port };
}

export async function stopDenoKv(server: TestServer): Promise<void> {
  await new Deno.Command("docker", {
    args: ["stop", server.containerId],
  }).output();
}

const POSTGRES_IMAGE = "postgres:16-alpine";

export async function startPostgres({
  port = 5432,
}: {
  port?: number;
}): Promise<TestServer> {
  await new Deno.Command("docker", {
    args: ["pull", POSTGRES_IMAGE],
    stdout: "null",
    stderr: "null",
  }).output();

  const process = new Deno.Command("docker", {
    args: [
      "run",
      "-d",
      "--rm",
      "-e",
      "POSTGRES_PASSWORD=postgres",
      "-e",
      "POSTGRES_USER=postgres",
      "-e",
      "POSTGRES_DB=postgres",
      "-p",
      `${port}:5432`,
      POSTGRES_IMAGE,
      "-c",
      "max_connections=1000",
    ],
    stdout: "piped",
    stderr: "null",
  }).spawn();

  const { stdout } = await process.output();
  const containerId = new TextDecoder().decode(stdout).trim();
  await waitForPort(port);
  // Postgres needs extra time after TCP port opens to finish init
  await new Promise((res) => setTimeout(res, 2000));
  return { containerId, port };
}

export async function stopPostgres(server: TestServer): Promise<void> {
  await new Deno.Command("docker", {
    args: ["stop", server.containerId],
  }).output();
}

export function nextPort(): number {
  return 1024 + Math.floor(Math.random() * (65_535 - 1024));
}

async function waitForPort(port: number): Promise<void> {
  let retries = 0;
  const maxRetries = 10;
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

export function generateRandomRequest(): Request {
  // List of example URLs, HTTP methods, and headers
  const urls = [
    "https://example.com/api/v1/resource",
    "https://api.example.com/data",
    "https://myapp.com/api/user",
    "https://service.example.com/endpoint",
  ];
  //const methods: RequestInit["method"][] = ["GET", "POST", "PUT", "DELETE", "PATCH"];
  const methods: RequestInit["method"][] = ["GET"];
  const headersList: Record<string, string>[] = [
    { "Content-Type": "application/json" },
    { "Authorization": "Bearer someRandomToken123" },
    { "Accept": "application/json" },
    { "User-Agent": "RandomUserAgent/1.0" },
  ];

  // Helper function to generate random data for the body
  function getRandomBody(): string | undefined {
    const bodyData = [
      JSON.stringify({ key: "value" }),
      JSON.stringify({
        id: Math.floor(Math.random() * 100),
        name: "RandomName",
      }),
      JSON.stringify({ action: "delete", target: "resource" }),
      JSON.stringify({ message: "Hello, world!" }),
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
    body: ["POST", "PUT", "PATCH"].includes(randomMethod as string)
      ? getRandomBody()
      : undefined,
  };

  // Generate and return the random Request object
  return new Request(randomUrl, requestInit);
}

export function generateRandomResponse(): Response {
  // List of possible status codes, status texts, headers, and body data
  const statuses = [
    { status: 200, statusText: "OK" },
    { status: 201, statusText: "Created" },
    { status: 400, statusText: "Bad Request" },
    { status: 401, statusText: "Unauthorized" },
    { status: 403, statusText: "Forbidden" },
    { status: 404, statusText: "Not Found" },
    { status: 500, statusText: "Internal Server Error" },
  ];
  const headersList: Record<string, string>[] = [
    { "Content-Type": "application/json" },
    { "Content-Type": "text/plain" },
    { "Cache-Control": "no-cache" },
    { "X-Custom-Header": "RandomValue123" },
  ];

  // Helper function to generate random JSON data for the body
  function getRandomBody(): string | undefined {
    const bodyData = [
      JSON.stringify({
        message: "Success",
        data: { id: Math.floor(Math.random() * 100) },
      }),
      JSON.stringify({ error: "Something went wrong" }),
      JSON.stringify({
        status: "ok",
        timestamp: new Date().toISOString(),
      }),
      JSON.stringify({ detail: "Resource not found", code: 404 }),
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
