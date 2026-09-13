import { useEffect, useRef, useState } from "react";
import type { DevelopSettings } from "@/lib/develop/contract";
import type { DevelopPreset } from "@/lib/develop/store";
import {
  createPresetPackage,
  developPresetFromPackage,
  exportPresetPackage,
  parsePresetPackage,
  presetPackageFilename,
  PRESET_PACKAGE_MAX_BYTES,
  reviewLightroomPreset,
} from "@/lib/develop/preset-package";

export function PresetExchange({
  recipe,
  presets,
  save,
  close,
}: {
  recipe: DevelopSettings;
  presets: DevelopPreset[];
  save: (preset: DevelopPreset) => Promise<void>;
  close: () => void;
}) {
  const [settings, setSettings] = useState(recipe),
    [title, setTitle] = useState(""),
    [creator, setCreator] = useState(""),
    [description, setDescription] = useState(""),
    [license, setLicense] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [choice, setChoice] = useState("current");
  const [imported, setImported] = useState<DevelopPreset | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [acceptedTranslation, setAcceptedTranslation] = useState(false);
  const importedWarnings = useRef<string[]>([]);
  const load = (preset: DevelopPreset) => {
    setSettings(preset.settings);
    setTitle(preset.name);
    setCreator(preset.packageMetadata?.creator ?? "");
    setDescription(preset.packageMetadata?.description ?? "");
    setLicense(preset.packageMetadata?.license ?? "");
    setError("");
    setNotice("");
  };
  const packageValue = () =>
    createPresetPackage({ title, creator, description, license }, settings);
  return (
    <div className="develop-preset-exchange">
      <p>
        Import a Celinen preset or review a Lightroom XMP tone translation. Originals stay
        untouched.
      </p>
      <fieldset disabled={busy}>
        <label>
          Starting look
          <select
            aria-label="Preset to package"
            value={choice}
            onChange={(e) => {
              setChoice(e.target.value);
              setWarnings(e.target.value === "imported" ? importedWarnings.current : []);
              setAcceptedTranslation(false);
              const preset =
                e.target.value === "imported"
                  ? imported
                  : presets.find((p) => p.id === e.target.value);
              if (preset) load(preset);
              else {
                setSettings(recipe);
                setTitle("");
                setCreator("");
                setDescription("");
                setLicense("");
                setError("");
                setNotice("");
              }
            }}
          >
            <option value="current">Current photo’s look</option>
            {imported && <option value="imported">Imported file: {imported.name}</option>}
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Preset title
          <input
            aria-label="Preset title"
            maxLength={100}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Creator
          <input
            aria-label="Preset creator"
            maxLength={160}
            value={creator}
            onChange={(e) => setCreator(e.target.value)}
          />
        </label>
        <label>
          Description
          <textarea
            aria-label="Preset description"
            maxLength={4000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label>
          License / usage terms
          <textarea
            aria-label="Preset license"
            maxLength={4000}
            value={license}
            onChange={(e) => setLicense(e.target.value)}
          />
        </label>
        <input
          ref={picker}
          type="file"
          accept=".json,.xmp,application/json,application/rdf+xml"
          aria-label="Import preset file"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setError("");
            setBusy(true);
            try {
              if (file.size > PRESET_PACKAGE_MAX_BYTES)
                throw new Error("Choose a preset smaller than 256 KB.");
              const text = await file.text();
              const translation = /\.xmp$/i.test(file.name)
                ? reviewLightroomPreset(text, file.name)
                : null;
              const pkg = translation?.package ?? parsePresetPackage(text);
              if (!alive.current) return;
              setWarnings(translation?.warnings ?? []);
              importedWarnings.current = translation?.warnings ?? [];
              setAcceptedTranslation(false);
              const preset = developPresetFromPackage(pkg);
              setImported(preset);
              setChoice("imported");
              load(preset);
              setNotice(
                translation
                  ? "Review the translation limits before saving. Keep your original XMP file."
                  : "Preset loaded for review. Save to add it to your library.",
              );
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Preset import failed.");
            } finally {
              setBusy(false);
            }
          }}
        />
      </fieldset>
      <p className="develop-hint">
        Export for your own store or share directly. Marketplace checkout and automatic sales are
        not connected.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {warnings.length > 0 && (
        <div>
          <ul>
            {warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
          <label>
            <input
              type="checkbox"
              checked={acceptedTranslation}
              onChange={(event) => setAcceptedTranslation(event.target.checked)}
            />{" "}
            Save only this approximate tone translation
          </label>
        </div>
      )}
      <div className="develop-dialog-actions">
        <button disabled={busy} onClick={() => picker.current?.click()}>
          Import file
        </button>
        <button
          disabled={busy || !title.trim() || (warnings.length > 0 && !acceptedTranslation)}
          onClick={() => {
            try {
              const pkg = packageValue(),
                url = URL.createObjectURL(
                  new Blob([exportPresetPackage(pkg)], { type: "application/json" }),
                );
              const link = document.createElement("a");
              link.href = url;
              link.download = presetPackageFilename(pkg.metadata.title);
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 30000);
              setError("");
              setNotice("Preset file exported. Nothing was published.");
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Export failed.");
            }
          }}
        >
          Export preset
        </button>
        <button
          disabled={busy || !title.trim() || (warnings.length > 0 && !acceptedTranslation)}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await save(developPresetFromPackage(packageValue()));
              setNotice("Preset saved to your library.");
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Save failed.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Save to library"}
        </button>
        <button disabled={busy} onClick={close}>
          Done
        </button>
      </div>
    </div>
  );
}
