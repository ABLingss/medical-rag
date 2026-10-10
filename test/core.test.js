import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chunkPages, retrieve, KnowledgeStore, parseUpload } from '../lib/knowledge.js';
import { seedDocuments } from '../lib/seed.js';
import { demo, validateLesson, callAI, similarity, isClinical } from '../lib/generate.js';
import { messages } from '../lib/prompts.js';

test('中文术语、缩写和别名检索指向相应资料，无匹配时不召回', () => {
  for (const [q, expected] of [['心力衰竭', 'seed-heart'], ['心衰', 'seed-heart'], ['GFR', 'seed-gfr'], ['炎症因子', 'seed-cytokine']]) assert.equal(retrieve(q, seedDocuments)[0].documentId, expected);
  assert.equal(retrieve('飞船曲率驱动', seedDocuments).length, 0);
});
test('长段落保持重叠与PDF物理页码', () => {
  const chunks = chunkPages({ id: 'x', pages: [{ page: 5, text: 'a'.repeat(1500) }], source: {} });
  assert.equal(chunks.length, 3); assert.equal(chunks[0].text.length, 800); assert.ok(chunks.every(c => c.page === 5));
  assert.equal(chunks.at(-1).text.length, 200);
});
test('离线示例明确标注，引用真实片段', () => {
  const hits = retrieve('心力衰竭', seedDocuments), result = demo('心力衰竭', hits, seedDocuments);
  assert.equal(validateLesson(result, hits).quiz.length, 3);
  assert.ok(result.risks.some(r => r.includes('并非本次AI生成')));
});
test('拒绝伪造引用、错误题目答案与缺失结构', () => {
  const hits = retrieve('心力衰竭', seedDocuments), r = demo('心力衰竭', hits, seedDocuments);
  const forged = structuredClone(r); forged.cards[0].sourceIds = ['不存在']; assert.throws(() => validateLesson(forged, hits));
  const bad = structuredClone(r); bad.quiz[0].answer = 9; assert.throws(() => validateLesson(bad, hits));
  assert.throws(() => validateLesson({ title: 'a' }, hits));
});
test('提示对照保持用户问题、资料与结构完全相同', () => {
  const hits = retrieve('炎症因子', seedDocuments), coarse = messages('炎症因子', hits, 'coarse'), precise = messages('炎症因子', hits);
  assert.deepEqual(coarse[1], precise[1]); assert.notEqual(coarse[0].content, precise[0].content);
});
test('AI错误不泄露服务内容与密钥，DeepSeek显式禁用思考', async () => {
  const config = { key: 'SECRET', base: 'https://api.deepseek.com', model: 'deepseek-flash' };
  await assert.rejects(callAI('心力衰竭', [], config, 'precise', async (_url, options) => {
    assert.equal(JSON.parse(options.body).thinking.type, 'disabled'); return { ok: false, status: 401 };
  }), /401/);
  await assert.rejects(callAI('x', [], config, 'precise', async () => { throw new Error('SECRET'); }), e => !e.message.includes('SECRET'));
});
test('临床边界与相似度', () => {
  assert.ok(isClinical('患者心衰吃什么药？')); assert.ok(!isClinical('心力衰竭是什么？'));
  assert.equal(similarity('abcdef', 'abcdef'), 1); assert.equal(similarity('abcdef', 'uvwxyz'), 0);
});
test('资料持久化、并发写入和内置资料保护', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'medical-rag-test-'));
  try {
    const store = new KnowledgeStore(dir); await store.init();
    const input = { title: '自建', category: 'test', source: {}, pages: [{ page: 1, text: '教材知识' }] };
    const docs = await Promise.all([store.add(input), store.add(input)]);
    const again = new KnowledgeStore(dir); await again.init(); assert.equal(again.custom.length, 2);
    await assert.rejects(again.remove('seed-heart')); await again.remove(docs[0].id); assert.equal(again.custom.length, 1);
  } finally { await rm(dir, { recursive: true }); }
});
test('TXT导入、空文件与非法格式检查', async () => {
  assert.equal((await parseUpload('test.md', Buffer.from('## 心力衰竭\n教材内容')))[0].page, 1);
  await assert.rejects(parseUpload('empty.txt', Buffer.from(' ')), /没有/);
  await assert.rejects(parseUpload('test.exe', Buffer.from('abc')), /仅支持/);
});
function smallPDF() {
  const stream = 'BT /F1 12 Tf 30 100 Td (Kidney GFR learning) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let out = '%PDF-1.4\n', offsets = [0];
  objects.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length; out += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}
test('PDF实际提取文字与页码', async () => {
  const bytes = smallPDF(), pages = await parseUpload('chapter.pdf', bytes);
  assert.equal(pages[0].page, 1); assert.match(pages[0].text, /Kidney GFR learning/);
});
test('实验保留无效输出原文，不能以结构失败掩盖幻觉', async () => {
  const output = await callAI('x', [], { base: 'https://api.deepseek.com', model: 'deepseek-flash', key: 'x' }, 'coarse', async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '无效但需要保留的输出' }, finish_reason: 'stop' }] }) }), false);
  assert.equal(output.raw, '无效但需要保留的输出'); assert.ok(output.validationError); assert.equal(output.result, null);
});
