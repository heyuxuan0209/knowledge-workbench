# Curated Selection Bench

这是“精选”透明策略的离线验收工具，不调用模型、不连接数据库，也不替用户生成黑盒价值分。

每个 JSONL 样本代表同一轮候选池中的一条内容：

```json
{"caseId":"launch-001","split":"development","stratum":"official","decision":"must_surface","candidate":{"id":"content-001","source_id":"openai","tier":"T1","reg":0,"sc":2,"created_at":"2026-09-29T08:00:00Z"}}
```

`decision` 只有四种：

- `must_surface`：这轮不出现就是明确漏推。
- `acceptable`：出现合理，但不要求必须出现。
- `reject`：出现就是明确误推。
- `either`：分歧样本，不进入精确率分母，但仍保留用于观察排序。

建议至少按 `official`、`registered`、`multi_source`、`fresh_only`、`hard_negative` 分层，并把争议较少的样本留作 `holdout`。同一份文件里的样本会作为一个候选池一起排序，因此不要把不同日期、不同用户上下文的候选混在一轮。

运行时必须固定 `--at`，否则新鲜度会让同一份金标在不同日期得到不同结果：

```bash
cd backend
npm run eval:curation -- --gold /path/to/curation-gold.jsonl --at 2026-09-29T12:00:00Z --split holdout --limit 12
```

核心指标是：`mustSurfaceRecallAtK`（明确该出现的漏了多少）、`precisionAtK`（有明确判断的入选项里多少合理）、`rejectsSurfaced`、`reasonCoverageAtK` 和 `sourceDiversityAtK`。任何调权重或改配额，都先比较 development 与 holdout，不用单次体感替代验收。
