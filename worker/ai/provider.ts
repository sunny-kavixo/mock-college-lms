export type AssignmentQuestionType = "MULTIPLE_CHOICE" | "TEXT";

export interface AssignmentQuestion {
  id: string;
  type: AssignmentQuestionType;
  prompt: string;
  options: string[];
}

export type AssignmentAnswers = Record<string, string>;

export interface AIAnswerProvider {
  readonly name: string;
  answerQuestions(
    questions: AssignmentQuestion[]
  ): Promise<AssignmentAnswers>;
}

function validateAnswers(
  questions: AssignmentQuestion[],
  answers: unknown
): AssignmentAnswers {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    throw new Error("AI provider returned an invalid answer object");
  }
  const supplied = answers as Record<string, unknown>;
  const validated: AssignmentAnswers = {};
  for (const question of questions) {
    const answer = Object.hasOwn(supplied, question.id) ? supplied[question.id] : undefined;

    if (typeof answer !== "string" || answer.trim() === "") {
      throw new Error(`AI provider did not answer question ${question.id}`);
    }

    if (
      question.type === "MULTIPLE_CHOICE" &&
      !question.options.includes(answer)
    ) {
      throw new Error(`AI provider returned an invalid option for ${question.id}`);
    }
    validated[question.id] = answer.trim();
  }

  return validated;
}

class DeterministicDevAnswerProvider implements AIAnswerProvider {
  readonly name = "deterministic-dev";

  async answerQuestions(
    questions: AssignmentQuestion[]
  ): Promise<AssignmentAnswers> {
    const answers: AssignmentAnswers = {};

    for (const question of questions) {
      if (question.type === "MULTIPLE_CHOICE") {
        const firstOption = question.options[0];

        if (!firstOption) {
          throw new Error(`Question ${question.id} has no options`);
        }

        answers[question.id] = firstOption;
        continue;
      }

      const prompt = question.prompt.toLowerCase();

      if (prompt.includes("scarcity")) {
        answers[question.id] =
          "Scarcity means limited resources are available to satisfy unlimited wants.";
      } else if (prompt.includes("trade-off")) {
        answers[question.id] =
          "Choosing study time over a social activity is a trade-off because one option is given up.";
      } else if (prompt.includes("track costs")) {
        answers[question.id] =
          "Businesses track costs to understand spending and measure profitability.";
      } else if (prompt.includes("cash flow")) {
        answers[question.id] =
          "Cash flow shows whether a business can cover its short-term obligations.";
      } else if (prompt.includes("validate data")) {
        answers[question.id] =
          "Validation catches inaccurate or inconsistent inputs before they affect conclusions.";
      } else if (prompt.includes("analysis workflow")) {
        answers[question.id] =
          "A simple workflow defines a question, cleans data, analyzes patterns, and communicates findings.";
      } else if (prompt.includes("evaluate model")) {
        answers[question.id] =
          "Evaluation checks whether outputs are accurate, useful, and safe for the intended context.";
      } else if (prompt.includes("responsible ai")) {
        answers[question.id] =
          "Teams should consider privacy, fairness, transparency, and human oversight when using AI.";
      } else {
        answers[question.id] =
          "This answer explains the key concept using the course material.";
      }
    }

    return validateAnswers(questions, answers);
  }
}

class OpenAICompatibleAnswerProvider implements AIAnswerProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly model: string;

  constructor(apiKey: string, endpoint: string, model: string) {
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.model = model;
    this.name = `openai-compatible:${model}`;
  }

  async answerQuestions(
    questions: AssignmentQuestion[]
  ): Promise<AssignmentAnswers> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Answer every assignment question. Return only a JSON object mapping question IDs to answer strings."
          },
          {
            role: "user",
            content: JSON.stringify(questions)
          }
        ]
      }),
      signal: AbortSignal.timeout(60_000)
    });

    if (!response.ok) {
      throw new Error(`AI provider request failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string | null };
      }>;
    };
    const content = payload.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("AI provider returned an empty response");
    }

    const normalized = content
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/```$/, "")
      .trim();

    let answers: AssignmentAnswers;

    try {
      answers = JSON.parse(normalized) as AssignmentAnswers;
    } catch {
      throw new Error("AI provider returned invalid JSON");
    }

    return validateAnswers(questions, answers);
  }
}

export function createAIAnswerProvider(
  env: NodeJS.ProcessEnv = process.env
): AIAnswerProvider {
  const apiKey = env.OPENAI_API_KEY?.trim() || env.AI_API_KEY?.trim();

  if (!apiKey) {
    return new DeterministicDevAnswerProvider();
  }

  return new OpenAICompatibleAnswerProvider(
    apiKey,
    env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions",
    env.OPENAI_MODEL || "gpt-4o-mini"
  );
}
