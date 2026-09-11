/** Keep saved preferences portable: fall back without replacing an unavailable voice ID. */
export function findSpeechVoice<T extends { voiceURI: string }>(voices: T[], uri: string) {
  return uri ? (voices.find((voice) => voice.voiceURI === uri) ?? null) : null;
}
