const fs = require("fs");
const https = require("https");
const readline = require("readline");
const { Wallet } = require("ethers");

// ── CONFIG ───────────────────────────────────────────────────────────────────
const REF_CODE    = "EV3MWC2M";
const FOLLOW_USER = "akadotfun";
const TWEET_ID    = "2095565826321526791";
const BASE_AKA    = "testnet.aka.fun";
const BASE_X_API  = "api.x.com";
const ACCOUNTS_FILE = "akun.txt";
const WALLETS_FILE  = "wallet.txt";

// ── UTILS ────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(tag, msg, color = "\x1b[0m") {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`\x1b[90m[${ts}]\x1b[0m ${color}[${tag}]\x1b[0m ${msg}`);
}
const ok   = (t, m) => log(t, m, "\x1b[32m");
const err  = (t, m) => log(t, m, "\x1b[31m");
const info = (t, m) => log(t, m, "\x1b[36m");
const warn = (t, m) => log(t, m, "\x1b[33m");

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const enc = res.headers["content-encoding"] || "";
        const decompress = (b) => {
          if (enc.includes("br")) return require("zlib").brotliDecompressSync(b);
          if (enc.includes("gzip")) return require("zlib").gunzipSync(b);
          if (enc.includes("deflate")) return require("zlib").inflateSync(b);
          return b;
        };
        let text;
        try { text = decompress(buf).toString("utf8"); } catch { text = buf.toString("utf8"); }
        try {
          resolve({ status: res.statusCode, body: JSON.parse(text), headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, body: text, headers: res.headers });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── PARSE FILES ──────────────────────────────────────────────────────────────
function parseAccounts() {
  const lines = fs.readFileSync(ACCOUNTS_FILE, "utf8")
    .split("\n").map((l) => l.trim()).filter(Boolean);
  const accounts = [];
  for (let i = 0; i + 1 < lines.length; i += 2)
    accounts.push({ authToken: lines[i], ct0: lines[i + 1] });
  return accounts;
}

function parseWallets() {
  const lines = fs.readFileSync(WALLETS_FILE, "utf8")
    .split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.map((pk) => {
    const key = pk.startsWith("0x") ? pk : `0x${pk}`;
    return { privkey: key, address: new Wallet(key).address };
  });
}

// ── TWITTER HEADERS ──────────────────────────────────────────────────────────
function xHeaders(authToken, ct0, extra = {}) {
  return {
    authorization: "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
    cookie: `auth_token=${authToken}; ct0=${ct0}`,
    "x-csrf-token": ct0,
    "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    "x-twitter-active-user": "yes",
    "x-twitter-client-language": "id",
    origin: "https://x.com",
    referer: "https://x.com/",
    ...extra,
  };
}

// ── TWITTER: FOLLOW ──────────────────────────────────────────────────────────
async function checkFollowing(authToken, ct0) {
  const res = await request({
    hostname: BASE_X_API,
    path: `/1.1/friendships/show.json?source_screen_name=me&target_screen_name=${FOLLOW_USER}`,
    method: "GET",
    headers: xHeaders(authToken, ct0),
  });
  return res.body?.relationship?.source?.following === true;
}

async function followUser(authToken, ct0) {
  const body = `screen_name=${FOLLOW_USER}&skip_status=true`;
  const res = await request({
    hostname: BASE_X_API,
    path: "/1.1/friendships/create.json",
    method: "POST",
    headers: xHeaders(authToken, ct0, {
      "content-type": "application/x-www-form-urlencoded",
      "content-length": Buffer.byteLength(body),
    }),
  }, body);
  return res.status === 200;
}

// ── TWITTER: RETWEET ─────────────────────────────────────────────────────────
async function checkRetweeted(authToken, ct0) {
  const res = await request({
    hostname: BASE_X_API,
    path: `/1.1/statuses/show.json?id=${TWEET_ID}&include_my_retweet=1`,
    method: "GET",
    headers: xHeaders(authToken, ct0),
  });
  return !!res.body?.current_user_retweet;
}

async function retweet(authToken, ct0) {
  const body = JSON.stringify({ variables: { tweet_id: TWEET_ID }, queryId: "ojPdsZsimiJrUGLR1sjUtA" });
  const res = await request({
    hostname: BASE_X_API,
    path: "/graphql/ojPdsZsimiJrUGLR1sjUtA/CreateRetweet",
    method: "POST",
    headers: xHeaders(authToken, ct0, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    }),
  }, body);
  info("RT", `status=${res.status} body=${JSON.stringify(res.body).slice(0,200)}`);
  return res.status === 200;
}

