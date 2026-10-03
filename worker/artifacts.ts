const sensitiveName = /password|secret|api[_-]?key|authorization|token|cookie/i;

export function configuredSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.entries(env)
    .filter(([name, value]) => sensitiveName.test(name) && value && value.length >= 4)
    .map(([, value]) => value!);
}

export function redactSecrets(text: string): string {
  for (const secret of [...configuredSecrets(), "demo123"] ) {
    text = text.split(secret).join("[REDACTED]");
  }
  return text.replace(/Bearer\s+[^\s"<>]+/gi, "[REDACTED]");
}

export function assertSafeEvidence(html: string): void {
  if (
    /(?:demo123|password|api[_-]?key|authorization|bearer|mockCollegeSession)/i.test(html) ||
    configuredSecrets().some((secret) => html.includes(secret))
  ) {
    throw new Error("Refusing to capture evidence containing credentials");
  }
}

export function safeError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : "Worker failed");
}
