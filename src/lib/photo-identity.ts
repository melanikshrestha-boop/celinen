// Stored source paths allow 4,000 characters. Frame IDs also include size,
// timestamp and, for metadata collisions, a full-byte fingerprint suffix.
// Share this finite bound across project and delivery references. Never trim
// or re-key existing identities to fit a downstream schema.
export const PHOTO_ID_MAX_LENGTH = 4200;
