import { useState, type FormEvent } from "react";
import { prospectInputSchema, type ProspectInput } from "@/lib/outbound/model";

// eslint-disable-next-line react-refresh/only-export-components
export const blankProspect = (): ProspectInput => ({
  name: "",
  company: "",
  email: "",
  website: "",
  specialty: "Product / ecommerce",
  signal: "",
  sourceUrl: "",
  observedOn: new Date().toISOString().slice(0, 10),
  fitReason: "",
  notes: "",
});

const SPECIALTIES = [
  "Product / ecommerce",
  "Wedding",
  "Portrait",
  "Real estate",
  "Fashion",
  "Commercial",
  "Events",
  "Sports",
  "Food",
  "Travel",
  "Architecture",
  "Videography",
  "Other",
];

export function ProspectForm({
  initial,
  busy,
  onSave,
}: {
  initial: ProspectInput;
  busy: boolean;
  onSave: (input: ProspectInput) => Promise<void>;
}) {
  const [input, setInput] = useState<ProspectInput>(
    () =>
      Object.fromEntries(
        Object.keys(blankProspect()).map((key) => [key, initial[key as keyof ProspectInput] ?? ""]),
      ) as ProspectInput,
  );
  const [error, setError] = useState("");
  const field = (key: keyof ProspectInput) => ({
    disabled: busy,
    value: input[key] ?? "",
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
    ) => setInput({ ...input, [key]: event.target.value }),
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const result = prospectInputSchema.safeParse(input);
    if (!result.success) {
      setError(
        result.error.issues.map((issue) => `${issue.path.join(" ")}: ${issue.message}`).join(". "),
      );
      return;
    }
    try {
      await onSave(result.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this prospect.");
    }
  };
  return (
    <form className="out-form" onSubmit={(event) => void submit(event)}>
      <div className="out-form-grid">
        <label>
          Name
          <input {...field("name")} maxLength={160} required autoFocus autoComplete="off" />
        </label>
        <label>
          Studio / business
          <input {...field("company")} maxLength={160} autoComplete="off" />
        </label>
        <label>
          Business email
          <input {...field("email")} type="email" maxLength={320} autoComplete="off" />
        </label>
        <label>
          Website
          <input {...field("website")} type="url" placeholder="https://" maxLength={2000} />
        </label>
        <label>
          Specialty
          <select {...field("specialty")}>
            {[...new Set([...SPECIALTIES, input.specialty])].filter(Boolean).map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          Signal date
          <input {...field("observedOn")} type="date" />
        </label>
      </div>
      <label>
        What makes now relevant?
        <textarea
          {...field("signal")}
          rows={2}
          maxLength={2000}
          placeholder="An exact observation from their public work or a conversation."
        />
      </label>
      <label>
        Source link
        <input {...field("sourceUrl")} type="url" maxLength={2000} placeholder="https://…" />
      </label>
      <label>
        Why Celinen could fit
        <textarea
          {...field("fitReason")}
          rows={2}
          maxLength={2000}
          placeholder="A specific workflow to discuss, not an assumed pain point."
        />
      </label>
      <label>
        Private notes
        <textarea {...field("notes")} rows={2} maxLength={4000} />
      </label>
      {error && (
        <p role="alert" className="out-error">
          {error}
        </p>
      )}
      <div className="out-actions">
        <span className="out-muted">Only add contacts you may appropriately approach.</span>
        <button className="out-primary" disabled={busy}>
          {busy ? "Saving…" : "Save prospect"}
        </button>
      </div>
    </form>
  );
}
