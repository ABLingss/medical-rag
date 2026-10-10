import { messages } from './prompts.js';
import { normalize } from './knowledge.js';

export const isClinical = query => /(?:我|患者|病人|本人|宝宝).{0,30}(?:吃什么药|用药|剂量|诊断|治疗|怎么办|多少毫克)|(?:处方|开药|用药剂量|服药剂量)/i.test(query);
export function demo(query, hits, docs) {
  const doc = docs.find(d => d.lesson && hits.some(h => h.documentId === d.id) && normalize(query).includes(normalize(d.lesson.title)))
    || docs.find(d => d.lesson && hits[0]?.documentId === d.id);
  if (!doc) return { title: query, summary: '本资料没有预制学习卡。请启用AI生成，或先在来源面板阅读检索片段。', mechanism: [], comparison: [], mnemonic: '', cards: [], quiz: [], risks: ['离线模式只提供内置主题的人工编写示例，不自动生成新知识。'], sourceIds: [] };
  const result = structuredClone(doc.lesson), ids = hits.filter(h => h.documentId === doc.id).map(h => h.id);
  result.sourceIds = ids;
  for (const item of [...result.cards, ...result.quiz]) item.sourceIds = ids;
  result.risks.push('这是预制教学示例，并非本次AI生成；请核对教材。');
  return result;
}
export function validateLesson(obj, hits) {
  const fail = () => { throw Object.assign(new Error('AI输出结构或引用不合格，请重试；未将其保存为学习卡。'), { status: 502 }); };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) fail();
  for (const k of ['title', 'summary', 'mnemonic']) if (typeof obj[k] !== 'string' || obj[k].length > 12000) fail();
  for (const k of ['mechanism', 'comparison', 'cards', 'quiz', 'risks', 'sourceIds']) if (!Array.isArray(obj[k]) || obj[k].length > 20) fail();
  if (!obj.mechanism.every(x => typeof x === 'string') || !obj.risks.every(x => typeof x === 'string')) fail();
  if (!obj.comparison.every(x => x && typeof x.concept === 'string' && typeof x.distinction === 'string')) fail();
  const valid = new Set(hits.map(h => h.id));
  const references = ids => Array.isArray(ids) && ids.every(id => typeof id === 'string' && valid.has(id));
  if (!references(obj.sourceIds)) fail();
  for (const card of obj.cards) if (!card || typeof card.front !== 'string' || typeof card.back !== 'string' || !references(card.sourceIds) || !card.sourceIds.length) fail();
  for (const q of obj.quiz) if (!q || typeof q.question !== 'string' || !Array.isArray(q.options) || q.options.length !== 4 || !q.options.every(x => typeof x === 'string') || !Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3 || typeof q.explanation !== 'string' || !references(q.sourceIds) || !q.sourceIds.length) fail();
  if ((obj.cards.length || obj.quiz.length || obj.mechanism.length) && !obj.sourceIds.length) fail();
  obj.risks.push('引用ID校验只证明片段存在，不证明每项医学结论正确；需人工核对来源。');
  return obj;
}
export async function callAI(query, hits, config, style = 'precise', fetcher = fetch, requireValid = true) {
  const start = Date.now(), input = messages(query, hits, style);
  const base = config.base.replace(/\/$/, '');
  const request = { model: config.model, messages: input, response_format: { type: 'json_object' }, temperature: 0.6, max_tokens: 5000, stream: false };
  if (new URL(base).hostname === 'api.deepseek.com') request.thinking = { type: 'disabled' };
  let response;
  try { response = await fetcher(`${base}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` }, body: JSON.stringify(request), signal: AbortSignal.timeout(90000) }); }
  catch { throw Object.assign(new Error('AI服务连接失败或超时，请检查网络后重试。'), { status: 502 }); }
  if (!response.ok) throw Object.assign(new Error(`AI服务返回 ${response.status}，请检查密钥、余额或模型设置。`), { status: 502 });
  const payload = await response.json(), raw = payload.choices?.[0]?.message?.content;
  let result = null, validationError = null;
  try {
    if (payload.choices?.[0]?.finish_reason === 'length') throw new Error('AI输出被截断');
    result = validateLesson(JSON.parse(raw), hits);
  } catch (e) { validationError = e instanceof SyntaxError ? 'AI没有返回有效JSON' : e.message; result = null; }
  if (requireValid && validationError) throw Object.assign(new Error(validationError + '，请重试。'), { status: 502 });
  return { result, validationError, raw: typeof raw === 'string' ? raw : '', finishReason: payload.choices?.[0]?.finish_reason, model: payload.model || config.model, usage: payload.usage || null, durationMs: Date.now() - start, messages: input, parameters: { temperature: request.temperature, max_tokens: request.max_tokens, thinking: request.thinking } };
}
export function similarity(a, b) {
  const grams = s => { const t = normalize(s); return new Set(Array.from({ length: Math.max(0, t.length - 2) }, (_, i) => t.slice(i, i + 3))); };
  const x = grams(a), y = grams(b), union = new Set([...x, ...y]);
  return union.size ? [...x].filter(t => y.has(t)).length / union.size : 1;
}
