# How to paste Adobe-style settings

This is a bounded, preview-first settings import, not a replacement for Adobe's RAW engine. Plain-text values or supported XMP can describe a starting look. They cannot guarantee matching Adobe pixels, profiles, masks or color management.

## What to paste

Paste one setting per line, optionally with a preset name:

```text
Preset: Evening match
Exposure +0.5
Contrast -10
Highlights -40
Shadows +20
Saturation -5
```

Values are **absolute targets**, not additional deltas. Only listed controls change. A paste creates a proposed recipe; choose its photo scope, inspect the supported values and warnings, then review/apply through the existing preview workflow. Pasting must never apply edits, change keeper decisions, or export files automatically.

Alternatively, paste one complete Camera Raw/Lightroom XMP document as text. Attribute and scalar element forms are supported, including alternate prefixes bound to Adobe's Camera Raw namespace. JSON, Lua-style records and opaque native clipboard payloads are not supported. Ordinary creative instructions such as “make these warmer” remain separate chat requests.

## Supported subset and limits

| Plain-text field | XMP field            | Local interpretation                                |
| ---------------- | -------------------- | --------------------------------------------------- |
| Exposure         | `crs:Exposure2012`   | −5…+5 EV mapped to the existing editor scale by ×20 |
| Contrast         | `crs:Contrast2012`   | −100…+100                                           |
| Highlights       | `crs:Highlights2012` | −100…+100                                           |
| Shadows          | `crs:Shadows2012`    | −100…+100                                           |
| Saturation       | `crs:Saturation`     | −100…+100                                           |

These are this application's mappings, not an Adobe rendering-equivalence claim. Older XMP `Exposure`, `Contrast` and `Shadows` fields are not silently treated as modern 2012 fields.

Temperature/Kelvin, tint and white balance are excluded: absolute camera white balance cannot safely become the editor's relative warmth value. Whites/blacks, profiles, masks, curves, crop/geometry, sharpening, noise reduction, other Adobe features and unknown Adobe fields are reported as unsupported. Nested mask/snapshot settings never become global adjustments. Ratings, picks and metadata are not imported. If every supplied setting is unsupported, the parser refuses instead of creating an empty successful plan.

Limits: 128,000 input characters, 4,000 XML elements and 32 open nesting levels. DTDs, entities (including encoded entities), CDATA, unsupported processing instructions, duplicate settings, ambiguous records, invalid numbers and out-of-range supported values are refused. Values are not silently clamped. Mixed prose/actions inside a settings block are refused rather than passed to chat command execution. Some otherwise valid XMP falls outside this deliberately conservative subset.

## Adobe portability: verified 2026-09-04

Adobe documents copying selected edit settings **between photos inside Lightroom Classic**. The reviewed documentation does not specify an interoperable browser text clipboard format; this implementation does not claim native Copy Settings always pastes usable text. [Adobe: Copy and paste edit settings](https://helpx.adobe.com/lightroom-classic/desktop/help/copy-paste-settings.html).

Camera Raw documents saving subsets as presets and exporting settings to XMP; it also distinguishes sidecar settings from settings embedded in some image formats. Preserve your original settings files. [Adobe: Manage Camera Raw settings](https://helpx.adobe.com/camera-raw/desktop/get-started/overview-and-setup/camera-raw-settings.html).

Lightroom Classic documents saving Develop metadata to XMP for Camera Raw/Bridge to read. This establishes Adobe-to-Adobe metadata transport, not third-party pixel parity. [Adobe: Advanced metadata actions](https://helpx.adobe.com/lightroom-classic/desktop/organize-photos-in-lightroom-classic/advanced-metadata-actions.html). Adobe's namespace reference identifies `http://ns.adobe.com/camera-raw-settings/1.0/`, Kelvin temperature and distinct profile/crop/curve fields. [Adobe: Camera Raw namespace](https://developer.adobe.com/xmp/docs/xmp-namespaces/crs/).

## Verification and troubleshooting

```sh
bun test tests/adobe-paste.test.ts
```

Tests cover mapping, omission warnings, namespace handling, nested-mask isolation, nonfinite values, malformed/oversized data and no command fallback. They are not an image-quality or real-Adobe clipboard benchmark. For an unsupported/native paste, copy the settings file's XML text or enter the five supported values above. For a refusal, correct the input; do not remove warnings or bypass validation.

Integration API: `parseAdobeSettingsPaste(text)` returns `null` for non-settings chat, `{ kind: "plan", format, name, summary, edits, warnings }`, or `{ kind: "refusal", reason, warnings }`. `AdobeSettingsPastePlan` is exported. A refusal must stop routing. The parser has no clipboard, photo mutation, file, network, export or authentication side effects.
