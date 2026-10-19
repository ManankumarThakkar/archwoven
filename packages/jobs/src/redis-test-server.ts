/**
 * Test support only: a disposable redis-server plus an HTTP shim that speaks
 * Upstash's REST protocol (POST a JSON command array, receive {result} or
 * {error}), so production code runs its real scripts against real Redis.
 * Uses ARCHWOVEN_TEST_REDIS (host:port) when set, as CI does, with one database
 * per vitest worker; otherwise starts redis-server from PATH. Returns null when
 * neither is available.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { connect, createServer as createNetServer, type Socket } from 'node:net';

type Reply = string | number | null | Reply[] | { error: string };

function encode(command: string[]): string {
  return `*${command.length}\r\n${command.map(part => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join('')}`;
}

/** Minimal RESP2 client: one connection, requests answered in order. */
function respClient(socket: Socket) {
  let buffer = Buffer.alloc(0);
  const waiting: ((reply: Reply) => void)[] = [];
  const parse = (at: number): [Reply, number] | null => {
    const end = buffer.indexOf('\r\n', at);
    if (end < 0) return null;
    const type = String.fromCharCode(buffer[at]!), line = buffer.toString('utf8', at + 1, end), next = end + 2;
    if (type === '+') return [line, next];
    if (type === '-') return [{ error: line }, next];
    if (type === ':') return [Number(line), next];
    if (type === '$') {
      const length = Number(line);
      if (length < 0) return [null, next];
      if (buffer.length < next + length + 2) return null;
      return [buffer.toString('utf8', next, next + length), next + length + 2];
    }
    const count = Number(line), items: Reply[] = [];
    if (count < 0) return [null, next];
    let cursor = next;
    for (let i = 0; i < count; i++) {
      const item = parse(cursor);
      if (!item) return null;
      items.push(item[0]); cursor = item[1];
    }
    return [items, cursor];
  };
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, typeof chunk === 'string' ? Buffer.from(chunk) : chunk]);
    for (let parsed = parse(0); parsed; parsed = buffer.length ? parse(0) : null) {
      buffer = buffer.subarray(parsed[1]);
      waiting.shift()!(parsed[0]);
    }
  });
  return (command: string[]) => new Promise<Reply>(resolve => { waiting.push(resolve); socket.write(encode(command)); });
}

const freePort = () => new Promise<number>(resolve => {
  const probe = createNetServer().listen(0, '127.0.0.1', () => { const { port } = probe.address() as { port: number }; probe.close(() => resolve(port)); });
});

export interface TestRedis { url: string; token: string; flush(): Promise<void>; setDown(down: boolean): void; close(): Promise<void> }

export async function startTestRedis(): Promise<TestRedis | null> {
  let child: ChildProcess | undefined;
  let host = '127.0.0.1', port: number;
  if (process.env.ARCHWOVEN_TEST_REDIS) {
    [host, port] = [process.env.ARCHWOVEN_TEST_REDIS.split(':')[0]!, Number(process.env.ARCHWOVEN_TEST_REDIS.split(':')[1])];
  } else {
    if (spawnSync('redis-server', ['--version']).status !== 0) return null;
    port = await freePort();
    child = spawn('redis-server', ['--port', String(port), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
  }
  let socket: Socket | undefined;
  for (let i = 0; i < 100 && !socket; i++) {
    socket = await new Promise<Socket | undefined>(resolve => {
      const attempt = connect(port, host, () => resolve(attempt)).on('error', () => resolve(undefined));
    });
    if (!socket) await new Promise(r => setTimeout(r, 50));
  }
  if (!socket) throw new Error('Test Redis did not start.');
  const send = respClient(socket);
  // A shared server (CI) gives each vitest worker its own database, so parallel files never flush each other.
  if (process.env.ARCHWOVEN_TEST_REDIS) await send(['SELECT', String(Number(process.env.VITEST_POOL_ID ?? 0) % 16)]);
  const token = 'test-token-not-a-credential';
  let down = false;
  const server: Server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const reply = (status: number, body: unknown) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); };
    if (down) return reply(503, { error: 'Service unavailable' });
    if (request.headers.authorization !== `Bearer ${token}`) return reply(401, { error: 'Unauthorized' });
    const result = await send((JSON.parse(raw) as unknown[]).map(String));
    if (result && typeof result === 'object' && 'error' in result) return reply(400, { error: result.error });
    reply(200, { result });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, token,
    async flush() { await send(['FLUSHDB']); },
    setDown(value) { down = value; },
    async close() {
      await new Promise<void>(resolve => server.close(() => resolve()));
      socket!.destroy(); child?.kill();
    },
  };
}
