import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  freePort,
  freePorts,
  launch,
  stop,
  waitFor,
} from '../../scripts/lib/process.mjs';

function recyclingPortAllocator(t, failAt = Infinity) {
  const leased = new Set();
  let allocations = 0;
  const allocator = t.mock.method(net, 'createServer', () => {
    const server = new EventEmitter();
    let port;
    server.listen = (_port, _host, ready) => {
      queueMicrotask(() => {
        if (++allocations === failAt) {
          server.emit('error', new Error('Port allocation failed'));
          return;
        }
        port = 35000;
        while (leased.has(port)) port++;
        leased.add(port);
        server.listening = true;
        ready();
      });
      return server;
    };
    server.address = () => ({ port });
    server.close = (done) => {
      leased.delete(port);
      server.listening = false;
      queueMicrotask(done);
    };
    return server;
  });
  syncBuiltinESMExports();
  t.after(() => {
    allocator.mock.restore();
    syncBuiltinESMExports();
  });
  return leased;
}

test('a stack gets distinct ports even when the OS immediately recycles released ports', async (t) => {
  const leased = recyclingPortAllocator(t);
  const ports = await freePorts(3);
  assert.equal(new Set(ports).size, 3);
  assert.equal(leased.size, 0);
});

test('a failed group allocation releases every probe already bound', async (t) => {
  const leased = recyclingPortAllocator(t, 2);
  await assert.rejects(freePorts(3), /Port allocation failed/);
  assert.equal(leased.size, 0);
});

test(
  'stop ends the server descendants even when their wrapper exits first',
  { skip: process.platform === 'win32' },
  async (t) => {
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const child = launch(
      process.execPath,
      [
        fileURLToPath(new URL('./fixtures/term-parent.mjs', import.meta.url)),
        String(port),
      ],
      process.env,
    );
    t.after(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    });
    await waitFor(url, child);
    await stop(child);
    await assert.rejects(fetch(url, { signal: AbortSignal.timeout(500) }));
  },
);
