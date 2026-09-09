/** Draft handoffs only. No provider sends, recipient guessing, or delivery claims. */
export function customerPhone(value: string) {
  const phone = value.trim().replace(/[ ()-]/g, "");
  if (!/^\+[1-9]\d{6,14}$/.test(phone))
    throw new Error("Include the country code, for example +1 415 555 0100.");
  return phone;
}

export function customerEmail(value: string) {
  const email = value.trim();
  const parts = email.split("@");
  const local = parts[0] ?? "";
  const labels = (parts[1] ?? "").split(".");
  // One unquoted ASCII mailbox. International domains may use their IDNA form.
  // Dot-atom punctuation is literal address data, never pre-encoded URI syntax.
  if (
    email.length > 254 ||
    parts.length !== 2 ||
    local.length > 64 ||
    !/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local) ||
    labels.length < 2 ||
    labels.some((label) => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))
  )
    throw new Error("Enter one valid customer email address.");
  return email;
}

function hasControlCharacters(text: string, multiline = false) {
  for (const character of text) {
    const point = character.charCodeAt(0);
    if (point === 127 || (point < 32 && !(multiline && [9, 10, 13].includes(point)))) return true;
  }
  return false;
}

function messageText(text: string) {
  if (!text.trim() || text.length > 12_000 || hasControlCharacters(text, true))
    throw new Error("This message cannot be shared. Review its text first.");
  return text;
}

export function customerSmsDraft(phone: string, text: string, apple = false) {
  const recipient = customerPhone(phone);
  const message = messageText(text);
  // Apple's documented sms: scheme only guarantees recipient handoff.
  // The UI copies the message first on Apple platforms, then opens Messages.
  return `sms:${recipient}${apple ? "" : `?body=${encodeURIComponent(message)}`}`;
}

export function customerEmailDraft(email: string, subject: string, text: string) {
  if (!subject.trim() || subject.length > 200 || hasControlCharacters(subject))
    throw new Error("Use a short, single-line message subject.");
  const [local, domain] = customerEmail(email).split("@");
  // RFC 6068 section 2: encode literal percent signs exactly once. Otherwise
  // an address containing %2C or %0A changes meaning in the recipient app.
  const recipient = `${encodeURIComponent(local!)}@${encodeURIComponent(domain!)}`;
  return `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(messageText(text))}`;
}
