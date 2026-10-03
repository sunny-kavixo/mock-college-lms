import type { AIAnswerProvider, AssignmentQuestion } from "../ai/provider";
import type { RunLedger } from "../ledger";

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
      reason: eligibility.eligible ? "SERVER_COMPLETION_NOT_OBSERVED" : eligibility.reason,
      providerCalled: false
    });
    throw new Error("Assignment refused: required recording is not server-confirmed complete");
  }

  ledger.append("assignment.started", "STARTED", {
    ...fields,
    serverEligible: true,
    providerCalled: false
  });
  const questions = await params.loadQuestions();
  if (!questions.length || questions.some((question) => !question.id || !question.prompt)) {
    throw new Error("Assignment has no valid questions");
  }
  const answers = await provider.answerQuestions(questions);
  ledger.append("ai.answers.completed", "SUCCESS", {
    ...fields,
    provider: provider.name,
    questionCount: questions.length
  });
  return answers;
}
