/** Scripted landing examples. No network. Photography work only. */

export type DemoCheck = { label: string; detail: string };

export type DemoMessage = {
  role: "assistant" | "user";
  text: string;
  checks?: readonly DemoCheck[];
  /** User line is a button until clicked, then it becomes a sent bubble. */
  wait?: boolean;
};

export type DemoSession = {
  id: string;
  name: string;
  preview: string;
  time: string;
  accent: string;
  messages: readonly DemoMessage[];
};

export const LANDING_DEMO: readonly DemoSession[] = [
  {
    id: "wedding",
    name: "Saturday wedding",
    preview: "48 keepers. sneak peek is out.",
    time: "Yesterday",
    accent: "#7d9b8a",
    messages: [
      {
        role: "assistant",
        checks: [
          { label: "Cull", detail: "48 keepers from 1,412 · 12 blinks set aside" },
          { label: "Develop", detail: "your last wedding look on the keepers" },
        ],
        text: "two things need you: the family formal, and the sneak peek.",
      },
      { role: "user", text: "send the sneak peek", wait: true },
      {
        role: "assistant",
        checks: [
          { label: "Gallery", detail: "12 frames, passcode on" },
          { label: "Mail", detail: "sent to Maya and Jordan" },
        ],
        text: "sneak peek is out. family formal is still unmarked.",
      },
      { role: "user", text: "keep the family formal", wait: true },
      {
        role: "assistant",
        checks: [{ label: "Keepers", detail: "family formal in the set" }],
        text: "family formal is in. you're clear until they pick favorites.",
      },
    ],
  },
  {
    id: "lights",
    name: "Friday lights",
    preview: "look saved on 22 keepers.",
    time: "2:11 AM",
    accent: "#c4a574",
    messages: [
      {
        role: "assistant",
        checks: [{ label: "Cull", detail: "22 keepers from 380 · open eyes first" }],
        text: "want the tungsten look from last week, or leave them as-shot?",
      },
      { role: "user", text: "tungsten look", wait: true },
      {
        role: "assistant",
        checks: [{ label: "Develop", detail: "Friday tungsten saved on 22" }],
        text: "look is on the keepers. originals are untouched.",
      },
    ],
  },
  {
    id: "varsity",
    name: "Varsity game",
    preview: "jersey 12 is in 31 frames.",
    time: "Yesterday",
    accent: "#6a8cbe",
    messages: [
      {
        role: "assistant",
        checks: [
          { label: "Cull", detail: "64 keepers from 2,208" },
          { label: "Roster", detail: "jersey 12 tagged in 31 frames" },
        ],
        text: "need a gallery for the school, or just #12's parents?",
      },
      { role: "user", text: "school gallery", wait: true },
      {
        role: "assistant",
        checks: [{ label: "Gallery", detail: "64 keepers, roster on" }],
        text: "school link is ready. #12's frames are filterable.",
      },
    ],
  },
  {
    id: "gallery",
    name: "Maya's gallery",
    preview: "8 favorites. download is on.",
    time: "Yesterday",
    accent: "#b57a8c",
    messages: [
      {
        role: "assistant",
        checks: [{ label: "Gallery", detail: "Maya favoured 8 of 48" }],
        text: "she asked for downloads. turn them on?",
      },
      { role: "user", text: "turn downloads on", wait: true },
      {
        role: "assistant",
        checks: [{ label: "Downloads", detail: "favorites only" }],
        text: "she can take the 8. the rest stay in the gallery.",
      },
    ],
  },
  {
    id: "social",
    name: "Saturday stories",
    preview: "three frames queued.",
    time: "Yesterday",
    accent: "#8a7bb8",
    messages: [
      {
        role: "assistant",
        checks: [{ label: "Pick", detail: "3 verticals from the sneak peek" }],
        text: "post now, or hold for tonight?",
      },
      { role: "user", text: "post now", wait: true },
      {
        role: "assistant",
        checks: [{ label: "Social", detail: "Instagram + Facebook, three frames" }],
        text: "they're queued. stories first, then the feed.",
      },
    ],
  },
  {
    id: "studio",
    name: "Studio portraits",
    preview: "9 keepers. look matched.",
    time: "Yesterday",
    accent: "#6e8f7a",
    messages: [
      {
        role: "assistant",
        checks: [{ label: "Cull", detail: "9 keepers from 120" }],
        text: "match last month's studio look?",
      },
      { role: "user", text: "match it", wait: true },
      {
        role: "assistant",
        checks: [{ label: "Develop", detail: "studio look on 9" }],
        text: "matched. ready to send when you are.",
      },
    ],
  },
];

export function landingDemoById(id: string): DemoSession {
  return LANDING_DEMO.find((session) => session.id === id) ?? LANDING_DEMO[0]!;
}

/** How far autoplay can go before a wait line. */
export function landingDemoPauseAt(session: DemoSession): number {
  const wait = session.messages.findIndex((message) => message.wait);
  return wait === -1 ? session.messages.length : wait;
}
