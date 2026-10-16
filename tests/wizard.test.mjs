import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { test } from "node:test";

// A data URL loads the generated ES module without changing package.json's type
// (the single-file download must also remain pasteable into the dashboard).
const source = await readFile(new URL("../dist/worker.js", import.meta.url), "utf8");
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const hostname = "setup.example.test";
const origin = `https://${hostname}`;
const ctx = { waitUntil() {} };

function request(path, body) {
  return new Request(origin + path, body === undefined ? undefined : {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

const success = (result) => Response.json({ success: true, result });

function mockCloudflare(t, domain) {
  const nativeFetch = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    assert.equal(url.hostname, "api.cloudflare.com");
    paths.push(url.pathname);
    if (url.pathname === "/client/v4/accounts") return success([{ id: "account-a" }]);
    if (url.pathname.endsWith("/workers/domains")) return success(domain ? [domain] : []);
    if (url.pathname.endsWith("/workers/subdomain")) return success({ subdomain: "example" });
    if (url.pathname.endsWith("/workers/scripts/arizo-owner/settings")) return success({ bindings: [] });
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
  t.after(() => { globalThis.fetch = nativeFetch; });
  return paths;
}

const verify = (url = origin) => new Request(url + "/api/setup/cloudflare/verify", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: url },
  body: JSON.stringify({ cfToken: "fake-test-token" }),
});

test("built Worker starts without bindings and serves wizard routes", async () => {
  assert.equal((await worker.fetch(request("/"), {}, ctx)).status, 302);
  const health = await worker.fetch(request("/health"), {}, ctx);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "ok");
  const page = await worker.fetch(request("/setup"), {}, ctx);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Setup Wizard/);
  assert.match(page.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
  const status = await worker.fetch(request("/api/setup/status"), {}, ctx);
  assert.equal((await status.json()).canUseToken, true);
});

test("generated release fingerprint matches its exact content", () => {
  const id = source.match(/const BUILD_ID = "([0-9a-f]{12})";/)?.[1];
  assert.ok(id);
  const zeroed = source.replace(`const BUILD_ID = "${id}";`, 'const BUILD_ID = "000000000000";');
  assert.equal(createHash("sha256").update(zeroed).digest("hex").slice(0, 12), id);
});

test("Custom Domain owner is verified using its exact production route", async (t) => {
  const paths = mockCloudflare(t, { hostname, service: "arizo-owner", environment: "production" });
  const response = await worker.fetch(verify(), {}, ctx);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).script, "arizo-owner");
  assert.ok(paths.some((p) => p.endsWith("/workers/scripts/arizo-owner/settings")));
});

test("a different hostname cannot prove ownership by reusing the script name", async (t) => {
  const paths = mockCloudflare(t, { hostname: "another.example.test", service: "arizo-owner", environment: "production" });
  assert.equal((await worker.fetch(verify(), {}, ctx)).status, 403);
  assert.ok(!paths.some((p) => p.endsWith("/settings")));
});

test("a non-production route cannot prove ownership", async (t) => {
  mockCloudflare(t, { hostname, service: "arizo-owner", environment: "staging" });
  assert.equal((await worker.fetch(verify(), {}, ctx)).status, 403);
});

test("workers.dev account ownership still works", async (t) => {
  mockCloudflare(t, null);
  const response = await worker.fetch(verify("https://arizo-owner.example.workers.dev"), {}, ctx);
  assert.equal(response.status, 200);
});

test("setup refuses unauthenticated and cross-origin writes", async () => {
  assert.equal((await worker.fetch(request("/api/setup/key/verify", {}), {}, ctx)).status, 401);
  const foreign = new Request(origin + "/api/setup/key/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://not-owner.example" },
    body: "{}",
  });
  assert.equal((await worker.fetch(foreign, {}, ctx)).status, 403);
});
