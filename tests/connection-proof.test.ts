import { describe, expect, test } from "bun:test";
import {
  createConnectedAccountProof,
  verifyConnectedAccountProof,
  matchesOAuthBrowser,
  oauthCookieName,
} from "../src/lib/earnings/connection-proof.server";

const secret = "test-only-mock-signing-key-never-production";
const owner = "11111111-1111-4111-8111-111111111111",
  account = "acct_test";
describe("server-signed Stripe OAuth ownership", () => {
  test("valid proof verifies while account/owner/key swaps and tampering fail", async () => {
    const proof = await createConnectedAccountProof(owner, account, secret);
    expect(await verifyConnectedAccountProof(owner, account, proof, secret)).toBe(true);
    for (const [o, a, p, s] of [
      ["attacker", account, proof, secret],
      [owner, "acct_victim", proof, secret],
      [owner, account, proof, `${secret}-rotated`],
      [owner, account, `${proof.slice(0, -1)}${proof.endsWith("0") ? "1" : "0"}`, secret],
      [owner, account, "connected", secret],
      [owner, account, "connected:v1:" + "0".repeat(64), secret],
    ])
      expect(await verifyConnectedAccountProof(o!, a!, p!, s!)).toBe(false);
    expect(proof).not.toContain(secret);
  });
  test("same account cannot reuse another user's proof, including100 deterministic forgeries", async () => {
    const proof = await createConnectedAccountProof(owner, account, secret);
    for (let i = 0; i < 100; i++) {
      expect(await verifyConnectedAccountProof(`attacker-${i}`, account, proof, secret)).toBe(
        false,
      );
      expect(await verifyConnectedAccountProof(owner, `acct_other${i}`, proof, secret)).toBe(false);
    }
  });
  test("malformed identities/proofs and absent configuration fail closed", async () => {
    for (const proof of [
      null,
      undefined,
      "connected",
      "",
      "connected:v1:" + "x".repeat(64),
      "connected:v2:" + "a".repeat(64),
    ])
      expect(await verifyConnectedAccountProof(owner, account, proof, secret)).toBe(false);
    await expect(createConnectedAccountProof(owner, account, "")).rejects.toThrow();
    const proof = await createConnectedAccountProof(owner, account, secret);
    expect(await verifyConnectedAccountProof(owner, account, proof, "")).toBe(false);
    expect(await verifyConnectedAccountProof("other\nowner", account, proof, secret)).toBe(false);
  });
  test("authorization URL alone cannot satisfy initiating-browser cookie binding", () => {
    const state = "a".repeat(32),
      cookie = `${oauthCookieName(true)}=${state}`;
    expect(matchesOAuthBrowser(cookie, state, true)).toBe(true);
    expect(matchesOAuthBrowser(`unrelated=1; ${cookie}`, state, true)).toBe(true);
    for (const value of [
      null,
      "",
      `${oauthCookieName(true)}=${"b".repeat(32)}`,
      `${cookie}; ${cookie}`,
      `prefix-${cookie}`,
      `${oauthCookieName(false)}=${state}`,
    ])
      expect(matchesOAuthBrowser(value, state, true)).toBe(false);
    expect(matchesOAuthBrowser(`${oauthCookieName(false)}=${state}`, state, false)).toBe(true);
    expect(matchesOAuthBrowser(cookie, "connected:acct_other", true)).toBe(false);
  });
});
