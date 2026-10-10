import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('HTTP完整链路：资料鉴权、上传、检索、删除、诊疗边界和密钥隔离', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'medical-http-'));
  const child = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: dir, AI_API_KEY: '', ADMIN_TOKEN: 'http-test-token' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('测试服务未启动')), 10000); let output = '';
      child.stdout.on('data', c => { output += c; const m = output.match(/localhost:(\d+)/); if (m) { clearTimeout(timer); resolve(m[1]); } });
      child.on('exit', () => { clearTimeout(timer); reject(new Error('测试服务提前退出')); });
    });
    const base = `http://127.0.0.1:${port}`, headers = { 'Content-Type': 'application/json', Authorization: 'Bearer http-test-token' };
    const request = (p, method = 'GET', obj, authorized = true) => fetch(base + p, { method, headers: authorized ? headers : { 'Content-Type': 'application/json' }, ...(obj ? { body: JSON.stringify(obj) } : {}) });
    const status = await request('/api/status').then(r => r.json()); assert.equal(status.aiEnabled, false); assert.equal(status.chunks, 4);
    const doc = { name: '课本.txt', title: '独立资料', base64: Buffer.from('神经递质是参与神经信号传递的化学物质。').toString('base64') };
    assert.equal((await request('/api/documents', 'POST', doc, false)).status, 401);
    const added = await request('/api/documents', 'POST', doc).then(r => r.json()); assert.ok(added.id);
    const hits = await request('/api/search?q=' + encodeURIComponent('神经递质')).then(r => r.json()); assert.equal(hits.hits[0].documentId, added.id);
    assert.equal((await request('/api/documents/' + added.id, 'DELETE')).status, 200);
    assert.equal((await request('/api/documents/seed-heart', 'DELETE')).status, 404);
    const demo = await request('/api/generate', 'POST', { query: '心力衰竭', mode: 'demo' }).then(r => r.json()); assert.equal(demo.mode, 'demo'); assert.equal(demo.result.quiz.length, 3);
    assert.equal((await request('/api/generate', 'POST', { query: '患者心衰吃什么药', mode: 'ai' })).status, 422);
    assert.equal((await request('/api/generate', 'POST', { query: '心力衰竭', mode: 'ai' })).status, 409);
    assert.equal((await request('/.env')).status, 404); assert.equal((await request('/data/knowledge.json')).status, 404);
    assert.equal((await request('/api/local-access')).status, 403);
  } finally { if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); } await rm(dir, { recursive: true, force: true }); }
});
