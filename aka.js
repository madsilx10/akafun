const fs = require("fs");
const https = require("https");
const readline = require("readline");
const { Wallet } = require("ethers");

// ── CONFIG ──────────────────────────────────────────────────────────────────
const REF_CODE = "EV3MWC2M";
const TARGET_FOLLOW = "akadotfun";
const TARGET_RT_URL =
  "https://x.com/akadotfun/status/2095565826321526791?s=20";
const TWEET_ID = "2095565826321526791";

const BASE_AKA = "testnet.aka.fun";
const BASE_X_API = "api.x.com";

const ACCOUNTS_FILE = "akun.txt";
const WALLETS_FILE = "wallet.txt";

// ── UTILS ────────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(tag, msg, color = "\x1b[0m") {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`\x1b[90m[${ts}]\x1b[0m ${color}[${tag}]\x1b[0m ${msg}`);
}
const ok = (t, m) => log(t, m, "\x1b[32m");
const err = (t, m) => log(t, m, "\x1b[31m");
const info = (t, m) => log(t, m, "\x1b[36m");
const warn = (t, m) => log(t, m, "\x1b[33m");

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── PARSE INPUT FILES ────────────────────────────────────────────────────────
function parseAccounts() {
  const lines = fs
    .readFileSync(ACCOUNTS_FILE, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const accounts = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    accounts.push({ authToken: lines[i], ct0: lines[i + 1] });
  }
  return accounts;
}

