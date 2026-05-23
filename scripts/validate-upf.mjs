import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const projectDir = path.resolve(process.argv[2] ?? "sample_project");

const requiredFiles = [
  "manifest.json",
  "project.json",
  "scenarios.json",
  "objects/planning_units.geojson",
  "objects/blocks.geojson",
  "objects/parcels.geojson",
  "objects/roads.geojson",
  "objects/entrances.geojson",
  "objects/facilities.geojson",
  "objects/open_spaces.geojson",
  "objects/control_lines.geojson",
  "rulesets/mvp_rules.json",
  "evidence/sources.json"
];

const validStatuses = new Set([
  "passed",
  "failed",
  "warning",
  "needs_review",
  "not_applicable",
  "insufficient_data"
]);

const validSeverities = new Set(["error", "warning", "info"]);

function fail(message) {
  throw new Error(message);
}

function readJson(relativePath) {
  const filePath = path.join(projectDir, relativePath);
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`Cannot parse ${relativePath}: ${error.message}`);
  }
}

function collectFiles(dir, result = []) {
  for (const name of readdirSync(dir)) {
    const filePath = path.join(dir, name);
    const stats = statSync(filePath);
    if (stats.isDirectory()) {
      collectFiles(filePath, result);
    } else {
      result.push(filePath);
    }
  }
  return result;
}

function asRelative(filePath) {
  return path.relative(projectDir, filePath).replaceAll("\\", "/");
}

function featureId(feature, fileName, index) {
  return feature?.properties?.id ?? fail(`${fileName} feature ${index} is missing properties.id`);
}

if (!existsSync(projectDir)) {
  fail(`Project directory does not exist: ${projectDir}`);
}

for (const relativePath of requiredFiles) {
  if (!existsSync(path.join(projectDir, relativePath))) {
    fail(`Missing required file: ${relativePath}`);
  }
}

for (const filePath of collectFiles(projectDir)) {
  if (filePath.endsWith(".json") || filePath.endsWith(".geojson")) {
    readJson(asRelative(filePath));
  }
}

const manifest = readJson("manifest.json");
const scenarios = readJson("scenarios.json").scenarios ?? [];
const ruleset = readJson("rulesets/mvp_rules.json");
const checksPath = "checks/scenario_a_check.json";
const checks = existsSync(path.join(projectDir, checksPath)) ? readJson(checksPath).results ?? [] : [];

if (manifest.format !== "UPF") {
  fail("manifest.format must be UPF");
}

const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));
if (!scenarioIds.has(manifest.defaultScenarioId)) {
  fail(`defaultScenarioId is not defined in scenarios.json: ${manifest.defaultScenarioId}`);
}

const objectIds = new Set();
const featureCounts = {};

for (const objectFile of requiredFiles.filter((file) => file.startsWith("objects/"))) {
  const collection = readJson(objectFile);
  if (collection.type !== "FeatureCollection") {
    fail(`${objectFile} must be a FeatureCollection`);
  }

  featureCounts[objectFile] = collection.features.length;
  collection.features.forEach((feature, index) => {
    const id = featureId(feature, objectFile, index);
    if (objectIds.has(id)) {
      fail(`Duplicate object id: ${id}`);
    }
    objectIds.add(id);
  });
}

const ruleIds = new Set();
for (const rule of ruleset.rules ?? []) {
  if (!rule.id) {
    fail("Rule is missing id");
  }
  if (ruleIds.has(rule.id)) {
    fail(`Duplicate rule id: ${rule.id}`);
  }
  if (!validSeverities.has(rule.severity)) {
    fail(`Rule ${rule.id} has invalid severity: ${rule.severity}`);
  }
  ruleIds.add(rule.id);
}

if (ruleIds.size < 20) {
  fail(`Expected at least 20 rules, found ${ruleIds.size}`);
}

for (const check of checks) {
  if (!ruleIds.has(check.ruleId)) {
    fail(`Check ${check.id} references missing rule: ${check.ruleId}`);
  }
  if (!objectIds.has(check.objectId)) {
    fail(`Check ${check.id} references missing object: ${check.objectId}`);
  }
  if (!validStatuses.has(check.status)) {
    fail(`Check ${check.id} has invalid status: ${check.status}`);
  }
  if (!validSeverities.has(check.severity)) {
    fail(`Check ${check.id} has invalid severity: ${check.severity}`);
  }
}

const summary = {
  projectDir,
  defaultScenarioId: manifest.defaultScenarioId,
  scenarios: scenarioIds.size,
  objects: Object.values(featureCounts).reduce((sum, count) => sum + count, 0),
  parcels: featureCounts["objects/parcels.geojson"],
  roads: featureCounts["objects/roads.geojson"],
  entrances: featureCounts["objects/entrances.geojson"],
  rules: ruleIds.size,
  checks: checks.length
};

console.log(JSON.stringify(summary, null, 2));
