import type { Scenario, ScenarioStep } from "./scenario-test.js";

export interface ParsedFeature {
  featureName: string;
  scenarios: Scenario[];
}

export class GherkinParseError extends Error {}

/**
 * A small, FIXED step vocabulary -- not a general-purpose Gherkin
 * step-definition system with user-registrable step functions the way
 * real Cucumber/cucumber-js works (that's arbitrary custom code per step,
 * a much bigger and fundamentally different feature). This covers
 * exactly what's needed to drive the existing `runScenarioTest` engine
 * (an HTTP call, a status assertion, a response-field assertion, a
 * capture) from a real `.feature` file's plain-English Given/When/Then
 * syntax -- real Gherkin file format, translated into the same
 * `Scenario`/`ScenarioStep` shape `test --scenario` already runs.
 */
const REQUEST_PATTERN = /^I (GET|POST|PUT|PATCH|DELETE) "([^"]+)"(?: with body (.+?))?(?: and call it "([^"]+)")?$/i;
const STATUS_PATTERN = /^the response status should be (\d+)$/i;
const FIELD_PATTERN = /^the response field "([\w.]+)" should be (.+)$/i;
const CAPTURE_PATTERN = /^I capture "([\w.]+)" as "(\w+)"$/i;

function parseJsonValue(raw: string, context: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new GherkinParseError(`Couldn't parse ${context} as JSON: "${raw}" (${(err as Error).message})`);
  }
}

/**
 * Parses a real `.feature` file's text into one or more `Scenario`
 * objects, each runnable via the existing `runScenarioTest`.
 *
 * Deliberately out of scope for this first slice, with a clear error
 * rather than a silent misparse if encountered: tags (`@smoke`),
 * `Background:` (repeat shared setup in each Scenario instead),
 * `Scenario Outline:`/`Examples:` (data-driven scenarios -- write out
 * each case as its own plain `Scenario:` instead), and doc
 * strings/data tables. Every one of these is real, common Gherkin syntax
 * -- rejecting them loudly with a specific reason is the honest choice
 * over silently ignoring the line and producing a scenario that quietly
 * doesn't test what the `.feature` file's author actually wrote.
 */
export function parseFeature(source: string): ParsedFeature {
  const lines = source.split(/\r?\n/);
  let featureName = "";
  const scenarios: Scenario[] = [];
  let currentScenario: Scenario | null = null;
  let currentStep: ScenarioStep | null = null;
  let autoStepCounter = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNo = i + 1;
    if (line === "" || line.startsWith("#")) continue;

    if (/^@\S/.test(line)) {
      throw new GherkinParseError(`Line ${lineNo}: tags ("${line}") aren't supported in this first slice.`);
    }
    if (/^Background:/i.test(line)) {
      throw new GherkinParseError(`Line ${lineNo}: "Background:" isn't supported in this first slice -- repeat any shared setup steps in each Scenario instead.`);
    }
    if (/^Scenario Outline:/i.test(line) || /^Examples:/i.test(line)) {
      throw new GherkinParseError(
        `Line ${lineNo}: "Scenario Outline"/"Examples" (data-driven scenarios) aren't supported in this first slice -- write out each case as its own plain "Scenario:" instead.`
      );
    }
    if (line.startsWith("|") || line.startsWith('"""')) {
      throw new GherkinParseError(`Line ${lineNo}: data tables and doc strings aren't supported in this first slice.`);
    }

    const featureMatch = /^Feature:\s*(.*)$/i.exec(line);
    if (featureMatch) {
      featureName = featureMatch[1].trim();
      continue;
    }

    const scenarioMatch = /^Scenario:\s*(.*)$/i.exec(line);
    if (scenarioMatch) {
      currentScenario = { name: scenarioMatch[1].trim(), steps: [] };
      scenarios.push(currentScenario);
      currentStep = null;
      autoStepCounter = 0;
      continue;
    }

    const stepMatch = /^(Given|When|Then|And|But)\s+(.*)$/i.exec(line);
    if (!stepMatch) {
      throw new GherkinParseError(`Line ${lineNo}: expected a "Feature:"/"Scenario:"/step line, got: "${line}"`);
    }
    if (!currentScenario) {
      throw new GherkinParseError(`Line ${lineNo}: step found before any "Scenario:" line.`);
    }
    const stepText = stepMatch[2].trim();

    const requestMatch = REQUEST_PATTERN.exec(stepText);
    if (requestMatch) {
      const [, method, requestPath, bodyRaw, customName] = requestMatch;
      autoStepCounter++;
      currentStep = {
        name: customName ?? `step ${autoStepCounter}`,
        method: method.toUpperCase(),
        path: requestPath,
        body: bodyRaw ? (parseJsonValue(bodyRaw, `request body on line ${lineNo}`) as Record<string, unknown>) : undefined,
      };
      currentScenario.steps.push(currentStep);
      continue;
    }

    const statusMatch = STATUS_PATTERN.exec(stepText);
    if (statusMatch) {
      if (!currentStep) throw new GherkinParseError(`Line ${lineNo}: "the response status should be..." has no preceding request step in this Scenario.`);
      currentStep.expectStatus = parseInt(statusMatch[1], 10);
      continue;
    }

    const fieldMatch = FIELD_PATTERN.exec(stepText);
    if (fieldMatch) {
      if (!currentStep) throw new GherkinParseError(`Line ${lineNo}: "the response field..." has no preceding request step in this Scenario.`);
      const [, fieldPath, valueRaw] = fieldMatch;
      currentStep.expectBody = { ...(currentStep.expectBody ?? {}), [fieldPath]: parseJsonValue(valueRaw.trim(), `expected value on line ${lineNo}`) };
      continue;
    }

    const captureMatch = CAPTURE_PATTERN.exec(stepText);
    if (captureMatch) {
      if (!currentStep) throw new GherkinParseError(`Line ${lineNo}: "I capture..." has no preceding request step in this Scenario.`);
      const [, dotPath, localName] = captureMatch;
      currentStep.capture = { ...(currentStep.capture ?? {}), [localName]: dotPath };
      continue;
    }

    throw new GherkinParseError(
      `Line ${lineNo}: unrecognized step text: "${stepText}". Supported step vocabulary:\n` +
        `  I <GET|POST|PUT|PATCH|DELETE> "<path>" [with body <json>] [and call it "<name>"]\n` +
        `  the response status should be <code>\n` +
        `  the response field "<dot.path>" should be <json-value>\n` +
        `  I capture "<dot.path>" as "<localName>"`
    );
  }

  if (scenarios.length === 0) {
    throw new GherkinParseError('No "Scenario:" found in this feature file.');
  }
  for (const scenario of scenarios) {
    if (scenario.steps.length === 0) {
      throw new GherkinParseError(`Scenario "${scenario.name}" has no request steps (no "I GET/POST/... " lines).`);
    }
  }

  return { featureName, scenarios };
}
