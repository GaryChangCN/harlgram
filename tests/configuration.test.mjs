import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const generator = path.resolve(import.meta.dirname, '../scripts/configure-telegram.mjs');
// Synthetic values are assembled at runtime; no real application identity belongs here.
const fixture = { apiId: 7310923, apiHash: 'a1'.repeat(16) };

function sandbox(t, config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harlgram-config-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const local = path.join(root, 'config/telegram.local.json');
  const generated = path.join(root, 'entry/src/main/ets/config/TelegramBuildConfig.ets');
  if (config !== undefined) {
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.writeFileSync(local, JSON.stringify(config), { mode: 0o600 });
  }
  return {
    root, local, generated,
    run(mode = 'debug') {
      const result = spawnSync(process.execPath, [generator, mode], {
        env: { ...process.env, HARLGRAM_ROOT: root }, encoding: 'utf8', timeout: 10000
      });
      assert.ifError(result.error);
      return { status: result.status, output: result.stdout + result.stderr };
    }
  };
}

function assertNoCredentials(output, config = fixture) {
  assert.equal(output.includes(String(config.apiId)), false, 'stdout/stderr must not expose the application ID');
  assert.equal(output.includes(config.apiHash), false, 'stdout/stderr must not expose the application hash');
}

test('missing local configuration generates an inert debug configuration', t => {
  const env = sandbox(t);
  const result = env.run();
  assert.equal(result.status, 0);
  const source = fs.readFileSync(env.generated, 'utf8');
  assert.match(source, /TELEGRAM_API_ID: number = 0;/);
  assert.match(source, /TELEGRAM_API_HASH: string = "";/);
  assert.equal(fs.existsSync(env.local), false, 'the generator must not create a private input file');
});

test('empty example configuration is allowed for debug but rejected for release', t => {
  const env = sandbox(t, { apiId: 0, apiHash: '' });
  assert.equal(env.run('debug').status, 0);
  assert.notEqual(env.run('release').status, 0);
});

test('missing local configuration cannot produce a release configuration', t => {
  const env = sandbox(t);
  assert.notEqual(env.run('release').status, 0);
  assert.equal(fs.existsSync(env.generated), false);
});

test('valid private configuration generates correct constants without logging credentials', t => {
  const env = sandbox(t, fixture);
  const input = fs.readFileSync(env.local, 'utf8');
  const result = env.run();
  assert.equal(result.status, 0);
  assertNoCredentials(result.output);
  const source = fs.readFileSync(env.generated, 'utf8');
  assert.ok(source.includes(`TELEGRAM_API_ID: number = ${fixture.apiId};`));
  assert.ok(source.includes(`TELEGRAM_API_HASH: string = ${JSON.stringify(fixture.apiHash)};`));
  assert.equal(fs.readFileSync(env.local, 'utf8'), input, 'the private input file must remain unchanged');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(env.generated).mode & 0o077, 0, 'newly generated config must not be readable by other users');
  }
});

test('developer-owned configuration is accepted for release', t => {
  const env = sandbox(t, fixture);
  const result = env.run('release');
  assert.equal(result.status, 0);
  assertNoCredentials(result.output);
});

test('the upstream application ID is rejected by the release guard', t => {
  const env = sandbox(t, { apiId: 4, apiHash: fixture.apiHash });
  const result = env.run('release');
  assert.notEqual(result.status, 0);
  assert.equal(result.output.includes(fixture.apiHash), false);
  assert.equal(fs.existsSync(env.generated), false);
});

test('invalid configuration shapes and values are rejected without generating code', async t => {
  const invalid = [
    ['null', null],
    ['array', []],
    ['missing properties', {}],
    ['string ID', { apiId: String(fixture.apiId), apiHash: fixture.apiHash }],
    ['negative ID', { apiId: -1, apiHash: fixture.apiHash }],
    ['fractional ID', { apiId: 1.5, apiHash: fixture.apiHash }],
    ['out-of-range ID', { apiId: 2147483648, apiHash: fixture.apiHash }],
    ['short hash', { apiId: fixture.apiId, apiHash: 'ab' }],
    ['non-hex hash', { apiId: fixture.apiId, apiHash: 'z'.repeat(32) }],
    ['array hash', { apiId: fixture.apiId, apiHash: [fixture.apiHash] }],
    ['object hash', { apiId: fixture.apiId, apiHash: { value: fixture.apiHash } }]
  ];
  for (const [name, value] of invalid) {
    await t.test(name, child => {
      const env = sandbox(child, value);
      const result = env.run();
      assert.notEqual(result.status, 0);
      assert.equal(result.output.includes(fixture.apiHash), false);
      assert.equal(fs.existsSync(env.generated), false);
    });
  }
});

test('malformed private JSON cannot leak source snippets into diagnostics', t => {
  const env = sandbox(t, fixture);
  const privateMarker = 'SENSITIVE_TOKEN_FIXTURE_DO_NOT_LOG';
  fs.writeFileSync(env.local, `${privateMarker} invalid json`);
  const result = env.run();
  assert.notEqual(result.status, 0);
  assert.equal(result.output.includes('SENSITIVE_TOKEN'), false);
  assert.equal(fs.existsSync(env.generated), false);
});

test('invalid input leaves an existing generated configuration unchanged', t => {
  const env = sandbox(t, fixture);
  assert.equal(env.run().status, 0);
  const previous = fs.readFileSync(env.generated, 'utf8');
  fs.writeFileSync(env.local, JSON.stringify({ apiId: -1, apiHash: fixture.apiHash }));
  const result = env.run();
  assert.notEqual(result.status, 0);
  assertNoCredentials(result.output);
  assert.equal(fs.readFileSync(env.generated, 'utf8'), previous);
});
