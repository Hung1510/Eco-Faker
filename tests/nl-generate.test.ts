import { describe, expect, it, vi } from "vitest";
import { translatePromptToConfig, DEFAULT_NL_MODEL } from "../src/nl-generate.js";

function fakeResponse(text: string) {
  return new Response(JSON.stringify({ content: [{ type: "text", text }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("translatePromptToConfig", () => {
  it("throws immediately, without calling fetch, when no API key is available", async () => {
    const fetchImpl = vi.fn();
    await expect(
      translatePromptToConfig({ prompt: "a big Black Friday dataset", apiKey: undefined, fetchImpl })
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("parses a valid first response and returns the exact overrides, in one attempt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse('{"scaleFactor": 500, "abandonmentRate": 0.5}'));
    const result = await translatePromptToConfig({ prompt: "500 users, high cart abandonment", apiKey: "sk-test", fetchImpl });
    expect(result.overrides).toEqual({ scaleFactor: 500, abandonmentRate: 0.5 });
    expect(result.attempts).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("strips markdown code fences before parsing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse('```json\n{"scaleFactor": 200}\n```'));
    const result = await translatePromptToConfig({ prompt: "200 users", apiKey: "sk-test", fetchImpl });
    expect(result.overrides).toEqual({ scaleFactor: 200 });
  });

  it("sends the real config schema and the prompt to the Anthropic Messages API with the right headers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse('{"scaleFactor": 50}'));
    await translatePromptToConfig({ prompt: "a small dataset", apiKey: "sk-test", fetchImpl, model: "claude-test-model" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "sk-test", "anthropic-version": "2023-06-01" }),
      })
    );
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe("claude-test-model");
    expect(body.system).toContain("scaleFactor");
    expect(body.messages[0].content).toContain("a small dataset");
  });

  it("retries once with the real validation error fed back, and succeeds on the corrected second attempt", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse('{"scaleFctor": 500}')) // typo'd key -- additionalProperties: false rejects it
      .mockResolvedValueOnce(fakeResponse('{"scaleFactor": 500}'));

    const result = await translatePromptToConfig({ prompt: "500 users", apiKey: "sk-test", fetchImpl });
    expect(result.overrides).toEqual({ scaleFactor: 500 });
    expect(result.attempts).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // the correction turn actually carried the real ajv error, not a canned message
    const secondCallBody = JSON.parse((fetchImpl.mock.calls[1][1] as RequestInit).body as string);
    const correctionMessage = secondCallBody.messages.at(-1).content as string;
    expect(correctionMessage).toContain("scaleFctor");
  });

  it("gives up after exhausting retries and reports the last real error", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => fakeResponse("not json at all"));
    await expect(
      translatePromptToConfig({ prompt: "500 users", apiKey: "sk-test", fetchImpl, maxRetries: 1 })
    ).rejects.toThrow(/not valid JSON/);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
  });

  it("surfaces a non-2xx API response as a clear error instead of parsing garbage", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("invalid x-api-key", { status: 401, statusText: "Unauthorized" })
    );
    await expect(
      translatePromptToConfig({ prompt: "500 users", apiKey: "sk-bad", fetchImpl, maxRetries: 0 })
    ).rejects.toThrow(/401/);
  });

  it("defaults to DEFAULT_NL_MODEL when no model is specified", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse('{"scaleFactor": 10}'));
    await translatePromptToConfig({ prompt: "10 users", apiKey: "sk-test", fetchImpl });
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe(DEFAULT_NL_MODEL);
  });
});
