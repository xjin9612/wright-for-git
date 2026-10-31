import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLogArgs, parseLogChunk, parseNameStatusZ, parseRefs, parseShortlog, isGraphFilter, looksLikeHash } from '../src/git/parsers';
import { EMPTY_FILTER } from '../src/shared/protocol';

test('parseLogChunk 處理跨 chunk 的記錄', () => {
  const rec = (h: string, s: string) => [h, 'p1 p2', 'Alice', 'a@x', '100', 'Alice', 'a@x', '200', s].join('\x1f') + '\x1e';
  const full = rec('aaa', '修正 中文') + '\n' + rec('bbb', 'second');
  const cut = full.length - 5;
  const first = parseLogChunk(full.slice(0, cut));
  assert.equal(first.commits.length, 1);
  assert.equal(first.commits[0].subject, '修正 中文');
  assert.deepEqual(first.commits[0].parents, ['p1', 'p2']);
  assert.equal(first.commits[0].commitTime, 200);
  const second = parseLogChunk(first.rest + full.slice(cut));
  assert.equal(second.commits.length, 1);
  assert.equal(second.commits[0].hash, 'bbb');
  assert.equal(second.rest, '');
});

test('parseRefs：local／remote／tag，略過 symref，tag 取 peeled', () => {
  const lines = [
    ['refs/heads/main', 'h1', '', 'origin/main', ''],
    ['refs/heads/feat/a', 'h2', '', '', ''],
    ['refs/remotes/origin/HEAD', 'h1', '', '', 'refs/remotes/origin/main'],
    ['refs/remotes/origin/main', 'h1', '', '', ''],
    ['refs/remotes/my/fork/fix/x', 'h3', '', '', ''],
    ['refs/tags/v1.0', 'tagobj', 'h1', '', ''],
  ].map((l) => l.join('\0'));
  const refs = parseRefs(lines.join('\n') + '\n', ['origin', 'my/fork']);
  assert.equal(refs.length, 5);
  assert.deepEqual(refs[0], { name: 'refs/heads/main', short: 'main', type: 'local', hash: 'h1', upstream: 'origin/main' });
  assert.equal(refs[2].remote, 'origin');
  assert.equal(refs[2].remoteBranch, 'main');
  assert.equal(refs[3].remote, 'my/fork');
  assert.equal(refs[3].remoteBranch, 'fix/x');
  assert.equal(refs[4].hash, 'h1');
});

test('parseNameStatusZ 支援 rename', () => {
  const files = parseNameStatusZ('M\0a.txt\0R087\0old/b.txt\0new/b.txt\0A\0c d.txt\0');
  assert.deepEqual(files, [
    { status: 'M', path: 'a.txt' },
    { status: 'R', path: 'new/b.txt', oldPath: 'old/b.txt' },
    { status: 'A', path: 'c d.txt' },
  ]);
});

test('parseShortlog', () => {
  const users = parseShortlog('    12\tAlice <alice@x>\n     3\tbob.dev <bob@x>\n');
  assert.deepEqual(users, [
    { count: 12, name: 'Alice', email: 'alice@x' },
    { count: 3, name: 'bob.dev', email: 'bob@x' },
  ]);
});

test('buildLogArgs：預設顯示所有 ref', () => {
  const args = buildLogArgs(EMPTY_FILTER, 100);
  assert.ok(args.includes('--branches') && args.includes('--remotes') && args.includes('--tags') && args.includes('HEAD'));
  assert.equal(args.at(-1), '--');
  assert.ok(!args.some((a) => a.startsWith('--grep')));
});

test('buildLogArgs：文字＋作者，非 regex 用 fixed-strings', () => {
  const args = buildLogArgs({ ...EMPTY_FILTER, text: 'fix(ui)', users: ['bob.dev'], branches: ['refs/heads/main'] }, 10);
  assert.ok(args.includes('--fixed-strings'));
  assert.ok(args.includes('--regexp-ignore-case'));
  assert.ok(args.includes('--grep=fix(ui)'));
  assert.ok(args.includes('--author=bob.dev'));
  assert.ok(args.includes('refs/heads/main'));
  assert.ok(!args.includes('--branches'));
});

test('buildLogArgs：regex 模式下作者被跳脫、Cc 生效', () => {
  const args = buildLogArgs({ ...EMPTY_FILTER, text: '^fix', regex: true, matchCase: true }, 10);
  assert.ok(args.includes('--extended-regexp'));
  assert.ok(!args.includes('--regexp-ignore-case'));
  const args2 = buildLogArgs({ ...EMPTY_FILTER, text: '^fix', regex: true, users: ['a.b'] }, 10);
  assert.ok(args2.includes('--author=a\\.b'));
});

test('isGraphFilter／looksLikeHash', () => {
  assert.equal(isGraphFilter(EMPTY_FILTER), true);
  assert.equal(isGraphFilter({ ...EMPTY_FILTER, branches: ['HEAD'] }), true);
  assert.equal(isGraphFilter({ ...EMPTY_FILTER, users: ['x'] }), false);
  assert.equal(looksLikeHash('a1b2c3d4'), true);
  assert.equal(looksLikeHash('fix'), false);
  assert.equal(looksLikeHash('abc'), false);
});

test('buildLogArgs：忽略以 - 開頭的 branch 值', () => {
  const args = buildLogArgs({ ...EMPTY_FILTER, branches: ['--output=/tmp/x'] }, 10);
  assert.ok(!args.includes('--output=/tmp/x'));
  assert.ok(args.includes('--branches'));
});

test('buildLogArgs：paths 放在 -- 之後並加 --parents', () => {
  const args = buildLogArgs({ ...EMPTY_FILTER, paths: ['src\\main/', 'docs'] }, 10);
  const dd = args.indexOf('--');
  assert.deepEqual(args.slice(dd + 1), ['src/main', 'docs']);
  assert.ok(args.includes('--parents'));
  assert.ok(!buildLogArgs(EMPTY_FILTER, 10).includes('--parents'));
});
