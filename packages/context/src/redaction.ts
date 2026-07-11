export interface RedactionResult {
  readonly text: string;
  readonly ruleIds: readonly string[];
  readonly count: number;
}

interface RedactionRule {
  readonly id: string;
  readonly pattern: RegExp;
}

const RULES: readonly RedactionRule[] = [
  {
    id: "private-key",
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gu,
  },
  {
    id: "github-token",
    pattern:
      /\b(?:gh[opurs]_[A-Za-z0-9_]{20,255}|github_pat_[A-Za-z0-9_]{20,255})\b/gu,
  },
  {
    id: "openai-key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,255}\b/gu,
  },
  {
    id: "aws-access-key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,
  },
  {
    id: "credential-assignment",
    pattern:
      /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[^\s,"']{8,}/giu,
  },
];

export function redactSecrets(value: string): RedactionResult {
  let text = value;
  const ruleIds: string[] = [];
  let count = 0;

  for (const rule of RULES) {
    let ruleCount = 0;
    text = text.replace(rule.pattern, () => {
      ruleCount += 1;
      return `[REDACTED:${rule.id}]`;
    });
    if (ruleCount > 0) {
      ruleIds.push(rule.id);
      count += ruleCount;
    }
  }
  return { text, ruleIds, count };
}
