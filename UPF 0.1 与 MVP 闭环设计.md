# UPF 0.1 与 MVP 闭环设计

形成日期：2026-05-23  
定位：把“规划专属软件与 UPF 格式”的想法收敛成第一版可开发、可演示、可验证的最小闭环。

当前仓库已按本文结构建立第一版样例工程：[sample_project](./sample_project)。

## 1. UPF 0.1 目标

UPF 0.1 不追求覆盖所有规划成果，而是支撑一个城市更新片区原型完成以下闭环：

```text
对象建模 -> 指标计算 -> 规则检查 -> 问题清单 -> 方案调整 -> 诊断报告
```

它必须回答：

- 这个空间对象是什么？
- 它属于哪个方案？
- 它的指标是多少？
- 它触发了哪些规则？
- 判断依据来自哪里？
- 与另一个方案相比改善了什么、恶化了什么？

## 2. 最小目录结构

第一版可以不急于压缩为 `.upf`，开发阶段先使用展开目录。

```text
sample_project/
  manifest.json
  project.json
  scenarios.json
  objects/
    planning_units.geojson
    blocks.geojson
    parcels.geojson
    roads.geojson
    entrances.geojson
    facilities.geojson
    open_spaces.geojson
    control_lines.geojson
  rulesets/
    mvp_rules.json
  evidence/
    sources.json
  checks/
    scenario_a_check.json
  reports/
    scenario_a_diagnosis.md
```

## 3. 核心对象

### 3.1 Project

```json
{
  "id": "project_demo_update_001",
  "name": "城市更新片区样例",
  "type": "urban_renewal",
  "jurisdictionId": "CN-DEMO",
  "studyBoundaryObjectId": "unit_001",
  "defaultScenarioId": "scenario_a",
  "planningHorizon": {
    "baseYear": 2026,
    "targetYear": 2035
  }
}
```

### 3.2 Scenario

```json
{
  "id": "scenario_a",
  "name": "公共服务优先方案",
  "baseScenarioId": "baseline",
  "description": "在控制开发强度的同时补齐养老、社区活动和开放空间短板。"
}
```

### 3.3 Parcel

地块是 MVP 的主对象。

必填字段：

| 字段 | 含义 |
|---|---|
| `id` | 地块唯一标识 |
| `landUseCode` | 用地分类代码 |
| `areaSqm` | 地块面积 |
| `blockId` | 所属街坊 |
| `controls` | 控制指标 |
| `scenarioValues` | 分方案指标 |
| `renewal` | 更新方式与现状基线 |
| `evidenceRefs` | 证据来源 |

示例：

```json
{
  "id": "parcel_01",
  "type": "Parcel",
  "landUseCode": "0701",
  "areaSqm": 18500,
  "blockId": "block_01",
  "controls": {
    "farMax": 4.2,
    "buildingCoverageMax": 0.35,
    "greenRatioMin": 0.30,
    "heightMaxM": 100
  },
  "scenarioValues": {
    "baseline": {
      "far": 2.6,
      "buildingCoverage": 0.42,
      "greenRatio": 0.18,
      "residentialGfaSqm": 43000,
      "publicServiceGfaSqm": 300
    },
    "scenario_a": {
      "far": 3.8,
      "buildingCoverage": 0.31,
      "greenRatio": 0.28,
      "residentialGfaSqm": 61000,
      "publicServiceGfaSqm": 1200
    }
  },
  "renewal": {
    "currentMode": "old_residential_area",
    "proposedMode": "comprehensive_improvement",
    "baselineYear": 2026
  },
  "evidenceRefs": ["source_user_input_001"]
}
```

### 3.4 RoadSegment

```json
{
  "id": "road_01",
  "type": "RoadSegment",
  "name": "更新路",
  "roadClass": "secondary_road",
  "redLineWidthM": 30,
  "hasSidewalk": true,
  "hasBikeLane": true,
  "isEntranceRestricted": false
}
```

