# 多 Agent 工作流配置说明

这套配置把「冷启动收敛」和「开发-review」两个流程装进 Claude Code。
剧本(skills)是交规,subagent 是独立视角的审查者,hook 是绕不过去的红绿灯。

## 文件清单

```
.claude/
├── skills/
│   ├── kickoff-debate/SKILL.md   # 冷启动收敛流程(Builder vs Challenger,产出设计文档)
│   └── dev-review/SKILL.md       # 开发-review 流程(测试门 → reviewer → 三段式报告)
├── agents/
│   ├── challenger.md             # 设计挑战者(独立上下文,可证伪 issue,强制替代方案)
│   └── reviewer.md               # 方向符合性审查者(rubric + 负面清单)
├── hooks/
│   └── test-gate.sh              # 测试门:收工前强制跑测试,失败打回
├── settings.json                 # Stop hook 配置(项目级,建议进 git)
└── WORKFLOWS-README.md           # 本文件
```

## 怎么用

**场景 1:新想法还很模糊**

在项目里打开 Claude Code,说:

> 按 kickoff-debate 流程,和我讨论「素材卡片功能」

它会:先只提问不出方案 → 你确认问题陈述和验收判据 → Builder 出编号方案 →
challenger subagent 独立攻击 → 逐条处置 → 最多 3 轮 → 待拍板项打包给你 →
产出 `docs/designs/素材卡片.md`。

**场景 2:按设计文档开发**

> 按 dev-review 流程,实现 docs/designs/素材卡片.md

它会:测试名清单先给你确认方向 → 写测试再实现 → hook 强制测试全绿 →
reviewer subagent 审 diff 与设计文档的符合性 → 你只收三段式报告,裁决 DISPUTED 项。

## 注意事项

1. **hook 首次生效需重启 Claude Code 会话**,并给脚本加执行权限:
   `chmod +x .claude/hooks/test-gate.sh`
2. 项目当前没有测试脚本时,测试门自动放行(它只在 package.json 有真实 test script 时才拦)。
   dev-review 流程的 Step 3 会让 agent 补测试,补上后门自动生效。
3. `settings.json` 是项目级配置(建议进 git);你已有的 `settings.local.json` 是本地级,
   两者会合并,互不覆盖。
4. subagent 靠 agents/*.md 的 description 触发,skills 靠名字或语义触发;
   说"按 XXX 流程"最稳。

## 棘轮规则(怎么迭代这套流程)

每跑完一轮,只问一个问题:**这次我在哪些地方不得不人工纠偏?**

- 每个纠偏点 → 变成对应 SKILL.md / agents/*.md 里的一条新规则(改 markdown 即可,零成本)
- 某步骤连续 3 次零纠偏 → 才考虑把它进一步自动化
- 判断类的门(验收判据确认、DISPUTED 裁决、合入决定)留给人,最后自动化甚至永不自动化

这套 `.claude/` 目录跟着 git 走。新项目复制整个目录即可复用,改的是模板里的判据和 rubric。