function parseWallets() {
  const lines = fs
    .readFileSync(WALLETS_FILE, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const wallets = [];
  for (const privkey of lines) {
    const pk = privkey.startsWith("0x") ? privkey : `0x${privkey}`;
    const w = new Wallet(pk);
    wallets.push({ privkey: pk, address: w.address });
  }
  return wallets;
}

// ── TWITTER API ──────────────────────────────────────────────────────────────
function xHeaders(authToken, ct0) {
  return {
    authorization:
      "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
    cookie: `auth_token=${authToken}; ct0=${ct0}`,
    "x-csrf-token": ct0,
    "content-type": "application/json",
    "user-agent":
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    "x-twitter-active-user": "yes",
    "x-twitter-client-language": "id",
    origin: "https://x.com",
    referer: "https://x.com/",
  };
}

async function checkFollowing(authToken, ct0, username) {
  // get own user id first
  const meRes = await request({
    hostname: BASE_X_API,
    path: "/2/users/me",
    method: "GET",
    headers: { ...xHeaders(authToken, ct0), "content-type": "application/json" },
  });
  if (!meRes.body?.data?.id) return { following: false, userId: null };
  const userId = meRes.body.data.id;

  const res = await request({
    hostname: BASE_X_API,
    path: `/1.1/friendships/show.json?source_id=${userId}&target_screen_name=${username}`,
    method: "GET",
    headers: xHeaders(authToken, ct0),
  });
  const following = res.body?.relationship?.source?.following === true;
  return { following, userId };
}

async function followUser(authToken, ct0, username) {
  const body = JSON.stringify({ screen_name: username, skip_status: true });
  const res = await request(
    {
      hostname: BASE_X_API,
      path: "/1.1/friendships/create.json",
      method: "POST",
      headers: {
        ...xHeaders(authToken, ct0),
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(`screen_name=${username}&skip_status=true`),
      },
    },
    `screen_name=${username}&skip_status=true`
  );
  return res.status === 200;
}

async function checkRetweeted(authToken, ct0, tweetId) {
  const res = await request({
    hostname: BASE_X_API,
    path: `/1.1/statuses/show.json?id=${tweetId}&include_my_retweet=1`,
    method: "GET",
    headers: xHeaders(authToken, ct0),
  });
  return !!res.body?.current_user_retweet;
}

async function retweet(authToken, ct0, tweetId) {
  const body = `id=${tweetId}`;
  const res = await request(
    {
      hostname: BASE_X_API,
      path: `/1.1/statuses/retweet/${tweetId}.json`,
      method: "POST",
      headers: {
        ...xHeaders(authToken, ct0),
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(body),
      },
    },
    body
  );
  return res.status === 200;
}

// ── AKA.FUN OAUTH FLOW ───────────────────────────────────────────────────────
async function getXToken(authToken, ct0, walletAddress) {
  info("OAUTH", `Starting X OAuth for ${walletAddress.slice(0, 10)}...`);

  // Step 1: start
  const startRes = await request({
    hostname: BASE_AKA,
    path: `/api/whitelist/x/start/?wallet=${walletAddress}&origin=https%3A%2F%2Faka.fun`,
    method: "GET",
    headers: {
      accept: "*/*",
      origin: "https://aka.fun",
      referer: "https://aka.fun/",
      "user-agent":
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    },
  });

  // extract redirect location → x.com authorize URL
  const xAuthUrl = startRes.headers?.location || startRes.body;
  if (!xAuthUrl || !xAuthUrl.includes("oauth2/authorize")) {
    err("OAUTH", `No redirect URL. Response: ${JSON.stringify(startRes.body)}`);
    return null;
  }

  const urlObj = new URL(xAuthUrl);
  const state = urlObj.searchParams.get("state");
  const codeChallenge = urlObj.searchParams.get("code_challenge");
  const clientId = urlObj.searchParams.get("client_id");
  const redirectUri = urlObj.searchParams.get("redirect_uri");

  // Step 2: Twitter authorize page (GET)
  await request({
    hostname: "x.com",
    path: `/i/oauth2/authorize?${urlObj.searchParams.toString()}`,
    method: "GET",
    headers: {
      ...xHeaders(authToken, ct0),
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "cross-site",
    },
  });

  // Step 3: POST approve
  const approveBody = new URLSearchParams({
    approval: "true",
    code: codeChallenge,
    consent_flow: "web_consent",
  }).toString();

  const approveRes = await request(
    {
      hostname: BASE_X_API,
      path: "/2/oauth2/authorize",
      method: "POST",
      headers: {
        ...xHeaders(authToken, ct0),
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(approveBody),
      },
    },
    approveBody
  );

  const code = approveRes.body?.redirect_uri
    ? new URL(approveRes.body.redirect_uri).searchParams.get("code")
    : null;

  if (!code) {
    // try direct redirect_uri field
    err("OAUTH", `No code from approve. Body: ${JSON.stringify(approveRes.body)}`);
    return null;
  }

  // Step 4: callback
  const callbackRes = await request({
    hostname: BASE_AKA,
    path: `/api/whitelist/x/callback/?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`,
    method: "GET",
    headers: {
      accept: "*/*",
      origin: "https://aka.fun",
      referer: "https://x.com/",
      "user-agent":
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    },
  });

  // xToken is in Location header after 303
  const location = callbackRes.headers?.location;
  if (!location) {
    err("OAUTH", `No location from callback. Body: ${JSON.stringify(callbackRes.body)}`);
    return null;
  }

  const locUrl = new URL(location.startsWith("http") ? location : `https://aka.fun${location}`);
  const xToken = locUrl.searchParams.get("x");
  if (!xToken) {
    err("OAUTH", `No xToken in location: ${location}`);
    return null;
  }

  ok("OAUTH", `xToken obtained`);
  return xToken;
}

// ── CHECK WHITELIST STATUS ───────────────────────────────────────────────────
async function checkWhitelist(walletAddress) {
  const res = await request({
    hostname: BASE_AKA,
    path: `/api/whitelist/?q=${walletAddress}`,
    method: "GET",
    headers: {
      accept: "*/*",
      origin: "https://aka.fun",
      referer: "https://aka.fun/",
      "user-agent":
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    },
  });
  return res.body?.data;
}

// ── SUBMIT WHITELIST ─────────────────────────────────────────────────────────
async function submitWhitelist(walletAddress, xToken) {
  const payload = JSON.stringify({
    wallet: walletAddress,
    ref: REF_CODE,
    xToken,
  });

  const res = await request(
    {
      hostname: BASE_AKA,
      path: "/api/whitelist/",
      method: "POST",
      headers: {
        accept: "*/*",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        origin: "https://aka.fun",
        referer: "https://aka.fun/",
        "user-agent":
          "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      },
    },
    payload
  );
  return { status: res.status, data: res.body?.data };
}

// ── PROCESS ONE ACCOUNT ──────────────────────────────────────────────────────
async function processAccount(account, wallet, idx) {
  const label = `ACC#${idx + 1}`;
  const addr = wallet.address;

  info(label, `Wallet: ${addr}`);

  // 1. cek whitelist
  const wlStatus = await checkWhitelist(addr);
  if (wlStatus?.registered) {
    warn(label, `Already registered as @${wlStatus.x}. Skip.`);
    return { status: "already_registered", wallet: addr, x: wlStatus.x };
  }

  // 2. cek & follow
  const { following } = await checkFollowing(account.authToken, account.ct0, TARGET_FOLLOW);
  if (following) {
    warn(label, `Already following @${TARGET_FOLLOW}`);
  } else {
    const followed = await followUser(account.authToken, account.ct0, TARGET_FOLLOW);
    if (followed) ok(label, `Followed @${TARGET_FOLLOW}`);
    else err(label, `Failed to follow @${TARGET_FOLLOW}`);
    await sleep(2000);
  }

  // 3. cek & retweet
  const alreadyRt = await checkRetweeted(account.authToken, account.ct0, TWEET_ID);
  if (alreadyRt) {
    warn(label, `Already retweeted`);
  } else {
    const rted = await retweet(account.authToken, account.ct0, TWEET_ID);
    if (rted) ok(label, `Retweeted`);
    else err(label, `Failed to retweet`);
    await sleep(2000);
  }

  // 4. OAuth → xToken
  const xToken = await getXToken(account.authToken, account.ct0, addr);
  if (!xToken) {
    err(label, `Failed to get xToken. Skipping submit.`);
    return { status: "failed_xtoken", wallet: addr };
  }

  // 5. submit whitelist
  const result = await submitWhitelist(addr, xToken);
  if (result.status === 201) {
    ok(label, `✅ Whitelist submitted! X: @${result.data?.x}`);
    return { status: "success", wallet: addr, x: result.data?.x };
  } else {
    err(label, `Submit failed. Status: ${result.status}`);
    return { status: "failed_submit", wallet: addr };
  }
}

// ── MENU ─────────────────────────────────────────────────────────────────────
async function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(question, (a) => { rl.close(); r(a.trim()); }));
}