### 3.5 Entrance

```json
{
  "id": "entrance_01",
  "type": "Entrance",
  "entranceType": "vehicle",
  "servesObjectId": "parcel_01",
  "connectedRoadId": "road_01",
  "distanceToIntersectionM": 42,
  "conflicts": []
}
```

### 3.6 Facility

```json
{
  "id": "facility_01",
  "type": "Facility",
  "facilityType": "elderly_service",
  "scenarioId": "scenario_a",
  "serviceCapacityPeople": 1200,
  "gfaSqm": 650,
  "serviceRadiusM": 500,
  "isMixedUse": true
}
```

## 4. 指标计算

MVP 只做能够稳定解释的指标。

| 指标 | 输入 | 输出 |
|---|---|---|
| 地块面积 | 地块几何 | `areaSqm` |
| 容积率 | 计容建筑面积 / 地块面积 | `far` |
| 建筑密度 | 建筑基底面积 / 地块面积 | `buildingCoverage` |
| 绿地率 | 绿地面积 / 地块面积 | `greenRatio` |
| 居住人口 | 住宅建筑面积 / 人均住宅建筑面积 | `estimatedResidents` |
| 公服建筑面积 | 公服设施对象汇总 | `publicServiceGfaSqm` |
| 开放空间面积 | 开放空间对象汇总 | `openSpaceSqm` |

人口估算默认参数：

```json
{
  "method": "residential_gfa_per_capita",
  "sqmPerResident": 33,
  "confidence": "medium"
}
```

论文中应说明：该参数只是原型默认值，真实项目需要按地方标准、居住类型或调查数据校正。

## 5. 规则结果结构

每条检查结果统一为：

```json
{
  "id": "check_0001",
  "ruleId": "rule_far_max",
  "objectId": "parcel_01",
  "scenarioId": "scenario_a",
  "status": "failed",
  "severity": "error",
  "observedValue": 4.6,
  "requiredValue": "<= 4.2",
  "message": "parcel_01 的规划容积率为 4.6，超过控制值 4.2。",
  "sourceTrace": [
    "rulesets/mvp_rules.json",
    "objects/parcels.geojson"
  ]
}
```

状态建议：

- `passed`
- `failed`
- `warning`
- `needs_review`
- `not_applicable`
- `insufficient_data`

严重等级建议：

- `error`
- `warning`
- `info`

## 6. MVP 规则清单

第一版规则数量控制在 20 条左右。

### 6.1 地块指标规则

| id | 名称 | 类型 | 结果 |
|---|---|---|---|
| `rule_far_max` | 容积率不得超过控制值 | L2 | error |
| `rule_coverage_max` | 建筑密度不得超过控制值 | L2 | error |
| `rule_green_ratio_min` | 绿地率不得低于控制值 | L2 | error |
| `rule_height_max` | 建筑高度不得超过控制值 | L2 | error |
| `rule_required_land_use` | 地块用地性质应符合控制要求 | L2 | error |

### 6.2 存量更新规则

| id | 名称 | 类型 | 结果 |
|---|---|---|---|
| `rule_no_worse_green_ratio` | 更新后绿地率不应低于现状 | L4 | warning |
| `rule_no_worse_open_space` | 更新后公共开放空间不应减少 | L4 | warning |
| `rule_no_worse_service_gfa` | 更新后公共服务面积不应减少 | L4 | warning |
| `rule_high_density_review` | 高密度增容需专项论证 | L4 | needs_review |
| `rule_renewal_mode_evidence` | 更新方式应有证据支撑 | L4 | needs_review |

### 6.3 公共服务规则

