import { describe, expect, it } from "vitest";

import { collectEnvIssues } from "./validate-env.ts";

function baseEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    JWT_SECRET: "abcdefghijklmnopqrstuvwxyz012345", // 32 chars
    DATABASE_URL: "postgres://localhost/test",
    NODE_ENV: "development",
    OXAPAY_SANDBOX: "true",
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe("assertValidEnv / collectEnvIssues", () => {
  it("accepts a strong secret in development", () => {
    expect(collectEnvIssues(baseEnv())).toEqual([]);
  });

  it("rejects missing JWT_SECRET", () => {
    const issues = collectEnvIssues(baseEnv({ JWT_SECRET: "" }));
    expect(issues.some((i) => i.key === "JWT_SECRET")).toBe(true);
  });

  it("rejects the old insecure placeholder", () => {
    const issues = collectEnvIssues(
      baseEnv({ JWT_SECRET: "dev-only-change-me" }),
    );
    expect(issues[0]?.key).toBe("JWT_SECRET");
  });

  it("rejects short JWT_SECRET in production", () => {
    const issues = collectEnvIssues(
      baseEnv({
        NODE_ENV: "production",
        JWT_SECRET: "only-24-characters-long!",
        OXAPAY_SANDBOX: "true",
      }),
    );
    expect(issues.some((i) => i.key === "JWT_SECRET")).toBe(true);
  });

  it("requires OxaPay keys in production when sandbox is off", () => {
    const issues = collectEnvIssues(
      baseEnv({
        NODE_ENV: "production",
        OXAPAY_SANDBOX: "false",
        OXAPAY_MERCHANT_API_KEY: "",
        OXAPAY_PAYOUT_API_KEY: "",
      }),
    );
    expect(issues.map((i) => i.key).sort()).toEqual([
      "OXAPAY_MERCHANT_API_KEY",
      "OXAPAY_PAYOUT_API_KEY",
    ]);
  });

  it("requires DATABASE_URL", () => {
    const issues = collectEnvIssues(baseEnv({ DATABASE_URL: "" }));
    expect(issues.some((i) => i.key === "DATABASE_URL")).toBe(true);
  });
});
