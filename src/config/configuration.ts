export default () => ({
  port: parsePort(process.env.PORT),
  databaseUrl: process.env.DATABASE_URL ?? "",
  app: {
    baseUrl: process.env.APP_BASE_URL ?? "",
  },
  jwt: {
    // No insecure default — validate-env.ts refuses to boot without JWT_SECRET.
    secret: process.env.JWT_SECRET ?? "",
    expiresIn: process.env.JWT_EXPIRES_IN ?? "1d",
  },
  admin: {
    email: process.env.ADMIN_EMAIL ?? "",
    password: process.env.ADMIN_PASSWORD ?? "",
  },
  oxapay: {
    merchantApiKey: process.env.OXAPAY_MERCHANT_API_KEY ?? "",
    payoutApiKey: process.env.OXAPAY_PAYOUT_API_KEY ?? "",
    baseUrl: process.env.OXAPAY_BASE_URL ?? "https://api.oxapay.com/v1",
    sandbox: parseBool(process.env.OXAPAY_SANDBOX, true),
    defaultCurrency: "USD",
    callbackUrl: process.env.OXAPAY_CALLBACK_URL ?? "",
    payoutCallbackUrl: process.env.OXAPAY_PAYOUT_CALLBACK_URL ?? "",
  },
});


function parsePort(raw: string | undefined): number {
  const value = (raw ?? "").trim();
  const parsed = value.length > 0 ? Number(value) : Number.NaN;
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 65535) {
    return parsed;
  }
  return 3000;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}
