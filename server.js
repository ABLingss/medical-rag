import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { KnowledgeStore, retrieve, parseUpload, chunkPages } from './lib/knowledge.js';
import { callAI, demo, isClinical, similarity } from './lib/generate.js';
import { modules, riskCases, messages } from './lib/prompts.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const store = new KnowledgeStore(process.env.DATA_DIR || join(root, 'data')); await store.init();
const token = process.env.ADMIN_TOKEN || randomBytes(24).toString('base64url');
const ai = { key: process.env.AI_API_KEY, base: process.env.AI_BASE_URL || 'https://api.deepseek.com', model: process.env.AI_MODEL || 'deepseek-flash' };
const compare = { key: process.env.AI_COMPARE_API_KEY, base: process.env.AI_COMPARE_BASE_URL || 'https://api.openai.com/v1', model: process.env.AI_COMPARE_MODEL || 'gpt-4o-mini' };
const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 3000);
const rates = new Map(); let busy = 0, importing = false;
setInterval(() => { for (const [k,v] of rates) if (Date.now() > v.reset) rates.delete(k); }, 60000).unref();
function error(message, status = 400) { return Object.assign(new Error(message), { status }); }
function auth(req) {
  const value = String(req.headers.authorization || '').replace(/^Bearer /, '');
  const a = Buffer.from(value), b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw error('请输入访问口令：本地启动终端中可查看。', 401);
}
function queryValue(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw error('请输入1～500字的医学术语或学习问题。');
  return value.trim();
}
async function body(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw error('需要JSON请求', 415);
  const chunks = []; let length = 0;
  for await (const c of req) { length += c.length; if (length > 15_000_000) throw error('上传超过10MB限制', 413); chunks.push(c); }
  try { const obj = JSON.parse(Buffer.concat(chunks).toString()); if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw 0; return obj; }
  catch { throw error('请求JSON格式错误'); }
}
function send(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
function guardClinical(query) { if (isClinical(query)) throw error('这里用于医学课程复习，不能提供个体诊断、处方或用药剂量。请改为询问概念或机制。', 422); }
async function withAI(req, fn) {
  auth(req);
  if (!ai.key) throw error('服务器尚未配置AI密钥，可以使用离线示例。', 409);
  const ip = req.socket.remoteAddress, now = Date.now(), rate = rates.get(ip) || { count: 0, reset: now + 60000 };
  if (now > rate.reset) { rate.count = 0; rate.reset = now + 60000; }
  if (rate.count >= 10 || busy >= 2) throw error('请求较多，请稍后再试。', 429);
  rate.count++; rates.set(ip, rate); busy++;
  try { return await fn(); } finally { busy--; }
}
const assets = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/styles.css', ['styles.css', 'text/css']], ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]]);
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  try {
    const url = new URL(req.url, 'http://localhost'), path = url.pathname;
    if (req.method === 'GET' && assets.has(path)) {
      const [name, type] = assets.get(path); res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(await readFile(join(root, 'public', name))); return;
    }
    if (req.method === 'GET' && path === '/api/status') return send(res, 200, { aiEnabled: !!ai.key, model: ai.model, compareEnabled: !!compare.key, compareModel: compare.model, documents: store.documents.length, chunks: store.documents.flatMap(d => chunkPages(d)).length });
    // 只允许本机浏览器同源获取开发口令；公网访问必须手动输入口令。
    if (req.method === 'GET' && path === '/api/local-access') {
      const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
      const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host || '');
      if (!['127.0.0.1', 'localhost', '::1'].includes(host) || !local || !localHost || req.headers['sec-fetch-site'] !== 'same-origin') throw error('本地自动登录仅限同源浏览器', 403);
      return send(res, 200, { token });
    }
    if (req.method === 'GET' && path === '/api/prompts') return send(res, 200, { modules, riskCases });
    if (req.method === 'GET' && path === '/api/documents') return send(res, 200, store.documents.map(d => ({ id: d.id, title: d.title, category: d.category, source: d.source, builtin: !!d.builtin, pages: d.pages.length, chunks: chunkPages(d).length })));
    if (req.method === 'GET' && path === '/api/search') return send(res, 200, { hits: retrieve(queryValue(url.searchParams.get('q')), store.documents) });
    if (req.method === 'POST' && path === '/api/documents') {
      auth(req);
      if (importing) throw error('正在导入另一份资料，请稍后重试。', 429);
      importing = true;
      try {
        const data = await body(req);
        if (typeof data.name !== 'string' || data.name.length > 200 || typeof data.base64 !== 'string') throw error('文件参数错误');
        const bytes = Buffer.from(data.base64, 'base64'); if (bytes.length > 10_000_000) throw error('文件超过10MB', 413);
        const pages = await parseUpload(data.name, bytes);
        let sourceUrl = '';
        if (data.url) { const u = new URL(data.url); if (!['http:', 'https:'].includes(u.protocol)) throw error('来源链接需为http或https'); sourceUrl = u.href; }
        const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim().slice(0, 200) : data.name;
        const doc = await store.add({ title, category: '自建资料', source: { title, url: sourceUrl, note: '用户上传资料；请自行核对教材版本和使用授权。' }, pages });
        return send(res, 201, { id: doc.id, title, pages: pages.length, chunks: chunkPages(doc).length });
      } finally { importing = false; }
    }
    if (req.method === 'DELETE' && path.startsWith('/api/documents/')) { auth(req); await store.remove(decodeURIComponent(path.slice(15))); return send(res, 200, { ok: true }); }
    if (req.method === 'POST' && path === '/api/generate') {
      const data = await body(req), query = queryValue(data.query); guardClinical(query);
      if (!['ai', 'demo'].includes(data.mode)) throw error('模式需为ai或demo');
      const hits = retrieve(query, store.documents);
      if (!hits.length) return send(res, 200, { mode: 'insufficient', hits: [], result: { title: query, summary: '知识库未找到足够相关的资料。请导入包含该主题的教材章节，或换一个术语。', mechanism: [], comparison: [], mnemonic: '', cards: [], quiz: [], risks: ['没有检索证据，已停止生成。'], sourceIds: [] } });
      if (data.mode === 'demo') return send(res, 200, { mode: 'demo', hits, result: demo(query, hits, store.documents) });
      const output = await withAI(req, () => callAI(query, hits, ai));
      return send(res, 200, { ...output, mode: 'ai', hits });
    }
    if (req.method === 'POST' && path === '/api/experiment') {
      const data = await body(req), query = queryValue(data.query); guardClinical(query);
      if (!['prompt', 'repeat', 'tools'].includes(data.kind)) throw error('实验类型错误');
      if (data.kind === 'tools' && !compare.key) throw error('请先在.env配置第二个AI工具。', 409);
      const hits = retrieve(query, store.documents);
      const record = await withAI(req, async () => {
        const plan = data.kind === 'prompt' ? [{ config: ai, style: 'coarse' }, { config: ai, style: 'precise' }] : data.kind === 'repeat' ? ['coarse', 'precise'].flatMap(style => Array.from({ length: 3 }, () => ({ config: ai, style }))) : [{ config: ai, style: 'precise' }, { config: compare, style: 'precise' }];
        const runs = [];
        for (const run of plan) {
          try { runs.push({ style: run.style, ...await callAI(query, hits, run.config, run.style, fetch, false) }); }
          catch (e) { runs.push({ style: run.style, model: run.config.model, error: e.message, messages: messages(query, hits, run.style) }); }
        }
        const overlaps = [];
        if (data.kind === 'repeat') for (let a = 0; a < runs.length; a++) for (let b = a + 1; b < runs.length; b++) if (runs[a].style === runs[b].style && runs[a].raw && runs[b].raw) overlaps.push({ pair: `${a + 1}-${b + 1}`, style: runs[a].style, value: similarity(runs[a].raw, runs[b].raw) });
        return { id: randomBytes(6).toString('hex'), createdAt: new Date().toISOString(), query, kind: data.kind, hits, runs, overlaps, knowledgeSnapshot: hits, evaluation: '待人工评价；成功返回或引用存在不能证明事实正确。' };
      });
      return send(res, 200, record);
    }
    throw error('接口不存在', 404);
  } catch (e) { if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : '服务器处理失败，请查看终端或重试。' }); else res.end(); }
});
server.requestTimeout = 180000; server.headersTimeout = 15000;
server.listen(port, host, () => {
  console.log(`\n知医 · Medical RAG\nLocal: http://localhost:${server.address().port}\nAI: ${ai.key ? ai.model : '未配置，离线可用'}\n访问口令（仅用于本地配置，不要提交Git）: ${token}\n`);
});
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
