/** Domain memory. Not model chat history. Never stores original pixels. */

export type AssistantMemory = {
  photographerId: string;
  user: {
    workRole: string;
    concise: boolean;
  };
  editing: {
    temperatureBias: number;
    coolSkin: boolean;
    richBlacks: boolean;
    neverOverSmoothSkin: boolean;
    confidence: number;
  };
  sports: {
    peakAction: number;
    keepStoryFrames: boolean;
    rejectNoBall: boolean;
  };
  notes: string[];
};

export const ASSISTANT_MEMORY_PREFIX = "celinen.assistant-memory.v1.";

export function defaultAssistantMemory(photographerId: string, workRole = "sports"): AssistantMemory {
  return {
    photographerId,
    user: { workRole, concise: true },
    editing: {
      temperatureBias: 0,
      coolSkin: false,
      richBlacks: true,
      neverOverSmoothSkin: true,
      confidence: 0.2,
    },
    sports: { peakAction: 0.97, keepStoryFrames: true, rejectNoBall: true },
    notes: [],
  };
}

export function memoryKey(photographerId: string) {
  return `${ASSISTANT_MEMORY_PREFIX}${photographerId}`;
}

export function loadAssistantMemory(photographerId: string, workRole = "sports"): AssistantMemory {
  const fallback = defaultAssistantMemory(photographerId, workRole);
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = JSON.parse(localStorage.getItem(memoryKey(photographerId)) || "null");
    if (!raw || typeof raw !== "object") return fallback;
    return {
      ...fallback,
      ...raw,
      photographerId,
      user: { ...fallback.user, ...(raw.user ?? {}), workRole: raw.user?.workRole || workRole },
      editing: { ...fallback.editing, ...(raw.editing ?? {}) },
      sports: { ...fallback.sports, ...(raw.sports ?? {}) },
      notes: Array.isArray(raw.notes) ? raw.notes.slice(-24) : [],
    };
  } catch {
    return fallback;
  }
}

export function saveAssistantMemory(memory: AssistantMemory) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(memoryKey(memory.photographerId), JSON.stringify(memory));
  } catch {
    /* quota */
  }
}

export function recordTemperatureCorrection(memory: AssistantMemory, deltaKelvin: number): AssistantMemory {
  const next = {
    ...memory,
    editing: {
      ...memory.editing,
      temperatureBias: memory.editing.temperatureBias * 0.7 + deltaKelvin * 0.3,
      coolSkin: deltaKelvin < -80 || memory.editing.coolSkin,
      confidence: Math.min(0.95, memory.editing.confidence + 0.08),
    },
    notes:
      deltaKelvin < -80
        ? [...memory.notes, "Does not like excessive orange skin tones."].slice(-24)
        : memory.notes,
  };
  saveAssistantMemory(next);
  return next;
}

export function formatMemoryForPrompt(memory: AssistantMemory): string {
  const lines = [
    `USER MEMORY workRole=${memory.user.workRole}; concise=${memory.user.concise ? "yes" : "no"}`,
    `EDITING MEMORY temperatureBias=${memory.editing.temperatureBias.toFixed(0)}K; coolSkin=${memory.editing.coolSkin}; richBlacks=${memory.editing.richBlacks}; neverOverSmoothSkin=${memory.editing.neverOverSmoothSkin}; confidence=${memory.editing.confidence.toFixed(2)}`,
    `SPORTS MEMORY peakAction=${memory.sports.peakAction}; keepStoryFrames=${memory.sports.keepStoryFrames}; rejectNoBall=${memory.sports.rejectNoBall}`,
  ];
  if (memory.notes.length) lines.push(`NOTES ${memory.notes.slice(-6).join(" | ")}`);
  return lines.join("\n");
}
