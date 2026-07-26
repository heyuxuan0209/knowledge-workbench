# 声音层（voices/）

内容创作的**第四条正交轴**（与 `genres/` 文体、`platform-forms/` 平台形态平行）——ADR-026 正交组合、ADR-052 §Q1。

**边界（关键）**：声音只调**口吻 / 句式 / 人称 / 节奏**这一薄层；**作者身份不在这里**——「你是谁 / 诚实到较真 / 具体优先 / 禁营销腔」由 `../voice-profile.md` 注入 draft-frame 的「作者声音」段**全局锚定、永不被声音覆盖**（守 ADR-025 三层）。换声音是"换语气"，不是"换人"。

**软层·可选**：不选声音＝当前行为不变（只有文体×平台形态）。选了才把该 voice 的 `spec` 追加到 composedSpec 的`【声音·可选】`段。系列风格预设自带 `default_voice`，用户可覆盖或关闭。

**写规则不写例句**：每个 voice.md 只写"怎么说"的规则，**不放示范句**——`voice-profile.md` 记过教训（2026-07-18）：例句会被模型背诵套用。示范开头见 `reference/series-template/SERIES-SPEC.md`（那是给人对照的 checklist，不进 prompt）。

**内容来源**：4 个声音的定义来自系列交接 `SERIES-SPEC.md`（设计方）；后续声音内容的调整由设计方维护，我方维护装配机制（loader/composition/UI）。

清单（同 SERIES-SPEC §三）：`brisk` 轻快犀利 · `deep` 沉稳深度 · `analytic` 理性克制 · `sharp` 观点鲜明。
