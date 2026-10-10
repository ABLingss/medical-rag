const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const read = key => { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const state = { token: '', current: null, status: null, saved: read('zhiyi-saved'), experiments: read('zhiyi-experiments'), answers: new Map() };
const names = { learn: '学习工作台', library: '知识库', saved: '我的卡片', experiments: '实验与评估', prompts: '提示词库', settings: '连接与设置' };
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.add('hidden'), 6500); }
function persist(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { toast('浏览器存储已满，记录仍在当前页面内，请立即导出备份。'); return false; } }
async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...options.headers } });
  const data = await res.json(); if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`); return data;
}
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
function view(name) {
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('hidden', el.id !== name));
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === name));
  $('#page-name').textContent = names[name];
  if (name === 'library') loadDocuments().catch(e => toast(e.message));
  if (name === 'saved') renderSaved();
  if (name === 'experiments') renderExperiments();
  window.scrollTo({ top: 0, behavior: 'auto' });
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => view(button.dataset.view)));
document.querySelectorAll('[data-topic]').forEach(button => button.addEventListener('click', () => { $('#query').value = button.dataset.topic; $('#query').focus(); }));
function tab(name) {
  document.querySelectorAll('.tab').forEach(el => { const active = el.dataset.tab === name; el.classList.toggle('active', active); el.setAttribute('aria-selected', String(active)); });
  document.querySelectorAll('.tab-panel').forEach(el => el.classList.toggle('hidden', el.id !== name));
}
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => tab(button.dataset.tab)));
function sourceLink(source) {
  try { const url = new URL(source.url); if (['https:', 'http:'].includes(url.protocol)) return `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(source.title || '查看来源')} ↗</a>`; } catch {}
  return `<span class="small muted">${esc(source.title || '用户上传资料')}</span>`;
}
function sourceHTML(h) { return `<article class="source-item"><b>${esc(h.title)}</b><div class="source-id">${esc(h.id)} · ${h.builtin ? '摘要内部页' : 'PDF / 文本页'} ${esc(h.page)} · 检索得分 ${esc(h.score)}</div><details><summary>查看资料片段</summary><p>${esc(h.text)}</p><p class="small muted">${esc(h.source.note)}</p></details>${sourceLink(h.source)}</article>`; }
function showLesson(output) {
  state.current = output; state.answers.clear();
  const r = output.result;
  $('#welcome').classList.add('hidden'); $('#result').classList.remove('hidden');
  $('#result-title').textContent = r.title;
  $('#result-meta').textContent = output.mode === 'ai' ? `${output.model} · 真实AI生成 · ${(output.durationMs / 1000).toFixed(1)}秒 · ${output.hits.length}条参考片段` : output.mode === 'demo' ? '预制教学示例 · 非本次AI生成' : '证据不足 · 已停止生成';
  $('#overview').innerHTML = `<div class="note-block"><h3>一句话理解</h3><p>${esc(r.summary)}</p></div>${r.mechanism.length ? `<div class="note-block"><h3>顺着机制理解</h3><div class="mechanism">${r.mechanism.map((s, i) => `<div class="mechanism-step"><span>${String(i + 1).padStart(2, '0')}</span>${esc(s)}</div>`).join('')}</div></div>` : ''}${r.comparison.length ? `<div class="note-block"><h3>容易混淆的地方</h3><table class="compare-table"><thead><tr><th>概念</th><th>怎么区分</th></tr></thead><tbody>${r.comparison.map(c => `<tr><td>${esc(c.concept)}</td><td>${esc(c.distinction)}</td></tr>`).join('')}</tbody></table></div>` : ''}${r.mnemonic ? `<div class="note-block"><h3>记忆辅助 · 不替代定义</h3><div class="mnemonic">${esc(r.mnemonic)}</div></div>` : ''}`;
  $('#cards').innerHTML = r.cards.length ? `<p class="small muted">先在心里作答，再点击卡片翻面。</p><div class="card-grid">${r.cards.map((c, i) => `<button class="flashcard" data-card="${i}" aria-label="翻转卡片${i + 1}"><small>RECALL / ${String(i + 1).padStart(2, '0')}</small><strong>${esc(c.front)}</strong><span>点击查看答案 ↻</span></button>`).join('')}</div>` : '<div class="empty">没有足够资料生成卡片。</div>';
  document.querySelectorAll('[data-card]').forEach(button => button.addEventListener('click', () => {
    const card = r.cards[Number(button.dataset.card)], flipped = button.classList.toggle('flipped');
    button.querySelector('strong').textContent = flipped ? card.back : card.front;
    button.querySelector('span').textContent = flipped ? `来源 ${card.sourceIds.join(' / ')} · 点击回到问题 ↻` : '点击查看答案 ↻';
  }));
  $('#quiz').innerHTML = r.quiz.length ? `<p class="small muted" id="quiz-score">选择答案后查看解析 · 共${r.quiz.length}题</p>${r.quiz.map((q, i) => `<article class="question"><h3>${i + 1}. ${esc(q.question)}</h3>${q.options.map((o, j) => `<button class="option" data-question="${i}" data-option="${j}">${'ABCD'[j]}　${esc(o)}</button>`).join('')}<div class="feedback hidden" id="feedback-${i}"></div></article>`).join('')}` : '<div class="empty">没有足够资料生成自测题。</div>';
  document.querySelectorAll('[data-question]').forEach(button => button.addEventListener('click', () => {
    const i = Number(button.dataset.question), j = Number(button.dataset.option), q = r.quiz[i];
    if (state.answers.has(i)) return;
    state.answers.set(i, j); button.classList.add('selected');
    document.querySelectorAll(`[data-question="${i}"]`).forEach(b => { b.disabled = true; });
    const feedback = $(`#feedback-${i}`); feedback.classList.remove('hidden'); feedback.classList.toggle('wrong', j !== q.answer);
    feedback.textContent = `${j === q.answer ? '回答正确' : `正确答案：${'ABCD'[q.answer]}`} · ${q.explanation}（来源：${q.sourceIds.join(' / ')}）`;
    const correct = [...state.answers].filter(([index, selected]) => r.quiz[index].answer === selected).length;
    $('#quiz-score').textContent = `已作答 ${state.answers.size}/${r.quiz.length} · 正确 ${correct} 题`;
  }));
  $('#risks').innerHTML = `<b>核查与边界</b><ul>${r.risks.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;
  $('#hit-count').textContent = output.hits.length; $('#sources').innerHTML = output.hits.map(sourceHTML).join('') || '<div class="source-empty">未找到相关资料</div>';
  tab('overview');
}
$('#generate-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('#generate'); button.disabled = true; $('#loading').classList.remove('hidden');
  try { showLesson(await post('/api/generate', { query: $('#query').value.trim(), mode: $('#mode').value })); }
  catch (e) { toast(e.message); if (/口令/.test(e.message)) view('settings'); }
  finally { button.disabled = false; $('#loading').classList.add('hidden'); }
});
function download(name, text, type = 'application/json') {
  const blob = new Blob([text], { type }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name.replace(/[\\/:*?"<>|]/g, '_'); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function markdown(output) {
  const r = output.result;
  return `# ${r.title}\n\n模式：${output.mode} ${output.model || ''}\n\n## 解释\n${r.summary}\n\n## 机制\n${r.mechanism.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n## 概念辨析\n${r.comparison.map(c => `- ${c.concept}：${c.distinction}`).join('\n')}\n\n## 记忆辅助\n${r.mnemonic}\n\n## 卡片\n${r.cards.map(c => `- 问：${c.front}\n  答：${c.back}\n  来源：${c.sourceIds.join(', ')}`).join('\n')}\n\n## 自测\n${r.quiz.map(q => `${q.question}\n${q.options.map((o, j) => `${'ABCD'[j]}. ${o}`).join('\n')}\n答案：${'ABCD'[q.answer]}；${q.explanation}\n来源：${q.sourceIds.join(', ')}`).join('\n\n')}\n\n## 风险\n${r.risks.map(s => '- ' + s).join('\n')}\n\n## 资料片段\n${output.hits.map(h => `### ${h.id} · ${h.title} · 页${h.page}\n${h.text}\n\n${h.source.title}\n${h.source.url || '用户上传'}\n${h.source.note}`).join('\n\n')}\n`;
}
$('#export-lesson').addEventListener('click', () => state.current && download(`${state.current.result.title}.md`, markdown(state.current), 'text/markdown;charset=utf-8'));
$('#save-lesson').addEventListener('click', () => {
  if (!state.current) return;
  if (!state.current.result.cards.length) return toast('当前结果没有可收藏的卡片。');
  if (state.saved.length >= 50) return toast('最多收藏50份笔记，请导出并删除旧收藏。');
  state.saved.unshift({ ...structuredClone(state.current), savedAt: new Date().toISOString(), id: crypto.randomUUID() });
  persist('zhiyi-saved', state.saved); toast('已加入我的卡片。');
});
function renderSaved() {
  $('#saved-list').innerHTML = state.saved.length ? state.saved.map((s, i) => `<article class="document"><div class="section-row"><h3>${esc(s.result.title)}</h3><span class="badge">${s.mode === 'ai' ? 'AI生成' : '教学示例'}</span></div><p>${esc(s.result.summary)}</p><p>${new Date(s.savedAt).toLocaleString('zh-CN')} · ${s.result.cards.length}张卡片</p><div class="actions"><button class="secondary" data-open-saved="${i}">开始复习 ↗</button><button class="secondary" data-export-saved="${i}">导出</button><button class="secondary" data-delete-saved="${i}">移除收藏</button></div></article>`).join('') : '<div class="empty">生成学习内容后，点击收藏，在这里开始复习。</div>';
  document.querySelectorAll('[data-open-saved]').forEach(b => b.onclick = () => { const s = state.saved[Number(b.dataset.openSaved)]; view('learn'); showLesson(s); tab('cards'); });
  document.querySelectorAll('[data-export-saved]').forEach(b => b.onclick = () => { const s = state.saved[Number(b.dataset.exportSaved)]; download(`${s.result.title}.md`, markdown(s), 'text/markdown'); });
  document.querySelectorAll('[data-delete-saved]').forEach(b => b.onclick = () => { state.saved.splice(Number(b.dataset.deleteSaved), 1); persist('zhiyi-saved', state.saved); renderSaved(); });
}
async function loadStatus() {
  state.status = await api('/api/status');
  const s = state.status;
  $('#connection').textContent = s.aiEnabled ? `${s.model} 已连接` : '离线演示可用';
  $('#stat-docs').textContent = s.documents; $('#stat-chunks').textContent = s.chunks; $('#doc-count').textContent = s.documents;
  $('#settings-status').textContent = s.aiEnabled ? `主模型：${s.model} · ${s.compareEnabled ? '对照模型：' + s.compareModel : '第二个工具未配置'}` : 'AI未配置 · 可使用预制教学示例';
  if (!s.aiEnabled) $('#mode').value = 'demo';
}
async function loadDocuments() {
  const docs = await api('/api/documents');
  $('#document-list').innerHTML = docs.map(d => `<article class="document"><div class="section-row"><span class="badge">${esc(d.category)} · ${d.builtin ? '内置教学摘要' : '自建资料'}</span>${d.builtin ? '' : `<button class="secondary" data-delete-doc="${esc(d.id)}">删除资料</button>`}</div><h3>${esc(d.title)}</h3><p>${d.pages}页 · ${d.chunks}个片段 · ${esc(d.source.note)}</p>${sourceLink(d.source)}</article>`).join('');
  document.querySelectorAll('[data-delete-doc]').forEach(b => b.onclick = async () => {
    if (!confirm('删除这份资料及其检索片段？已导出的笔记不受影响。')) return;
    try { await api('/api/documents/' + encodeURIComponent(b.dataset.deleteDoc), { method: 'DELETE' }); await loadDocuments(); await loadStatus(); toast('资料已删除。'); } catch (e) { toast(e.message); }
  });
}
$('#search-form').addEventListener('submit', async event => {
  event.preventDefault(); try { const { hits } = await api('/api/search?q=' + encodeURIComponent($('#search-query').value)); $('#search-results').innerHTML = `<div class="surface">${hits.length ? hits.map(sourceHTML).join('') : '<p>没有检索到相关资料。</p>'}</div>`; } catch (e) { toast(e.message); }
});
$('#upload-form').addEventListener('submit', async event => {
  event.preventDefault(); const file = $('#upload-file').files[0]; if (!file) return;
  if (file.size > 10_000_000) return toast('文件超过10MB，请按章节拆分。');
  const button = $('#upload-button'); button.disabled = true; button.textContent = '正在提取与分段…';
  try {
    const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
    const result = await post('/api/documents', { name: file.name, base64, title: $('#upload-title').value, url: $('#upload-url').value });
    toast(`导入成功：${result.pages}页，${result.chunks}个片段。`); event.target.reset(); await loadDocuments(); await loadStatus();
  } catch (e) { toast(e.message); }
  finally { button.disabled = false; button.textContent = '导入知识库 ＋'; }
});
$('#token-form').addEventListener('submit', event => { event.preventDefault(); state.token = $('#access-token').value.trim(); $('#access-token').value = ''; toast('访问口令已保存至当前页面会话。'); });
async function loadPrompts() {
  const p = await api('/api/prompts');
  $('#prompt-list').innerHTML = p.modules.map((m, i) => `<article class="surface prompt-card"><span class="eyebrow">MODULE / ${String(i + 1).padStart(2, '0')}</span><h3>${esc(m.name)}</h3><p class="prompt-text">${esc(m.prompt)}</p><button class="secondary" data-copy-prompt="${i}">复制提示词</button></article>`).join('');
  document.querySelectorAll('[data-copy-prompt]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(p.modules[Number(b.dataset.copyPrompt)].prompt); toast('提示词已复制。'); } catch { toast('浏览器不支持自动复制，请直接选择文本复制。'); } });
  $('#risk-cases').innerHTML = p.riskCases.map((c, i) => `<button type="button" data-case="${i}" title="${esc(c.query)}">${esc(c.type)} ${i + 1} ↗</button>`).join('');
  document.querySelectorAll('[data-case]').forEach(b => b.onclick = () => { const c = p.riskCases[Number(b.dataset.case)]; $('#experiment-query').value = c.query; $('#experiment-kind').value = c.type === '同质化' ? 'repeat' : 'prompt'; });
}
$('#experiment-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('#run-experiment'); button.disabled = true; button.textContent = '实验运行中…';
  try {
    const record = await post('/api/experiment', { query: $('#experiment-query').value.trim(), kind: $('#experiment-kind').value });
    if (state.experiments.length >= 30) { download('实验记录自动备份.json', JSON.stringify(state.experiments, null, 2)); state.experiments = state.experiments.slice(0, 29); }
    state.experiments.unshift(record); persist('zhiyi-experiments', state.experiments); renderExperiments();
    toast(record.runs.every(r => !r.error) ? '真实实验完成，请逐项核查并填写观察。' : '实验已记录，部分调用失败，请查看错误说明。');
  } catch (e) { toast(e.message); }
  finally { button.disabled = false; button.textContent = '运行真实实验 ↗'; }
});
function renderExperiments() {
  const labels = { prompt: '粗放 / 精细对照', repeat: '同质化测试', tools: '多工具对比' };
  $('#experiment-list').innerHTML = state.experiments.length ? state.experiments.map((r, i) => `<article class="experiment-card"><span class="badge">${esc(labels[r.kind])} · 真实API调用记录</span><h3>${esc(r.query)}</h3><p class="small muted">${new Date(r.createdAt).toLocaleString('zh-CN')} · ID ${esc(r.id)} · ${r.hits.length}条相同资料</p><div class="experiment-grid">${r.runs.map((run, index) => `<div class="experiment-run"><b>${r.kind === 'prompt' ? run.style === 'coarse' ? '粗放提示' : '精细约束提示' : `${run.style === 'coarse' ? '粗放' : '精细'} 第${index % 3 + 1}次调用`}</b><div class="small muted">${esc(run.model)} ${run.durationMs ? '· ' + (run.durationMs / 1000).toFixed(1) + 's' : ''}</div>${run.validationError ? `<p class="small muted">结构校验：${esc(run.validationError)}，已保留原文</p>` : ''}<pre>${esc(run.error || run.raw)}</pre><details><summary class="small">查看实际提示词与参数</summary><pre>${esc(JSON.stringify({ messages: run.messages, parameters: run.parameters, usage: run.usage }, null, 2))}</pre></details></div>`).join('')}</div>${r.overlaps.length ? `<p class="small">三字片段Jaccard相似度（仅为文本重复的线索）：${r.overlaps.map(o => `${o.style === 'coarse' ? '粗放' : '精细'} ${esc(o.pair)}：${(o.value * 100).toFixed(1)}%`).join(' · ')}</p>` : ''}<label>人工核查与观察<textarea class="evaluation" data-evaluation="${i}" placeholder="记录：结构完整性、事实幻觉、逻辑错误、不确定信息、同质化与来源支持情况。不能仅凭输出流畅判定正确。">${esc(r.notes || '')}</textarea></label><button class="secondary" data-export-record="${i}">导出完整记录 ↓</button></article>`).join('') : '<div class="empty">运行一次真实实验，输出、提示词、资料快照与参数会完整保留。</div>';
  document.querySelectorAll('[data-evaluation]').forEach(el => el.oninput = () => { state.experiments[Number(el.dataset.evaluation)].notes = el.value; persist('zhiyi-experiments', state.experiments); });
  document.querySelectorAll('[data-export-record]').forEach(b => b.onclick = () => { const r = state.experiments[Number(b.dataset.exportRecord)]; download(`实验-${r.id}.json`, JSON.stringify(r, null, 2)); });
}
$('#export-experiments').addEventListener('click', () => download('知医-实验记录.json', JSON.stringify(state.experiments, null, 2)));
async function init() {
  try { const res = await fetch('/api/local-access'); if (res.ok) state.token = (await res.json()).token; } catch {}
  try { await Promise.all([loadStatus(), loadPrompts()]); } catch (e) { toast(e.message); $('#connection').textContent = '连接失败'; }
}
init();
