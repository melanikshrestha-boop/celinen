/** Optional fields stay mounted, so collapsed options retain defaults and edits. */
export function NewGalleryFields({
  defaultDate,
  earliestDate,
  latestDate,
}: {
  defaultDate: string;
  earliestDate: string;
  latestDate: string;
}) {
  return (
    <>
      <label>
        Gallery title
        <input
          name="title"
          placeholder="Friday night under the lights"
          maxLength={160}
          required
          autoFocus
        />
      </label>
      <label>
        Client or team name
        <input name="client" placeholder="Who is this for?" maxLength={120} required />
      </label>
      <details
        className="delivery-new-options"
        onInvalidCapture={(event) => {
          event.currentTarget.open = true;
        }}
      >
        <summary>
          Delivery options <span>30 selections · 30 days by default</span>
        </summary>
        <div className="delivery-form-row">
          <label>
            Selection allowance
            <input name="limit" type="number" min={1} max={3000} defaultValue={30} required />
          </label>
          <label>
            Available until
            <input
              name="expires"
              type="date"
              defaultValue={defaultDate}
              min={earliestDate}
              max={latestDate}
              required
            />
          </label>
        </div>
        <label>
          Selection deadline (optional, your local time)
          <input name="selectionDeadline" type="datetime-local" />
        </label>
        <label>
          A note from you (optional)
          <textarea
            name="message"
            rows={3}
            maxLength={2000}
            placeholder="Pick the frames you love. Open any photo to tell me what you’d like changed."
          />
        </label>
      </details>
    </>
  );
}
