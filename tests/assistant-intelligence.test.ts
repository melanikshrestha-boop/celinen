import { describe, expect, test } from "bun:test";
import { classifyAssistantIntent } from "../src/lib/assistant/intent";
import { retrievePhotographyKnowledge } from "../src/lib/assistant/knowledge";
import { explainPick, pickFrame, scoreFrame } from "../src/lib/assistant/taste";
import {
  defaultAssistantMemory,
  formatMemoryForPrompt,
  memoryFromOnboarding,
  recordTemperatureCorrection,
} from "../src/lib/assistant/memory";
import { assembleAssistantMessages } from "../src/lib/assistant/orchestrator";
import { retrieveCulture } from "../src/lib/assistant/culture";
import { fastTalk } from "../src/lib/assistant/talk";

describe("Lenslab intelligence", () => {
  test("greetings and lyrics hit the model, not a canned menu", () => {
    expect(fastTalk("hey gang")).toBeNull();
    expect(fastTalk("hi")).toBeNull();
    expect(fastTalk("lol")).toBeNull();
    expect(fastTalk("help me find some events")).toBeNull();
    expect(fastTalk("Plan a shoot")).toBeNull();
    expect(fastTalk("Olá, come with us")).toBeNull();
    expect(fastTalk("she said hola coma estas")).toBeNull();
  });
  test("routes knowledge, taste, action, diagnostic, and research", () => {
    expect(classifyAssistantIntent("What does HSS mean?")).toBe("knowledge");
    expect(classifyAssistantIntent("Which image do you like?")).toBe("creative");
    expect(classifyAssistantIntent("Remove the people behind the bride.")).toBe("action");
    expect(classifyAssistantIntent("Why are all my basketball photos soft?")).toBe("diagnostic");
    expect(classifyAssistantIntent("I dont got upcoming shoots help me find some events")).toBe(
      "research",
    );
  });

  test("retrieves helmet AF and shutter facts instead of vibes", () => {
    const af = retrievePhotographyKnowledge("Why is my R5 Mark II struggling to focus through the football helmet?");
    expect(af[0]?.id).toBe("helmet-af");
    const soft = retrievePhotographyKnowledge("Why are all my basketball photos soft?");
    expect(soft.some((doc) => doc.id === "sports-shutter")).toBe(true);
    expect(retrievePhotographyKnowledge("bounce the flash off the ceiling")[0]?.id).toBe(
      "bounce-flash",
    );
    expect(retrievePhotographyKnowledge("Rembrandt vs loop lighting")[0]?.id).toBe("portrait-light");
  });

  test("taste engine prefers peak action over a cleaner empty portrait", () => {
    const a = {
      peak_action: 0.97,
      expression: 0.94,
      subject_focus: 0.91,
      storytelling: 0.95,
      ball_visibility: 0.9,
      face_visibility: 0.88,
    };
    const b = {
      peak_action: 0.55,
      expression: 0.7,
      subject_focus: 0.98,
      storytelling: 0.4,
      ball_visibility: 0.1,
      face_visibility: 0.92,
    };
    expect(scoreFrame(a, "sports")).toBeGreaterThan(scoreFrame(b, "sports"));
    const pick = pickFrame(
      [
        { id: "4382", visual: a },
        { id: "4383", visual: b },
      ],
      "sports",
    );
    expect(pick?.winner.id).toBe("4382");
    expect(explainPick("4382", a, "4383", b)).toContain("I'd pick 4382");
  });

  test("onboarding taste becomes sports memory", () => {
    const memory = memoryFromOnboarding("84721", "college-football", {
      cull: "peak",
      skin: "natural",
    });
    expect(memory.user.workRole).toBe("college-football");
    expect(memory.sports.peakAction).toBe(0.98);
    expect(memory.editing.neverOverSmoothSkin).toBe(true);
    expect(memory.notes.some((note) => note.includes("peak action"))).toBe(true);
  });

  test("memory records a cooler skin bias", () => {
    const started = defaultAssistantMemory("84721", "sports");
    const next = recordTemperatureCorrection(started, -300);
    expect(next.editing.coolSkin).toBe(true);
    expect(next.editing.temperatureBias).toBeLessThan(0);
    expect(formatMemoryForPrompt(next)).toContain("orange skin");
  });

  test("orchestrator grounds a knowledge question and a live-event ask", async () => {
    const knowledge = await assembleAssistantMessages({
      messages: [{ role: "user", content: "What does HSS mean?" }],
      workRole: "sports",
      loadLive: async () => "",
    });
    expect(knowledge[0]?.content).toContain("You are Lenslab");
    expect(knowledge.some((row) => row.content.includes("High-speed sync") || row.content.includes("HSS"))).toBe(
      true,
    );
    expect(knowledge.some((row) => row.content.startsWith("INTENT knowledge"))).toBe(true);

    const research = await assembleAssistantMessages({
      messages: [{ role: "user", content: "help me find some events" }],
      workRole: "sports",
      loadLive: async () => "- 2026-09-19 — NCAA Division 1 Football — Texas Tech vs Houston — Jones AT&T Stadium",
    });
    expect(research.some((row) => row.content.includes("Texas Tech vs Houston"))).toBe(true);
    expect(research.some((row) => row.content.includes("Never invent a match"))).toBe(true);
  });

  test("she said hola / konichiwa is Kent Jones Don't Mind, not a culture lecture", async () => {
    expect(retrieveCulture("she said hola coma estas")[0]?.id).toBe("dont-mind");
    expect(retrieveCulture("she said conichiwa")[0]?.id).toBe("dont-mind");
    const assembled = await assembleAssistantMessages({
      messages: [{ role: "user", content: "finish this lyrics: she said comma estas" }],
      workRole: "sports",
      loadLive: async () => "",
    });
    expect(assembled.some((row) => row.content.includes("Don't Mind"))).toBe(true);
    expect(assembled.some((row) => row.content.includes("Konnichiwa"))).toBe(true);
  });
});
