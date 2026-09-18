import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile, unlink, rmdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import {
  defaultDevelopSettings,
  developSettingsSchema,
  cloneDevelopSettings,
} from "../src/lib/develop/contract";
import { encodeDevelopRequest } from "../src/lib/develop/client";
import {
  developProtocol,
  parseDevelopRequest,
  runNativeDevelop,
  nativeDevelopPlugin,
} from "../src/server/native-develop";
import { jpegDimensions } from "../src/lib/delivery/media-integrity";
import { generatedBayerDng } from "./fixtures/generated-bayer";
import {
  developProcessingSource,
  currentDevelopExportProof,
} from "../src/components/develop/develop-state";

describe("Develop image contract", () => {
  test("defaults are independent, strict and byte-stable through serialization", () => {
    const first = defaultDevelopSettings(),
      second = defaultDevelopSettings();
    first.hsl[0]!.hue = 30;
    expect(second.hsl[0]!.hue).toBe(0);
    expect(cloneDevelopSettings(second)).toEqual(second);
    expect(developSettingsSchema.parse(JSON.parse(JSON.stringify(second)))).toEqual(second);
    expect(developProtocol(second).startsWith("FOTO_DEVELOP_3\n")).toBe(true);
  });
});
