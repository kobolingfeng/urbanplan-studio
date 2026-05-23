# UrbanPlan Studio

UrbanPlan Studio 是一个城市规划原生桌面软件原型。它不以 CAD 图层为中心，而以 UPF（Urban Planning Format）语义对象为中心，把地块、道路、出入口、公共设施、开放空间、控制线、规则检查和方案版本放进同一个可计算模型里。

## 当前原型能力

- 语义规划画布：显示地块、道路、设施、出入口、开放空间和控制线。
- 方案版本：内置“现状基准”“更新增强”“公共服务优先”三个方案。
- 对象 Inspector：可编辑地块用地、容积率、建筑密度、绿地率、住宅建面、公服建面、更新方式等。
- 结构化证据链：每个对象可维护字符串证据或 EvidenceSource（类型、时间、精度、许可、可信度），影响数据质量诊断和方案可信度。
- 导入审计：载入 UPF 后记录缺失字段、兼容修复和需复核对象，并并入质检报告。
- 导入报告：载入 UPF 后立即展示对象统计、当前方案、兼容修复和结构校验发现。
- UPF 结构校验：检查格式版本、必填字段、对象类型、情景完整性、坐标系一致性和出入口引用完整性。
- 规则检查：检查容积率、绿地率、建筑密度、用地兼容、公共服务缺口、出入口道路风险、历史风貌区更新风险。
- 规则目录：每条规则保留领域、默认等级、结构化 RuleSource、计算口径和是否属于原型启发式判断。
- 智能建议：根据规则问题生成可追溯建议。
- 综合评估：从控规符合性、公共服务、交通组织、生态开放空间、更新价值和证据可信度生成方案评分。
- 服务人口分摊：综合评估报告按地块展示人口、公服建面、幼儿园和养老需求及覆盖状态。
- 权重敏感性：用均衡、公共服务优先、保护生态优先、实施风险优先四类模型复核推荐方案是否稳健。
- 决策矩阵：对全部方案重新运行规则和评分，输出推荐方案、风险对照和答辩解释。
- 案例验证包：汇总研究问题、数据概况、方案矩阵、敏感性、实验记录表和 CSV 附录。
- 评分热力图：地块颜色随综合评分变化，便于现场识别优先优化对象。
- 对象搜索与风险筛选：可按关键词、问题对象、高风险对象、地块或设施快速定位。
- 方案优化策略：支持合规回调、公共服务优先、生态保护优先三类快速方案调整。
- 图面解释增强：方案列表直接显示评分，选中公共设施时显示服务半径覆盖圈。
- 键盘工作流：支持对象搜索、对象列表方向键导航、运行检查、保存和载入的常用快捷操作。
- UPF 输出：可查看和保存 `.upf` JSON 数据。
- GeoJSON 输出：可把当前语义对象导出为 FeatureCollection，保留 UPF 对象属性和当前方案指标。
- 诊断报告：可生成 Markdown 格式的规划诊断报告。

## 运行

首次安装依赖：

```powershell
bun install
```

完整验证：

```powershell
bun run verify
```

清理构建产物：

```powershell
bun run clean
```

```powershell
bun run build:frontend
```

静态预览：

```powershell
cd dist
python -m http.server 4173 --bind 127.0.0.1
```

打开：

```text
http://127.0.0.1:4173
```

桌面壳运行可继续使用框架原有脚本：

```powershell
bun run dev
```

打包前建议执行：

```powershell
bun run clean
bun run verify
bun run verify:release
```

输出示例：`release/UrbanPlan Studio-0.1.0-portable.zip`

## 样例数据

- `examples/minimal.upf`：最小可导入样例。
- `examples/luohu-demo.upf`：罗湖城市更新片区样例。
- `examples/luohu-case-v1.upf`：面向案例验证的罗湖片区样例，包含 3 个地块、3 条道路、3 类设施、开放空间、风貌约束和 3 个方案。
- `examples/invalid.upf`：故意无效样例，用于导入校验和 smoke test。
- `schemas/upf-0.1.schema.json`：UPF 0.1 JSON Schema 草案，用于论文和后续工具链说明。

## 设计文档

- `docs/architecture.md`：当前模块、运行时、验证链路和数据流。
- `docs/upf-0.1-schema.md`：UPF 0.1 语义格式说明。
- `docs/rule-engine-roadmap.md`：规则引擎拆分路线。
- `docs/professional-benchmark.md`：专业规划/数字城市产品参考。
- `docs/release-checklist.md`：发布检查清单。
- `docs/manual-acceptance-test.md`：人工验收步骤。
- `docs/next-professional-steps.md`：下一阶段专业化 backlog。
- `docs/defense-demo-script.md`：毕业设计答辩演示脚本。
- `docs/expert-review-form.md`：专家评审表模板。
- `docs/case-validation-protocol.md`：案例验证流程和论文记录方法。
- `docs/cases/luohu/`：罗湖案例数据来源登记和验证记录模板。

## 专业化改进记录

- `dist` 构建前自动清理，避免把浏览器缓存、截图、运行时 profile 混入交付物。
- 原生 `app.exe` 写入 Windows VERSIONINFO，并由静态 smoke 校验文件版本与 `app.config.json` 一致。
- UPF 保存现在带顶层 `format/formatVersion`，保存后可以再次载入。
- 导入经过兼容层处理，缺失字段会补默认值，非法对象会被过滤。
- 质检报告现在包含 UPF 结构校验和规则目录元数据。
- 编辑后会写入本地自动备份，左侧 Project 头部可恢复。
- 新增方案对比与数据质量诊断入口。
- 出入口交叉口距离不再使用硬编码点，而是从道路几何计算交点。
- 运行时校验会拒绝声明为 `EPSG:4490` 但坐标明显来自演示画布或投影坐标的混合 CRS 文件。
- 历史风貌风险不再只看地块质心，改为判断地块与控制线是否重叠。
- 删除对象时阻止产生出入口悬挂引用。
- 新增 `smoke:geometry`、`smoke:upf`、`smoke:rules`、`smoke:rule-fixtures`、`smoke:static`、`smoke:release` 和 `verify` 脚本。
- 新增 `planning-evaluation.ts` 与 `smoke:evaluation`，把多指标方案评价纳入自动验证。
- 新增毕业设计方案与评价方法文档，便于把原型功能映射到论文研究问题、实验设计和答辩材料。
- 新增案例验证包导出，把方案评分、敏感性、数据质量、实验记录和 CSV 附录整合为论文证据链。
- 新增 `upf-validation.ts`、规则目录元数据和 JSON Schema 草案，强化格式规范与规则可追溯性。
- 新增结构化 EvidenceSource，UPF Schema、运行时校验、数据质量报告和综合评分会识别证据类型、时间、精度、许可和可信度。
- 新增结构化 RuleSource，规则目录和规则结果会显式区分技术导则、格式约束和原型启发式来源。

## 说明

当前是 MVP 原型，不替代法定控规审查、交通影响评价、消防审查或正式专项规划。它的价值在于验证一种新的软件方向：用规划对象和规则引擎替代单纯 CAD 绘图，把方案变成可计算、可追溯、可比较的数据资产。