// ── AKA.FUN OAUTH ────────────────────────────────────────────────────────────
async function getXToken(authToken, ct0, walletAddress) {
  info("OAUTH", `Starting for ${walletAddress.slice(0, 10)}...`);

  // Step 1: hit start → dapat redirect ke twitter
  const startRes = await request({
    hostname: BASE_AKA,
    path: `/api/whitelist/x/start/?wallet=${walletAddress}&origin=https%3A%2F%2Faka.fun`,
    method: "GET",
    headers: {
      accept: "*/*",
      origin: "https://aka.fun",
      referer: "https://aka.fun/",
      "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    },
  });

  info("OAUTH", `Start status: ${startRes.status}, location: ${startRes.headers?.location || JSON.stringify(startRes.body).slice(0,100)}`);
  const xAuthUrl = startRes.headers?.location;
  if (!xAuthUrl || !xAuthUrl.includes("oauth2/authorize")) {
    err("OAUTH", `No redirect. Body: ${JSON.stringify(startRes.body)}`);
    return null;
  }

  const urlObj   = new URL(xAuthUrl);
  const state    = urlObj.searchParams.get("state");

  // Step 2: GET authorize via Twitter internal API → return JSON dengan auth_code
  const getRes = await request({
    hostname: "x.com",
    path: `/i/api/2/oauth2/authorize?${urlObj.searchParams.toString()}`,
    method: "GET",
    headers: {
      ...xHeaders(authToken, ct0),
      accept: "application/json",
      "x-csrf-token": ct0,
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
    },
  });

  info("OAUTH", `GET authorize API: status=${getRes.status} body=${JSON.stringify(getRes.body).slice(0,300)}`);

  // auth_code ada di response JSON
  const authCode = getRes.body?.auth_code;

  if (!authCode) {
    err("OAUTH", `No auth_code. Body: ${JSON.stringify(getRes.body).slice(0, 400)}`);
    return null;
  }

  info("OAUTH", `auth_code OK: ${authCode.slice(0, 20)}...`);

  // Step 3: POST approve dengan auth_code
  const approveBody = new URLSearchParams({
    approval: "true",
    code: authCode,
    consent_flow: "web_consent",
  }).toString();

  info("OAUTH", `POST approve...`);
  const approveRes = await request({
    hostname: BASE_X_API,
    path: "/2/oauth2/authorize",
    method: "POST",
    headers: xHeaders(authToken, ct0, {
      "content-type": "application/x-www-form-urlencoded",
      "content-length": Buffer.byteLength(approveBody),
    }),
  }, approveBody);

  info("OAUTH", `POST approve: status=${approveRes.status} body=${JSON.stringify(approveRes.body).slice(0,300)}`);
  const redirectUri = approveRes.body?.redirect_uri;
  if (!redirectUri) {
    err("OAUTH", `No redirect_uri. Body: ${JSON.stringify(approveRes.body)}`);
    return null;
  }

  const oauthCode = new URL(redirectUri).searchParams.get("code");
  if (!oauthCode) {
    err("OAUTH", `No code in redirect_uri: ${redirectUri}`);
    return null;
  }

  // Step 4: callback → dapat xToken dari Location header
  const cbRes = await request({
    hostname: BASE_AKA,
    path: `/api/whitelist/x/callback/?state=${encodeURIComponent(state)}&code=${encodeURIComponent(oauthCode)}`,
    method: "GET",
    headers: {
      accept: "*/*",
      origin: "https://aka.fun",
      referer: "https://x.com/",
      "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    },
  });

  const location = cbRes.headers?.location;
  if (!location) {
    err("OAUTH", `No location from callback. Body: ${JSON.stringify(cbRes.body)}`);
    return null;
  }

  const locUrl = new URL(location.startsWith("http") ? location : `https://aka.fun${location}`);
  // xToken bisa di hash fragment (#x=...) atau query param
  const hashParams = new URLSearchParams(locUrl.hash.replace("#", ""));
  const xToken = locUrl.searchParams.get("x") || hashParams.get("x");
  if (!xToken) {
    err("OAUTH", `No xToken in: ${location}`);
    return null;
  }

  ok("OAUTH", `xToken OK`);
  return xToken;
}

// ── AKA.FUN: CEK & SUBMIT ────────────────────────────────────────────────────
async function checkWhitelist(addr) {
  const res = await request({
    hostname: BASE_AKA,
    path: `/api/whitelist/?q=${addr}`,
    method: "GET",
    headers: {
      accept: "*/*",
      origin: "https://aka.fun",
      referer: "https://aka.fun/",
      "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    },
  });
  return res.body?.data;
}

async function submitWhitelist(addr, xToken) {
  const payload = JSON.stringify({ wallet: addr, ref: REF_CODE, xToken });
  const res = await request({
    hostname: BASE_AKA,
    path: "/api/whitelist/",
    method: "POST",
    headers: {
      accept: "*/*",
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
      origin: "https://aka.fun",
      referer: "https://aka.fun/",
      "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    },
  }, payload);
  return { status: res.status, data: res.body?.data };
}

// ── PROCESS SATU AKUN ────────────────────────────────────────────────────────
async function processAccount(account, wallet, idx) {
  const label = `ACC#${idx + 1}`;
  const addr  = wallet.address;
  info(label, `Wallet: ${addr}`);

  // 1. cek whitelist
  const wl = await checkWhitelist(addr);
  if (wl?.registered) {
    warn(label, `Already registered (@${wl.x}). Skip.`);
    return { status: "already_registered", wallet: addr, x: wl.x };
  }

  // 2. konek X → dapat xToken
  const xToken = await getXToken(account.authToken, account.ct0, addr);
  if (!xToken) {
    err(label, `Failed xToken. Skip.`);
    return { status: "failed_xtoken", wallet: addr };
  }
  await sleep(1500);

  // 3. follow
  const alreadyFollow = await checkFollowing(account.authToken, account.ct0);
  if (alreadyFollow) {
    warn(label, `Already following @${FOLLOW_USER}`);
  } else {
    const followed = await followUser(account.authToken, account.ct0);
    ok(label, followed ? `Followed @${FOLLOW_USER}` : `Follow failed`);
    await sleep(2000);
  }

  // 4. retweet
  const alreadyRt = await checkRetweeted(account.authToken, account.ct0);
  if (alreadyRt) {
    warn(label, `Already retweeted`);
  } else {
    const rted = await retweet(account.authToken, account.ct0);
    ok(label, rted ? `Retweeted` : `RT failed`);
    await sleep(2000);
  }

  // 5. submit whitelist
  const result = await submitWhitelist(addr, xToken);
  if (result.status === 201) {
    ok(label, `✅ Done! X: @${result.data?.x}`);
    return { status: "success", wallet: addr, x: result.data?.x };
  } else {
    err(label, `Submit failed (${result.status}): ${JSON.stringify(result.data)}`);
    return { status: "failed_submit", wallet: addr };
  }
}

// ── MENU ─────────────────────────────────────────────────────────────────────
async function prompt(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(q, (a) => { rl.close(); r(a.trim()); }));
}

async function main() {
  console.log("\x1b[35m╔══════════════════════════════════════╗");
  console.log("║      AKA.FUN WHITELIST FARMER        ║");
  console.log("║      ref: EV3MWC2M                   ║");
  console.log("╚══════════════════════════════════════╝\x1b[0m\n");

  const accounts = parseAccounts();
  const wallets  = parseWallets();
  const total    = Math.min(accounts.length, wallets.length);
  info("INIT", `${accounts.length} akun, ${wallets.length} wallet → ${total} pair`);

  console.log("\n\x1b[33mMode:\x1b[0m");
  console.log("  1. 1 akun");
  console.log("  2. Semua");
  console.log("  3. From X to end\n");

  const mode = await prompt("Pilihan (1/2/3): ");
  let targets = [];

  if (mode === "1") {
    const idx = parseInt(await prompt(`Index (1-${total}): `)) - 1;
    if (isNaN(idx) || idx < 0 || idx >= total) { err("MAIN", "Index invalid"); process.exit(1); }
    targets = [idx];
  } else if (mode === "2") {
    targets = Array.from({ length: total }, (_, i) => i);
  } else if (mode === "3") {
    const from = parseInt(await prompt(`Dari index (1-${total}): `)) - 1;
    if (isNaN(from) || from < 0 || from >= total) { err("MAIN", "Index invalid"); process.exit(1); }
    targets = Array.from({ length: total - from }, (_, i) => i + from);
  } else {
    err("MAIN", "Pilihan invalid"); process.exit(1);
  }

  console.log(`\n\x1b[36mProcessing ${targets.length} akun...\x1b[0m\n`);

  const results = [];
  for (const idx of targets) {
    console.log(`\x1b[90m${"─".repeat(50)}\x1b[0m`);
    results.push(await processAccount(accounts[idx], wallets[idx], idx));
    if (targets.length > 1) await sleep(3000);
  }

  console.log(`\n\x1b[35m${"═".repeat(50)}\x1b[0m SUMMARY`);
  ok("DONE",  `Success          : ${results.filter((r) => r.status === "success").length}`);
  warn("DONE", `Already reg      : ${results.filter((r) => r.status === "already_registered").length}`);
  err("DONE",  `Failed           : ${results.filter((r) => r.status.startsWith("failed")).length}`);

  fs.writeFileSync("aka_result.json", JSON.stringify(results, null, 2));
  info("DONE", "Saved → aka_result.json");
}

main().catch((e) => { err("FATAL", e.message); process.exit(1); });
