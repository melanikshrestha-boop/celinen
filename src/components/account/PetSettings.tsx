import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import type { AccountPreferences } from "@/lib/account-preferences";
import { useToolLeaveGuard } from "@/components/workbench/useToolLeaveGuard";
import {
  SettingsRow as Row,
  SettingsGroup as Group,
  SettingsChoice as Choice,
} from "./SettingsPrimitives";
import { AvatarEditor } from "./AvatarEditor";
import { CompanionArt } from "./CompanionArt";

export function PetSettings({
  prefs,
  save,
}: {
  prefs: AccountPreferences;
  save: (patch: Partial<AccountPreferences>) => boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [baseline, setBaseline] = useState(prefs.petImage);
  const [error, setError] = useState("");
  useToolLeaveGuard(
    draft !== null && draft !== prefs.petImage ? "Your companion image has not been saved." : null,
  );
  return (
    <>
      <Group title="Your companion">
        <Row
          title="Show pet"
          note="An optional in-app companion. It does not report task progress or operate outside LensLabs."
        >
          <Switch
            aria-label="Show pet"
            checked={prefs.showPet}
            onCheckedChange={(showPet) => save({ showPet })}
          />
        </Row>
        <Row
          title="Companion"
          note="Original LensLabs artwork. Selecting one replaces a custom image."
        >
          <Choice
            label="Companion"
            value={prefs.petImage ? "custom" : prefs.pet}
            options={[
              ...(prefs.petImage ? [["custom", "Custom image"] as [string, string]] : []),
              ["cat", "Cat"],
              ["dog", "Dog"],
            ]}
            change={(value) => {
              if (value !== "custom") save({ pet: value as "cat" | "dog", petImage: "" });
            }}
          />
        </Row>
        <Row
          title="Companion animation"
          note={
            prefs.reduceMotion
              ? "Reduced motion is on; animation remains paused."
              : "A quiet blink, not a working indicator. Respects reduced motion."
          }
        >
          <Switch
            aria-label="Companion animation"
            checked={prefs.petAnimation}
            onCheckedChange={(petAnimation) => save({ petAnimation })}
          />
        </Row>
        <Row
          title="Companion position"
          note="Left or right workspace corner. The companion never intercepts clicks; hide it through your account menu or assigned shortcut."
        >
          <Choice
            label="Companion position"
            value={prefs.petPosition}
            options={[
              ["left", "Left"],
              ["right", "Right"],
            ]}
            change={(value) => save({ petPosition: value as "left" | "right" })}
          />
        </Row>
        <Row title="Reset companion position">
          <button
            className="settings-button"
            disabled={prefs.petPosition === "right"}
            onClick={() => save({ petPosition: "right" })}
          >
            Reset to right
          </button>
        </Row>
        <div className="settings-pet-preview">
          <CompanionArt
            kind={prefs.pet}
            image={prefs.petImage}
            animate={prefs.petAnimation && !prefs.reduceMotion}
          />
          <span>{prefs.showPet ? "Shown in your workspace" : "Tucked away"}</span>
        </div>
      </Group>
      <Group title="Custom image">
        <Row
          title="Companion image"
          note="JPEG, PNG or WebP up to 50 MB and 100 megapixels. Cropped to 128 px, saved to this browser. No packages or executable files."
        >
          <span className="settings-capability">Local image only</span>
        </Row>
        <AvatarEditor
          value={draft ?? prefs.petImage}
          name="LensLabs"
          kind="companion"
          maxBytes={12_000}
          disabled={false}
          onChange={(value) => {
            if (draft === null) setBaseline(prefs.petImage);
            setDraft(value);
            setError("");
          }}
        />
        {draft !== null && (
          <div className="settings-inline-actions">
            <button
              className="settings-button primary"
              onClick={() => {
                if (baseline !== prefs.petImage) {
                  setError("The companion changed in another tab. Cancel and review it again.");
                  return;
                }
                if (save({ petImage: draft })) setDraft(null);
              }}
            >
              Save image
            </button>
            <button
              className="settings-button"
              onClick={() => {
                setDraft(null);
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
      </Group>
    </>
  );
}
