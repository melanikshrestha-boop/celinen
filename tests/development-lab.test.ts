import { describe, expect, test } from "bun:test";
import {
  assertDevelopmentLab,
  labRequestAllowed,
  LAB_HOST,
  LAB_ORIGIN,
} from "../src/server/development-lab";

describe("separate local development workspace", () => {
  test("only the explicit serve/lab combination is allowed", () => {
    for (const command of ["serve", "build", "preview"])
      for (const mode of ["lab", "development", "production", "test"])
        if (command === "serve" && mode === "lab")
          expect(() => assertDevelopmentLab(command, mode)).not.toThrow();
        else expect(() => assertDevelopmentLab(command, mode)).toThrow();
  });
  const request = {
    address: "127.0.0.1",
    host: LAB_HOST,
    origin: LAB_ORIGIN,
    fetchSite: "same-origin",
  };
  test("accepts local navigation and same-origin fetch", () => {
    expect(labRequestAllowed(request)).toBe(true);
    expect(labRequestAllowed({ ...request, address: "::ffff:127.0.0.1" })).toBe(true);
    expect(labRequestAllowed({ address: request.address, host: LAB_HOST })).toBe(true);
  });
  test("rejects remote clients, rebinding, alternate ports and cross-origin requests", () => {
    for (const address of [undefined, "::1", "192.168.1.8", "8.8.8.8"])
      expect(labRequestAllowed({ ...request, address })).toBe(false);
    for (const host of [
      undefined,
      "localhost:8085",
      "127.0.0.1:8080",
      "lenslab.dev",
      "evil.example:8085",
    ])
      expect(labRequestAllowed({ ...request, host })).toBe(false);
    for (const origin of ["null", "https://evil.example", "http://localhost:8080"])
      expect(labRequestAllowed({ ...request, origin })).toBe(false);
    for (const fetchSite of ["cross-site", "same-site"])
      expect(labRequestAllowed({ ...request, fetchSite })).toBe(false);
  });
});
