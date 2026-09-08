import { useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { downloadBatch, downloadBatches, offerDownload } from "@/lib/delivery/downloads";
import type { DeliveryCommand, DeliveryVersion } from "@/lib/delivery/workflow";
import { messageOf, sizeLabel, type MediaReader } from "./presentation";

export function FinalDownloads({
  versions,
  media,
  run,
}: {
  versions: DeliveryVersion[];
  media: MediaReader;
  run: (command: DeliveryCommand, operationId?: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [kind, setKind] = useState<"phone" | "full">("phone");
  const [active, setActive] = useState<number | null>(null),
    [count, setCount] = useState(0),
    [error, setError] = useState("");
  const [prepared, setPrepared] = useState<{
    blob: Blob;
    part: number;
    kind: "phone" | "full";
    versionIds: string[];
  } | null>(null);
  const [handoffNote, setHandoffNote] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const batches = downloadBatches(versions, kind);
  if (!versions.length) return null;
  return (
    <>
      <button className="delivery-primary" onClick={() => setOpen(true)}>
        <ArrowDown size={16} />
        Download finals
      </button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) {
            controller.current?.abort();
            setPrepared(null);
          }
        }}
      >
        <DialogContent className="delivery-confirm">
          <DialogTitle>Your final photographs</DialogTitle>
          <DialogDescription>
            Choose phone copies or high-resolution JPEGs. Large galleries are split into manageable
            ZIP parts. You can also download individual photos from their viewer.
          </DialogDescription>
          <div className="delivery-filters">
            <button
              aria-pressed={kind === "phone"}
              disabled={active !== null}
              onClick={() => {
                setKind("phone");
                setPrepared(null);
              }}
            >
              Phone & social
            </button>
            <button
              aria-pressed={kind === "full"}
              disabled={active !== null}
              onClick={() => {
                setKind("full");
                setPrepared(null);
              }}
            >
              High-resolution
            </button>
          </div>
          <div className="delivery-upload-list">
            {batches.map((batch, index) => (
              <div className="delivery-upload-row" key={index}>
                <span>
                  {batches.length === 1 ? "All final photos" : `Part ${index + 1}`}
                  <small>
                    {batch.versions.length} photos · {sizeLabel(batch.bytes)}
                  </small>
                </span>
                <button
                  className="delivery-quiet"
                  disabled={active !== null}
                  onClick={async () => {
                    setActive(index);
                    setCount(0);
                    setError("");
                    setHandoffNote("");
                    setPrepared(null);
                    const abort = new AbortController();
                    controller.current = abort;
                    try {
                      const blob = await downloadBatch(
                        batch.versions,
                        kind,
                        async (id) => {
                          const [item] = await media([id], kind);
                          if (!item) throw new Error("Photo is not available.");
                          return item.url;
                        },
                        setCount,
                        abort.signal,
                      );
                      if (!abort.signal.aborted)
                        setPrepared({
                          blob,
                          part: index + 1,
                          kind,
                          versionIds: batch.versions.map((version) => version.id),
                        });
                    } catch (e) {
                      if (!abort.signal.aborted) setError(messageOf(e));
                    } finally {
                      setActive(null);
                    }
                  }}
                >
                  {active === index ? `${count}/${batch.versions.length} checked…` : "Prepare ZIP"}
                </button>
              </div>
            ))}
          </div>
          {active !== null && (
            <button className="delivery-quiet" onClick={() => controller.current?.abort()}>
              Cancel download
            </button>
          )}
          {prepared && (
            <button
              className="delivery-primary"
              onClick={async () => {
                setError("");
                setHandoffNote("");
                offerDownload(prepared.blob, `finals-${prepared.kind}-part-${prepared.part}.zip`);
                try {
                  await run({
                    type: "downloadHandoff",
                    versionIds: prepared.versionIds,
                    kind: prepared.kind,
                    container: "zip",
                  });
                  setHandoffNote(
                    "ZIP handed to your browser and recorded in Activity. The browser’s final save location cannot be verified.",
                  );
                } catch (e) {
                  setError(
                    `ZIP handed to your browser, but Activity was not updated. ${messageOf(e)}`,
                  );
                }
              }}
            >
              <ArrowDown size={16} />
              Save checked ZIP · {sizeLabel(prepared.blob.size)}
            </button>
          )}
          <p className="delivery-meta">
            {handoffNote ||
              (prepared
                ? "Every file in this part passed its checksum. Tap Save checked ZIP; then check your browser’s Downloads. Preparing a ZIP is not proof that it was saved."
                : "Nothing is marked downloaded automatically. Keep a copy of your finals before this gallery expires.")}
          </p>
          {error && (
            <p className="delivery-error" role="alert">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
