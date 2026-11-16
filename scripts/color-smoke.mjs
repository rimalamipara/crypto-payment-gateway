const API = process.env.API_URL ?? "http://localhost:3000";

async function req(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function ensureUser(email, password) {
  try {
    return await req("/auth/register", {
      method: "POST",
      body: { email, password, name: email },
    });
  } catch {
    return req("/auth/login", {
      method: "POST",
      body: { email, password },
    });
  }
}

async function main() {
  console.log("1) Auth");
  const admin = await req("/auth/login", {
    method: "POST",
    body: { email: "admin@example.com", password: "AdminPass123!" },
  });
  const u1 = await ensureUser("color.p1@example.com", "ColorPass123!");
  const u2 = await ensureUser("color.p2@example.com", "ColorPass123!");
  console.log("   users", u1.user.id, u2.user.id);

  const w1 = await req("/wallet", { token: u1.accessToken });
  const w2 = await req("/wallet", { token: u2.accessToken });
  if (Number(w1.balanceUsd) < 20 || Number(w2.balanceUsd) < 20) {
    throw new Error("Fund wallets first: npx tsx --env-file=.env scripts/color-fund.mjs");
  }
  console.log("2) Balances", w1.balanceUsd, w2.balanceUsd);

  const cur = await req("/color-game/current", { token: u1.accessToken });
  console.log("3) Current period", cur.periodNo, cur.status);

  console.log("4) Place bets");
  await req("/color-game/bets", {
    method: "POST",
    token: u1.accessToken,
    body: { betType: "color", selection: "red", amountUsd: 2 },
  });
  await req("/color-game/bets", {
    method: "POST",
    token: u2.accessToken,
    body: { betType: "number", selection: "7", amountUsd: 1 },
  });

  console.log("5) Admin preset 7");
  const preset = await req("/admin/color-game/preset", {
    method: "POST",
    token: admin.accessToken,
    body: { number: 7 },
  });
  console.log("  ", preset);

  console.log("6) Force reveal 7");
  const forced = await req("/admin/color-game/force-reveal", {
    method: "POST",
    token: admin.accessToken,
    body: { number: 7 },
  });
  console.log("  ", forced);

  const mine = await req("/color-game/bets/mine?limit=5", {
    token: u2.accessToken,
  });
  const win = mine.find((b) => b.selection === "7");
  console.log("7) P2 number bet", win?.status, "payout", win?.payoutUsd);

  const adminCur = await req("/admin/color-game/current", {
    token: admin.accessToken,
  });
  console.log("8) Next period", adminCur.round.periodNo, adminCur.round.status);

  const overview = await req("/admin/color-game/stats/overview", {
    token: admin.accessToken,
  });
  console.log("9) Overview", overview);

  if (win?.status !== "won") {
    throw new Error("Expected number 7 bet to win");
  }
  console.log("SMOKE OK");
}

main().catch((err) => {
  console.error("SMOKE FAIL", err);
  process.exit(1);
});
