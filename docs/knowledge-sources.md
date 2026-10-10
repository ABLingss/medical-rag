# 知识库准备与来源

当前知识库是小范围演示资料，不是完整医学教材。中文内容为原创教学摘要与练习，外部来源支持基础概念；口诀是辅助记忆表达。上线前应由小组根据本校教材逐项核对。

| 内置资料 | 原始来源 | 覆盖范围 |
| --- | --- | --- |
| 心力衰竭概念与机制 | [NHLBI](https://www.nhlbi.nih.gov/health/heart-failure) | 充盈或泵血问题、基础表现与学习边界 |
| GFR与eGFR | [NIDDK](https://www.niddk.nih.gov/health-information/kidney-disease/chronic-kidney-disease-ckd/tests-diagnosis) | 肌酐估算与尿白蛋白的不同信息 |
| eGFR估算边界 | [NIDDK计算工具说明](https://www.niddk.nih.gov/health-information/professionals/clinical-tools-patient-management/kidney-disease/laboratory-evaluation/estimated-gfr-calculators/adults-pediatrics) | 估算值与适用人群限制 |
| 炎症细胞因子 | [NCBI Immunobiology](https://www.ncbi.nlm.nih.gov/sites/books/NBK27122/) | 免疫信号、趋化与协调反应 |

来源访问核对日期为2026年10月10日，不代表资料发布日期或最新教材版本。上述摘要不包含临床诊断阈值、药物剂量或治疗方案。公开可读不等于所有内容都可任意转载，因此仓库仅保留简短摘要及链接，没有打包整本外部教材。

## 推荐导入流程

1. 选定一份本校教材与版次，每个演示主题先准备对应章节。
2. 导出文字版PDF或UTF-8的Markdown。扫描图像先OCR，检查公式、希腊字母、表格顺序。
3. 在知识库填资料名与来源链接，再上传。后端保留页码并分段。
4. 检索“心力衰竭”“GFR”“炎症因子”，展开片段，人工核查实际命中是否相关。
5. 用来源中的定义检查生成结果，记录漏检、误检和来源不支持的内容。

PDF页码指文件物理页序，可能与印刷页码不同。内置摘要的“页1”只是摘要记录编号，不是网页页码。图表、图片与公式不能保证正确提取；不依赖这部分生成关键结论。

当前检索的优势是本地、轻量、不需要额外API费用。它不擅长完全改写的同义问题或很长教材中的语义匹配。若课程扩展到数千片段，可增加嵌入向量索引与重排序，但仍应保留可追踪页码、材料版本和人工核查。