| id | 名称 | 类型 | 结果 |
|---|---|---|---|
| `rule_estimated_residents_required` | 住宅地块应有人口估算 | L6 | warning |
| `rule_elderly_service_capacity` | 养老服务能力应匹配估算人口 | L5 | warning |
| `rule_community_activity_space` | 社区活动空间应匹配估算人口 | L5 | warning |
| `rule_kindergarten_review` | 居住人口达到阈值时应检查幼儿园需求 | L5 | needs_review |
| `rule_service_radius_review` | 公共设施服务半径覆盖不足需复核 | L5 | needs_review |

### 6.4 道路与出入口规则

| id | 名称 | 类型 | 结果 |
|---|---|---|---|
| `rule_vehicle_entrance_distance` | 机动车出入口距交叉口不宜过近 | L5 | warning |
| `rule_entrance_on_restricted_road` | 限制开口道路不宜设置机动车出入口 | L5 | warning |
| `rule_entrance_sensitive_conflict` | 出入口不应与敏感点明显冲突 | L5 | warning |
| `rule_sidewalk_continuity` | 主要生活道路应保持人行连续性 | L5 | warning |
| `rule_parcel_has_access` | 开发地块应具备道路联系 | L5 | warning |

## 7. 第一版界面

MVP 界面只需要五个区域。

```text
┌──────────────────────────────────────────┐
│ 顶部工具栏：项目 / 方案 / 检查 / 报告       │
├───────────────┬──────────────────────────┤
│ 对象列表       │ 地图画布                   │
│ - 地块         │ - 地块面                    │
│ - 道路         │ - 道路线                    │
│ - 设施         │ - 出入口点                  │
├───────────────┼──────────────────────────┤
│ 属性面板       │ 问题清单 / 指标表 / 报告预览 │
└───────────────┴──────────────────────────┘
```

不要先追求高级绘图。第一版可以先加载样例数据，再允许用户修改属性并重新检查。

## 8. 样例项目要求

样例项目建议至少包含：

- 1 个规划单元
- 2 个街坊
- 8 个地块
- 5 条道路
- 8 个出入口
- 4 类公共服务设施
- 2 个方案
- 20 条规则
- 20 条以上检查结果

## 9. 报告输出结构

诊断报告建议输出 Markdown。

```markdown
# 城市更新片区方案诊断报告

## 1. 项目概况

## 2. 方案指标汇总

## 3. 主要问题

## 4. 地块指标检查

## 5. 公共服务设施缺口

## 6. 道路与出入口风险

## 7. 存量更新优化不恶化分析

## 8. 规则依据与数据来源

## 9. 建议调整方向
```

## 10. 原型验收清单

完成以下内容，就算第一版闭环成立：

- [ ] 可以加载样例 UPF 项目。
- [ ] 可以显示地块、道路、设施、出入口。
- [ ] 可以切换 baseline 和 scenario_a。
- [ ] 可以编辑地块指标。
- [ ] 可以重新计算人口和核心指标。
- [ ] 可以运行 20 条左右规则。
- [ ] 可以显示结构化问题清单。
- [ ] 可以点击问题定位到对象。
- [ ] 可以导出 Markdown 诊断报告。
- [ ] 可以保存修改后的项目 JSON。

## 11. 论文中如何讲清 MVP

答辩时不要说“本系统已经解决所有规划审查问题”，应这样表述：

> 本研究选取城市更新片区中的地块指标、公共服务、道路出入口和存量优化四类高频问题，构建了一个最小可运行的语义化规划对象模型和规则辅助审查原型。原型用于验证对象模型、规则追溯和方案诊断闭环的可行性。

这个说法既有创新性，也不夸大。

## 12. 立即进入开发的第一批任务

当前已经建立 `sample_project` 和 UPF 验证脚本。下一轮建议开始进入原型仓库结构：

1. 建立 `apps/studio` 前端项目。
2. 建立 `packages/upf-core`，放对象类型、规则类型和计算函数。
3. 先实现地块列表、属性面板和规则检查结果。
4. 再接地图画布和报告导出。

第一版界面哪怕朴素，只要规则闭环能跑，就是非常好的毕业设计骨架。
