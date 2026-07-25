import { Ajv, type ErrorObject } from "ajv";
import { configSchemaObject } from "./config-schema-object.js";
import { resolveConfig } from "./config.js";
import type { EcoFakerConfig } from "./types.js";

/**
 * Dateless convenience alias, not a pinned snapshot -- Anthropic resolves
 * it to the current model in that line. Overridable via `--model`/
 * `ECO_FAKER_MODEL` since model names change over time and this default
 * will inevitably go stale; see https://docs.claude.com/en/docs/about-claude/models/overview
 * for the current list before relying on it in production.
 */
export const DEFAULT_NL_MODEL = "claude-sonnet-4-5";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

function buildSystemPrompt(): string {
  return [
    "You translate a plain-English description of a desired synthetic e-commerce dataset into a JSON object of config overrides for the `eco-faker` data generator.",
    "",
    "Respond with ONLY a single JSON object -- no markdown code fences, no explanation, no surrounding text. The object must contain ONLY keys that appear in the schema below (additionalProperties is false), and only the keys actually implied by the request -- omit anything the request doesn't mention rather than guessing a value for every field.",
    "",
    "This is the exact JSON Schema (draft-07) every field must validate against:",
    "",
    JSON.stringify(configSchemaObject, null, 2),
  ].join("\n");
}

function buildInitialUserMessage(prompt: string): string {
  return `Description: ${prompt}\n\nReturn the JSON config overrides object now.`;
}

function stripCodeFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function tryParseJsonObject(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const cleaned = stripCodeFences(raw);
  let value: unknown;
  try {
    value = JSON.parse(cleaned);
  } catch (err) {
    return { ok: false, error: `response was not valid JSON (${(err as Error).message})` };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "response was valid JSON but not a JSON object" };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

let cachedRawValidate: ((data: unknown) => boolean) & { errors?: ErrorObject[] | null };
function getRawValidator() {
  if (!cachedRawValidate) {
    const ajv = new Ajv({ useDefaults: false, allErrors: true });
    cachedRawValidate = ajv.compile(configSchemaObject);
  }
  return cachedRawValidate;
}

/**
 * ajv's default `additionalProperties` message ("must NOT have additional
 * properties") doesn't say *which* property -- useless as feedback to hand
 * back to the model, which needs to know exactly what to remove or rename.
 * `error.params.additionalProperty` has the actual key; this formats a
 * message that includes it.
 */
function formatValidationErrors(errors: ErrorObject[]): string {
  return errors
    .map((e) => {
      const path = e.instancePath || "(root)";
      if (e.keyword === "additionalProperties") {
        return `  - ${path}: unrecognized property "${(e.params as { additionalProperty?: string }).additionalProperty}" -- not in the schema`;
      }
      return `  - ${path} ${e.message}`;
    })
    .join("\n");
}

/**
 * Runs the same validation `resolveConfig` applies to every dataset (for
 * the authoritative pass/fail), plus a direct, un-merged pass against the
 * raw overrides object for error *detail* -- `resolveConfig` merges over
 * `DEFAULT_CONFIG` first, which fills in every field ajv would otherwise
 * flag as missing, but a typo'd/unrecognized key the model invented
 * survives that merge and still needs to be named specifically in the
 * feedback the model gets.
 */
function validateOverrides(overrides: Record<string, unknown>): { valid: true } | { valid: false; error: string } {
  try {
    resolveConfig(overrides as Partial<EcoFakerConfig>);
    return { valid: true };
  } catch (err) {
    const validate = getRawValidator();
    const rawValid = validate(overrides);
    if (!rawValid && validate.errors) {
      return { valid: false, error: formatValidationErrors(validate.errors) };
    }
    return { valid: false, error: (err as Error).message };
  }
}

async function callMessagesApi(
  fetchImpl: typeof fetch,
  apiKey: string,
  model: string,
  messages: AnthropicMessage[]
): Promise<string> {
  const res = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: buildSystemPrompt(),
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`eco-faker: Anthropic API request failed: ${res.status} ${res.statusText}${body ? ` -- ${body}` : ""}`);
  }

  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (data.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("eco-faker: Anthropic API returned no text content to parse as config overrides.");
  }
  return text;
}

export interface NlGenerateOptions {
  prompt: string;
  /** Defaults to `process.env.ANTHROPIC_API_KEY`. */
  apiKey?: string;
  /** Defaults to `DEFAULT_NL_MODEL`, itself overridable via `ECO_FAKER_MODEL`. */
  model?: string;
  /** How many times to ask the model to fix an invalid response before giving up (default 1 -- i.e. up to 2 attempts total). */
  maxRetries?: number;
  /** Override fetch -- used by tests to avoid a real network call. */
  fetchImpl?: typeof fetch;
}

export interface NlGenerateResult {
  overrides: Partial<EcoFakerConfig>;
  /** The model's raw text response that `overrides` was parsed from, for transparency/debugging -- eco-faker never applies a config override the caller can't see the exact source of. */
  raw: string;
  /** How many API calls it took (1 if the first response validated). */
  attempts: number;
}

/**
 * Translates a plain-English dataset description into `Partial<EcoFakerConfig>`
 * overrides by asking Claude to fill in the real `config.schema.json` --
 * the same schema `resolveConfig` validates every dataset against, so
 * there's no separate, driftable copy of "what fields exist" for the model
 * to work from. Every candidate response is run through that exact
 * validator before being accepted; an invalid first attempt gets one
 * corrective follow-up turn (the real validation error, not a guess at
 * what might be wrong) before giving up, by default.
 */
export async function translatePromptToConfig(options: NlGenerateOptions): Promise<NlGenerateResult> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "eco-faker: --prompt requires an Anthropic API key. Set ANTHROPIC_API_KEY, or pass --api-key explicitly."
    );
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? process.env.ECO_FAKER_MODEL ?? DEFAULT_NL_MODEL;
  const maxRetries = options.maxRetries ?? 1;

  const messages: AnthropicMessage[] = [{ role: "user", content: buildInitialUserMessage(options.prompt) }];
  let lastRaw = "";
  let lastError = "";

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const raw = await callMessagesApi(fetchImpl, apiKey, model, messages);
    lastRaw = raw;
    messages.push({ role: "assistant", content: raw });

    const parsed = tryParseJsonObject(raw);
    if (parsed.ok) {
      const validation = validateOverrides(parsed.value);
      if (validation.valid) {
        return { overrides: parsed.value as Partial<EcoFakerConfig>, raw, attempts: attempt };
      }
      lastError = validation.error;
    } else {
      lastError = parsed.error;
    }

    if (attempt <= maxRetries) {
      messages.push({
        role: "user",
        content: `That response was invalid:\n${lastError}\n\nReturn corrected JSON only -- a single JSON object, no markdown fences, no explanation.`,
      });
    }
  }

  throw new Error(
    `eco-faker: model didn't produce a valid config overrides object after ${maxRetries + 1} attempt(s).\nLast error: ${lastError}\nLast raw response: ${lastRaw}`
  );
}
