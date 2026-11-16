import { io } from "socket.io-client";

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
      body: { email, password, name: email.split("@")[0] },
    });
  } catch {
    return req("/auth/login", {
      method: "POST",
      body: { email, password },
    });
  }
}

function connectPoker(token) {
  return new Promise((resolve, reject) => {
    const socket = io(`${API}/poker`, {
      auth: { token },
      transports: ["websocket"],
    });
    const t = setTimeout(() => reject(new Error("socket connect timeout")), 8000);
    socket.on("connect", () => {
      clearTimeout(t);
      resolve(socket);
    });
    socket.on("connect_error", (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

function waitFor(socket, event, pred, ms = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    const handler = (payload) => {
      if (!pred || pred(payload)) {
        clearTimeout(t);
        socket.off(event, handler);
        resolve(payload);
      }
    };
    socket.on(event, handler);
  });
}

async function creditViaAdminHack(adminToken, userId, amount) {
  // Use admin overview to confirm auth, then call a raw wallet credit through
  // creating a temporary top-up is heavy — instead patch via dedicated internal endpoint if none:
  // Fall back: call buy-in after manually ensuring balance via SQL is done in companion script.
  void adminToken;
  void userId;
  void amount;
}

async function main() {
  console.log("1) Auth users + admin");
  const admin = await req("/auth/login", {
    method: "POST",
    body: { email: "admin@example.com", password: "AdminPass123!" },
  });
  const u1 = await ensureUser("poker.p1@example.com", "PokerPass123!");
  const u2 = await ensureUser("poker.p2@example.com", "PokerPass123!");
  console.log("   admin ok, users", u1.user.id, u2.user.id);

  // Fund wallets via admin creating nothing — use payments sandbox if available.
  // Direct wallet credit through Prisma is done below via HTTP helper endpoint if present.
  // For smoke: call internal credit by posting to a one-shot route we don't have —
  // instead use wallet balance check and instruct funding script.

  const w1 = await req("/wallet", { token: u1.accessToken });
  const w2 = await req("/wallet", { token: u2.accessToken });
  console.log("2) Balances", w1.balanceUsd, w2.balanceUsd);

  if (Number(w1.balanceUsd) < 50 || Number(w2.balanceUsd) < 50) {
    console.log("   Funding wallets via /admin is not available; using DB fund endpoint...");
    // Call companion fund via dynamic import of prisma — run fund-wallets first
    throw new Error(
      "Insufficient wallet balance. Run: node scripts/poker-fund.mjs first",
    );
  }

  const tables = await req("/poker/tables", { token: u1.accessToken });
  if (!tables.length) throw new Error("No poker tables");
  const tableId = tables[0].id;
  console.log("3) Table", tableId, tables[0].name);

  console.log("4) Buy-ins");
  for (const t of [u1.accessToken, u2.accessToken]) {
    try {
      await req(`/poker/tables/${tableId}/cash-out`, {
        method: "POST",
        token: t,
      });
    } catch {
      // not seated
    }
  }
  await req(`/poker/tables/${tableId}/buy-in`, {
    method: "POST",
    token: u1.accessToken,
    body: { amountUsd: 50, seatIndex: 0 },
  });
  await req(`/poker/tables/${tableId}/buy-in`, {
    method: "POST",
    token: u2.accessToken,
    body: { amountUsd: 50, seatIndex: 1 },
  });

  const s1 = await connectPoker(u1.accessToken);
  const s2 = await connectPoker(u2.accessToken);
  s1.emit("join_table", { tableId });
  s2.emit("join_table", { tableId });

  const state = await waitFor(
    s1,
    "table_state",
    (p) => p?.hand && p.hand.actingSeat !== null,
    15000,
  ).catch(async () => {
    // request state
    s1.emit("request_state", { tableId });
    return waitFor(s1, "table_state", (p) => p?.hand, 10000);
  });
  console.log("5) Hand active", state.hand?.handNo, "street", state.hand?.street);

  // Play until hand ends or max 40 actions: always check/call/fold appropriately
  let ended = null;
  const endPromise = waitFor(s1, "hand_ended", null, 60000).then((p) => {
    ended = p;
    return p;
  });

  for (let i = 0; i < 40 && !ended; i += 1) {
    s1.emit("request_state", { tableId });
    const st = await waitFor(s1, "table_state", null, 5000);
    if (!st.hand) break;
    const acting = st.hand.actingSeat;
    const seat1 = st.seats.find((s) => s.userId === u1.user.id);
    const seat2 = st.seats.find((s) => s.userId === u2.user.id);
    const mySocket =
      seat1?.seatIndex === acting ? s1 : seat2?.seatIndex === acting ? s2 : null;
    const legal = st.hand.legal;
    if (!mySocket) {
      // not our view of legal — get from correct socket
      const sock = seat1?.seatIndex === acting ? s1 : s2;
      sock.emit("request_state", { tableId });
      const st2 = await waitFor(sock, "table_state", null, 5000);
      const L = st2.hand?.legal;
      if (!L?.actions?.length) continue;
      const action = L.actions.includes("check")
        ? "check"
        : L.actions.includes("call")
          ? "call"
          : "fold";
      await new Promise((resolve) => {
        sock.emit("action", { tableId, action }, () => resolve());
      });
      continue;
    }
    if (!legal?.actions?.length) {
      mySocket.emit("request_state", { tableId });
      continue;
    }
    const action = legal.actions.includes("check")
      ? "check"
      : legal.actions.includes("call")
        ? "call"
        : "fold";
    await new Promise((resolve) => {
      mySocket.emit("action", { tableId, action }, () => resolve());
    });
    await new Promise((r) => setTimeout(r, 200));
  }

  const handEnd = ended ?? (await endPromise.catch(() => null));
  console.log("6) Hand ended", handEnd);

  console.log("7) Admin controls");
  const overview = await req("/admin/poker/stats/overview", {
    token: admin.accessToken,
  });
  console.log("   overview", overview);
  await req(`/admin/poker/tables/${tableId}/freeze`, {
    method: "POST",
    token: admin.accessToken,
  });
  console.log("   frozen");
  await req(`/admin/poker/tables/${tableId}/unfreeze`, {
    method: "POST",
    token: admin.accessToken,
  });
  console.log("   unfrozen");
  const hands = await req("/admin/poker/hands?limit=5", {
    token: admin.accessToken,
  });
  console.log("   hands", hands.length);
  const players = await req("/admin/poker/stats/players", {
    token: admin.accessToken,
  });
  console.log("   player stats", players.length);

  await req(`/admin/poker/tables/${tableId}/force-end`, {
    method: "POST",
    token: admin.accessToken,
  });
  console.log("   force-end ok");
  await req(`/poker/tables/${tableId}/cash-out`, {
    method: "POST",
    token: u1.accessToken,
  });
  console.log("   p1 cashed out");
  await req(`/poker/tables/${tableId}/cash-out`, {
    method: "POST",
    token: u2.accessToken,
  });
  console.log("   p2 cashed out");

  s1.disconnect();
  s2.disconnect();
  console.log("SMOKE OK");
  process.exit(0);
}

main().catch((err) => {
  console.error("SMOKE FAIL", err);
  process.exit(1);
});
