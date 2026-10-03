import type { AIAnswerProvider, AssignmentQuestion } from "../ai/provider";
import type { RunLedger } from "../ledger";
import { safeError } from "../artifacts";

export async function answerEligibleAssignment(params: {
  courseId: string;
  activityId: string;
  requiredRecordingId: string;
  eligibility: { eligible: boolean; reason: string };
  loadQuestions: () => Promise<AssignmentQuestion[]>;
  provider: AIAnswerProvider;
  ledger: RunLedger;
}) {
  const { courseId, activityId, requiredRecordingId, eligibility, provider, ledger } = params;
  const fields = { courseId, activityId, requiredRecordingId };
  const complete = ledger.records.some((entry) =>
    entry.event === "recording.completed" && entry.courseId === courseId &&
    entry.activityId === requiredRecordingId && entry.status === "SUCCESS" &&
    entry.serverReportedComplete === true
  );

  if (!eligibility.eligible || !complete) {
    ledger.append("assignment.blocked", "REFUSED", {
      ...fields,
      activityType: "ASSIGNMENT",
      reason: eligibility.eligible ? "SERVER_COMPLETION_NOT_OBSERVED" : eligibility.reason,
      providerCalled: false
    });
    throw new Error("Assignment refused: required recording is not server-confirmed complete");
  }

  ledger.append("assignment.started", "STARTED", {
    ...fields,
    activityType: "ASSIGNMENT",
    reason: "SERVER_ELIGIBLE",
    serverEligible: true,
    providerCalled: false
  });
  const questions = await params.loadQuestions();
  if (!questions.length || questions.some((question) => !question.id || !question.prompt)) {
    throw new Error("Assignment has no valid questions");
  }
  ledger.append("ai.answers.started", "STARTED", {
    ...fields,
    activityType: "ASSIGNMENT",
    provider: provider.name,
    questionCount: questions.length
  });

  try {
    const answers = await provider.answerQuestions(questions);
    ledger.append("ai.answers.completed", "SUCCESS", {
      ...fields,
      activityType: "ASSIGNMENT",
      provider: provider.name,
      questionCount: questions.length,
      reason: "ANSWERS_RECEIVED"
    });
    return answers;
  } catch (error) {
    ledger.append("ai.answers.completed", "FAILED", {
      ...fields,
      activityType: "ASSIGNMENT",
      provider: provider.name,
      reason: safeError(error)
    });
    throw error;
  }
}
