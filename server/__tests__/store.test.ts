// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  readJson,
  writeJsonAtomic,
  withFileLock,
  readUsersFile,
  writeUsersFile,
  readMemories,
  saveMemories,
} from '../utils/store.js';
import type { Memory, StoredUser } from '../types.js';

/** Temp dir for every test — never touches the real server/data. */
let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pd-store-test-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('writeJsonAtomic / readJson', () => {
  it('writes and reads back JSON', async () => {
    const file = path.join(tmpDir, 'a.json');
    await writeJsonAtomic(file, { hello: 'world', n: 1 });
    expect(await readJson<{ hello: string; n: number }>(file)).toEqual({
      hello: 'world',
      n: 1,
    });
  });

  it('creates parent directories', async () => {
    const file = path.join(tmpDir, 'deep', 'nested', 'b.json');
    await writeJsonAtomic(file, [1, 2, 3]);
    expect(await readJson<number[]>(file)).toEqual([1, 2, 3]);
  });

  it('leaves no tmp files behind after a write', async () => {
    const file = path.join(tmpDir, 'c.json');
    await writeJsonAtomic(file, { x: 1 });
    const entries = await fs.readdir(tmpDir);
    expect(entries.some((e) => e.includes('.tmp'))).toBe(false);
  });

  it('readJson returns null for a missing file', async () => {
    expect(await readJson(path.join(tmpDir, 'missing.json'))).toBeNull();
  });
});

describe('withFileLock', () => {
  it('serialises concurrent read-modify-write cycles', async () => {
    const file = path.join(tmpDir, 'counter.json');
    await writeJsonAtomic(file, { n: 0 });

    const bump = (): Promise<void> =>
      withFileLock('counter', async () => {
        const cur = (await readJson<{ n: number }>(file)) ?? { n: 0 };
        cur.n += 1;
        await writeJsonAtomic(file, cur);
      });

    await Promise.all([bump(), bump(), bump(), bump(), bump()]);

    const final = await readJson<{ n: number }>(file);
    expect(final?.n).toBe(5);
  });

  it('lets the next caller proceed even if the previous fn rejected', async () => {
    const file = path.join(tmpDir, 'lock-reject.json');
    await expect(
      withFileLock('reject-key', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // The chain must not be poisoned by the rejection.
    await expect(
      withFileLock('reject-key', async () => {
        await writeJsonAtomic(file, { ok: true });
        return 'done';
      }),
    ).resolves.toBe('done');
    expect(await readJson<{ ok: boolean }>(file)).toEqual({ ok: true });
  });
});

describe('users file helpers', () => {
  it('writeUsersFile / readUsersFile round-trip', async () => {
    const file = path.join(tmpDir, 'users.json');
    const user: StoredUser = {
      id: 'u1',
      contact: 'a@b.com',
      nickname: '小董',
      passHash: 'h',
      salt: 's',
      avatar: null,
      createdAt: 1,
    };
    await writeUsersFile([user], file);
    const users = await readUsersFile(file);
    expect(users).toHaveLength(1);
    expect(users[0].nickname).toBe('小董');
  });

  it('returns [] when the users file is missing', async () => {
    expect(await readUsersFile(path.join(tmpDir, 'nope.json'))).toEqual([]);
  });
});

describe('memories helpers', () => {
  it('saveMemories / readMemories round-trip under a uid dir', async () => {
    const memory: Memory = {
      id: 'm1',
      text: '今天记得带伞',
      source: '你亲手写下的',
      createdAt: 123,
    };
    await saveMemories('u1', [memory], tmpDir);
    expect(await readMemories('u1', tmpDir)).toEqual([memory]);
  });

  it('readMemories returns [] for an unknown uid', async () => {
    expect(await readMemories('ghost', tmpDir)).toEqual([]);
  });

  it('overwrites the whole list on save (delete semantics)', async () => {
    const keep: Memory = { id: 'm1', text: 'keep', source: 's', createdAt: 1 };
    const drop: Memory = { id: 'm2', text: 'drop', source: 's', createdAt: 2 };
    await saveMemories('u2', [keep, drop], tmpDir);
    await saveMemories('u2', [keep], tmpDir);
    expect(await readMemories('u2', tmpDir)).toEqual([keep]);
  });
});
