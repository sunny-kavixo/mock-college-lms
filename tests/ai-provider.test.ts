import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createAIAnswerProvider, type AssignmentQuestion } from "../worker/ai/provider";

const questions: AssignmentQuestion[] = [
  { id: "choice", type: "MULTIPLE_CHOICE", prompt: "Choose one", options: ["first", "second"] },
  { id: "text", type: "TEXT", prompt: "Explain scarcity.", options: [] }
];
let requests: Array<{ authorization?: string; body: Record<string, unknown> }> = [];
let responseStatus = 200;
let responseContent = "";
let url: string;
const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  requests.push({ authorization: req.headers.authorization, body: JSON.parse(body) });
  res.writeHead(responseStatus, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ choices: [{ message: { content: responseContent } }] }));
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/chat/completions`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
beforeEach(() => {
  requests = [];
  responseStatus = 200;
  responseContent = JSON.stringify({ choice: "second", text: "A live-path answer." });
});

describe("AIAnswerProvider selection and HTTP contract", () => {
  test("no-key development answers are deterministic", async () => {
    const provider = createAIAnswerProvider({});
    expect(provider.name).toBe("deterministic-dev");
    const first = await provider.answerQuestions(questions);
    expect(await provider.answerQuestions(questions)).toEqual(first);
    expect(first).toEqual({ choice: "first", text: "Scarcity means limited resources are available to satisfy unlimited wants." });
    expect(requests).toHaveLength(0);
  });

  test.each(["OPENAI_API_KEY", "AI_API_KEY"])("%s selects the real HTTP provider and sends extracted questions", async (keyName) => {
    const provider = createAIAnswerProvider({ [keyName]: "synthetic-api-test-value", OPENAI_API_URL: url });
    expect(provider.name).toBe("openai-compatible:gpt-4o-mini");
    await expect(provider.answerQuestions(questions)).resolves.toEqual({ choice: "second", text: "A live-path answer." });
    expect(requests).toHaveLength(1);
    expect(requests[0].authorization).toBe("Bearer synthetic-api-test-value");
    const messages = requests[0].body.messages as Array<{ content: string }>;
    expect(JSON.parse(messages[1].content)).toEqual(questions);
  });

  test("whitespace in OPENAI_API_KEY does not mask a configured AI_API_KEY", () => {
    expect(createAIAnswerProvider({ OPENAI_API_KEY: "  ", AI_API_KEY: "test-value" }).name).toContain("openai-compatible");
  });

  test("API failure never falls back to the mock provider", async () => {
    responseStatus = 401;
    await expect(createAIAnswerProvider({ OPENAI_API_KEY: "test-value", OPENAI_API_URL: url })
      .answerQuestions(questions)).rejects.toThrow("HTTP 401");
    expect(requests).toHaveLength(1);
  });

  test.each(["not json", "null", "[]", "{}", '{"choice":"invalid","text":"answer"}'])(
    "malformed/incomplete AI output is rejected: %s", async (content) => {
      responseContent = content;
      await expect(createAIAnswerProvider({ OPENAI_API_KEY: "test-value", OPENAI_API_URL: url })
        .answerQuestions(questions)).rejects.toThrow();
    }
  );
});
