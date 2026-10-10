import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { seedDocuments } from './seed.js';

export const normalize = value => String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export function tokens(value) {
  const s = normalize(value), result = new Set();
  for (const match of String(value).toLowerCase().matchAll(/[a-z][a-z0-9-]*/g)) result.add(match[0]);
  for (let i = 0; i < s.length - 1; i++) result.add(s.slice(i, i + 2));
  if (s.length === 1) result.add(s);
  return result;
}
export function chunkPages(doc, size = 800, overlap = 150) {
  const chunks = [];
  for (const { page, text } of doc.pages) {
    for (let offset = 0; offset < text.length; offset += size - overlap) {
      chunks.push({ id: `${doc.id}-p${page}-c${chunks.length + 1}`, documentId: doc.id, title: doc.title, category: doc.category, page, text: text.slice(offset, offset + size), source: doc.source, builtin: !!doc.builtin });
      if (offset + size >= text.length) break;
    }
  }
  return chunks;
}
export function retrieve(query, documents, limit = 5) {
  const aliases = [['心衰', '心力衰竭'], ['gfr', '肾小球滤过率'], ['egfr', '肾小球滤过率'], ['炎症因子', '细胞因子']];
  let expanded = query.toLowerCase();
  for (const [alias, term] of aliases) if (expanded.includes(alias)) expanded += ` ${term}`;
  const q = tokens(expanded), clean = normalize(expanded);
  if (!q.size) return [];
  const chunks = documents.flatMap(doc => chunkPages(doc));
  const df = new Map();
  for (const chunk of chunks) for (const t of tokens(chunk.title + chunk.text)) df.set(t, (df.get(t) || 0) + 1);
  return chunks.map(chunk => {
    const content = tokens(chunk.text), title = tokens(chunk.title);
    let score = 0, count = 0;
    for (const t of q) {
      if (content.has(t) || title.has(t)) { count++; score += Math.log(1 + chunks.length / (1 + (df.get(t) || 0))) * (title.has(t) ? 2 : 1); }
    }
    const titleMatch = normalize(chunk.title.split('·')[0]);
    if (titleMatch.length > 1 && clean.includes(titleMatch)) score += 6;
    return { ...chunk, score: Math.round(score * 100) / 100, matchedTokens: count };
  }).filter(c => c.matchedTokens >= (q.size > 1 ? 2 : 1) && c.score >= 1).sort((a, b) => b.score - a.score).slice(0, limit);
}

export class KnowledgeStore {
  constructor(dir) { this.dir = dir; this.custom = []; this.queue = Promise.resolve(); }
  async init() {
    await mkdir(this.dir, { recursive: true });
    try { this.custom = JSON.parse(await readFile(join(this.dir, 'knowledge.json'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw new Error('知识库文件损坏，请恢复备份，原文件未被覆盖。'); }
    if (!Array.isArray(this.custom)) throw new Error('知识库格式错误');
  }
  get documents() { return [...seedDocuments, ...this.custom]; }
  async mutate(fn) {
    const task = this.queue.then(async () => {
      const next = fn(this.custom);
      const dest = join(this.dir, 'knowledge.json'), temp = dest + '.tmp';
      await writeFile(temp, JSON.stringify(next), { mode: 0o600 });
      await rename(temp, dest); this.custom = next;
    });
    this.queue = task.catch(() => {}); return task;
  }
  async add(doc) {
    const added = { ...doc, id: randomUUID(), builtin: false, createdAt: new Date().toISOString() };
    await this.mutate(list => {
      if (list.length >= 100 || list.reduce((n, d) => n + d.pages.reduce((s, p) => s + p.text.length, 0), 0) + added.pages.reduce((n, p) => n + p.text.length, 0) > 5_000_000) throw Object.assign(new Error('知识库容量已满：最多100份资料、500万字符，请先删除资料。'), { status: 413 });
      return [...list, added];
    });
    return added;
  }
  async remove(id) {
    if (!this.custom.some(d => d.id === id)) throw Object.assign(new Error('资料不存在或为内置资料'), { status: 404 });
    await this.mutate(list => list.filter(d => d.id !== id));
  }
}
export async function parseUpload(name, bytes) {
  if (/\.pdf$/i.test(name)) {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false });
    let pdf;
    try {
      pdf = await task.promise;
      if (pdf.numPages > 500) throw Object.assign(new Error('PDF超过500页，请按章节拆分上传。'), { status: 413 });
      const pages = []; let count = 0;
      for (let page = 1; page <= pdf.numPages; page++) {
        const p = await pdf.getPage(page), data = await p.getTextContent();
        const text = data.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('').trim();
        count += text.length;
        if (count > 1_000_000) throw Object.assign(new Error('文字超过100万字符，请按章节上传。'), { status: 413 });
        if (text) pages.push({ page, text });
        p.cleanup();
      }
      if (!pages.length) throw Object.assign(new Error('未提取到文字，扫描版PDF需要先做OCR。'), { status: 422 });
      return pages;
    } finally { await task.destroy(); }
  }
  if (!/\.(txt|md)$/i.test(name)) throw Object.assign(new Error('仅支持 PDF、TXT、Markdown 文件'), { status: 400 });
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
  if (!text) throw Object.assign(new Error('文件没有可检索文字'), { status: 422 });
  if (text.length > 1_000_000) throw Object.assign(new Error('文字超过100万字符'), { status: 413 });
  return [{ page: 1, text }];
}