async function main() {
  console.log("\x1b[35m");
  console.log("╔══════════════════════════════════════╗");
  console.log("║      AKA.FUN WHITELIST FARMER        ║");
  console.log("║      ref: EV3MWC2M                   ║");
  console.log("╚══════════════════════════════════════╝");
  console.log("\x1b[0m");

  const accounts = parseAccounts();
  const wallets = parseWallets();

  info("INIT", `Loaded ${accounts.length} accounts, ${wallets.length} wallets`);

  if (accounts.length !== wallets.length) {
    warn("INIT", `Account count (${accounts.length}) != wallet count (${wallets.length}). Will pair by index.`);
  }

  const total = Math.min(accounts.length, wallets.length);

  console.log("\n\x1b[33mPilih mode:\x1b[0m");
  console.log("  1. 1 akun (pilih index)");
  console.log("  2. Semua akun");
  console.log("  3. From X to end (mulai dari index tertentu)\n");

  const mode = await prompt("Pilihan (1/2/3): ");

  let targets = [];

  if (mode === "1") {
    const idx = parseInt(await prompt(`Index akun (1-${total}): `)) - 1;
    if (isNaN(idx) || idx < 0 || idx >= total) {
      err("MAIN", "Index invalid"); process.exit(1);
    }
    targets = [idx];
  } else if (mode === "2") {
    targets = Array.from({ length: total }, (_, i) => i);
  } else if (mode === "3") {
    const from = parseInt(await prompt(`Mulai dari index (1-${total}): `)) - 1;
    if (isNaN(from) || from < 0 || from >= total) {
      err("MAIN", "Index invalid"); process.exit(1);
    }
    targets = Array.from({ length: total - from }, (_, i) => i + from);
  } else {
    err("MAIN", "Pilihan invalid"); process.exit(1);
  }

  console.log(`\n\x1b[36mProcessing ${targets.length} account(s)...\x1b[0m\n`);

  const results = [];
  for (const idx of targets) {
    console.log(`\x1b[90m${"─".repeat(50)}\x1b[0m`);
    const result = await processAccount(accounts[idx], wallets[idx], idx);
    results.push(result);
    if (targets.length > 1) await sleep(3000);
  }

  // summary
  console.log(`\n\x1b[35m${"═".repeat(50)}\x1b[0m`);
  console.log("\x1b[35m SUMMARY \x1b[0m");
  const success = results.filter((r) => r.status === "success").length;
  const already = results.filter((r) => r.status === "already_registered").length;
  const failed = results.filter((r) => r.status.startsWith("failed")).length;
  ok("DONE", `Success: ${success}`);
  warn("DONE", `Already registered: ${already}`);
  err("DONE", `Failed: ${failed}`);

  // save log
  fs.writeFileSync("aka_result.json", JSON.stringify(results, null, 2));
  info("DONE", "Results saved to aka_result.json");
}

main().catch((e) => { err("FATAL", e.message); process.exit(1); });
