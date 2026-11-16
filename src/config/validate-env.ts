/**
 * Fail fast on missing / weak secrets.
 * Production: JWT_SECRET must be at least 32 UTF-8 bytes (use ≥32 random bytes).
 */
export type EnvIssue = { key: string; message: string };

function isProduction(env: NodeJS.ProcessEnv): boolean {
  const n = (env.NODE_ENV ?? "").trim().toLowerCase();
  return n === "production" || n === "prod";
}

function isOxaSandbox(env: NodeJS.ProcessEnv): boolean {
  return ["1", "true", "yes", "on"].includes(
    (env.OXAPAY_SANDBOX ?? "true").trim().toLowerCase(),
  );
}

export function collectEnvIssues(
  env: NodeJS.ProcessEnv = process.env,
): EnvIssue[] {
  const issues: EnvIssue[] = [];
  const prod = isProduction(env);

  const jwt = (env.JWT_SECRET ?? "").trim();
  if (!jwt) {
    issues.push({
      key: "JWT_SECRET",
      message: "JWT_SECRET is required (no default)",
    });
  } else if (jwt === "dev-only-change-me") {
    issues.push({
      key: "JWT_SECRET",
      message:
        'JWT_SECRET must not be the insecure placeholder "dev-only-change-me"',
    });
  } else if (prod && Buffer.byteLength(jwt, "utf8") < 32) {
    issues.push({
      key: "JWT_SECRET",
      message:
        "JWT_SECRET must be at least 32 random bytes in production (utf8 length ≥ 32)",
    });
  } else if (!prod && Buffer.byteLength(jwt, "utf8") < 16) {
    issues.push({
      key: "JWT_SECRET",
      message:
        "JWT_SECRET is too short (minimum 16 characters outside production)",
    });
  }

  if (!(env.DATABASE_URL ?? "").trim()) {
    issues.push({
      key: "DATABASE_URL",
      message: "DATABASE_URL is required",
    });
  }

  if (prod && !isOxaSandbox(env)) {
    if (!(env.OXAPAY_MERCHANT_API_KEY ?? "").trim()) {
      issues.push({
        key: "OXAPAY_MERCHANT_API_KEY",
        message:
          "Required when NODE_ENV=production and OXAPAY_SANDBOX is false",
      });
    }
    if (!(env.OXAPAY_PAYOUT_API_KEY ?? "").trim()) {
      issues.push({
        key: "OXAPAY_PAYOUT_API_KEY",
        message:
          "Required when NODE_ENV=production and OXAPAY_SANDBOX is false",
      });
    }
  }

  return issues;
}

/** Throws if any required secret is missing or too weak. */
export function assertValidEnv(env: NodeJS.ProcessEnv = process.env): void {
  const issues = collectEnvIssues(env);
  if (issues.length === 0) return;
  const detail = issues.map((i) => `  - ${i.key}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${detail}`);
}
