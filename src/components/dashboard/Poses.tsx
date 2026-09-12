import { useEffect, useMemo, useState } from "react";
import { useAccount } from "@/components/account/AccountProvider";
import { BrandMark } from "@/components/marketing/BrandMark";
import { listRecentShoots, type RecentShoot } from "@/lib/studio/shoot-directory";
import {
  POSE_BOARDS,
  POSES,
  parsePinterestBoard,
  readShootPoseLinks,
  writeShootPoseLinks,
  type PoseBoardId,
  type ShootPoseLink,
} from "@/lib/poses";
import "./poses.css";

function PoseSketch({ board }: { board: PoseBoardId }) {
  if (board === "walk")
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="28" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M28 17 L26 34 L18 52 M26 34 L38 50 M22 28 L36 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  if (board === "sit")
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="24" cy="16" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M24 21 L26 32 L18 38 L40 38 M26 32 L44 30" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  if (board === "couple")
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="24" cy="14" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="40" cy="14" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M24 19 L22 50 M40 19 L42 50 M24 32 L40 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  if (board === "sun")
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="46" cy="14" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M46 6 V2 M54 14 H58 M52 8 L55 5 M52 20 L55 23 M40 8 L37 5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="24" cy="22" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M24 27 L24 50 M24 34 L14 42 M24 34 L34 44" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  if (board === "park")
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M8 48 C20 28 44 28 56 48" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="32" cy="22" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M32 27 L32 46 M32 34 L22 42 M32 34 L42 42" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M32 17 L32 38 M32 24 L18 30 M32 24 L46 30 M32 38 L22 54 M32 38 L42 54" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Poses({ shoot }: { shoot?: string }) {
  const account = useAccount();
  const scope = account?.scope;
  const [board, setBoard] = useState<PoseBoardId>("standing");
  const [shoots, setShoots] = useState<RecentShoot[]>([]);
  const [links, setLinks] = useState<Record<string, ShootPoseLink>>({});

  useEffect(() => {
    if (!scope) return;
    setLinks(readShootPoseLinks(scope));
    let alive = true;
    void listRecentShoots(scope)
      .then((rows) => {
        if (alive) setShoots(rows);
      })
      .catch(() => {
        if (alive) setShoots([]);
      });
    return () => {
      alive = false;
    };
  }, [scope]);

  const cards = useMemo(() => POSES.filter((pose) => pose.board === board), [board]);

  function save(next: Record<string, ShootPoseLink>) {
    setLinks(next);
    if (scope) writeShootPoseLinks(scope, next);
  }

  function setPinterest(id: string, value: string) {
    const current = links[id] ?? { pinterest: "", boards: [] };
    save({ ...links, [id]: { ...current, pinterest: value } });
  }

  function toggleBoard(id: string, next: PoseBoardId) {
    const current = links[id] ?? { pinterest: "", boards: [] };
    const boards = current.boards.includes(next)
      ? current.boards.filter((item) => item !== next)
      : [...current.boards, next];
    save({ ...links, [id]: { ...current, boards } });
  }

  return (
    <div className="celinen-poses">
      <h1>Poses</h1>
      <div className="celinen-poses__boards" role="tablist" aria-label="Pose boards">
        {POSE_BOARDS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={board === item.id}
            aria-pressed={board === item.id}
            onClick={() => setBoard(item.id)}
          >
            {item.title}
          </button>
        ))}
      </div>
      <div className="celinen-poses__grid">
        {cards.map((pose) => (
          <article key={pose.id} className={`celinen-poses__card${pose.tall ? " is-tall" : ""}`}>
            <div className="celinen-poses__sketch">
              <PoseSketch board={pose.board} />
            </div>
            <strong>{pose.title}</strong>
          </article>
        ))}
      </div>
      <section className="celinen-poses__shoots" aria-label="Pinterest">
        <h2>Pinterest</h2>
        {(() => {
          const library = links._library ?? { pinterest: "", boards: [] };
          const pin = parsePinterestBoard(library.pinterest);
          return (
            <div className="celinen-poses__shoot">
              <div className="celinen-poses__pin">
                <BrandMark id="pinterest" />
                <input
                  value={library.pinterest}
                  onChange={(event) => setPinterest("_library", event.target.value)}
                  aria-label="Pinterest board"
                  placeholder="pinterest.com/you/board"
                  spellCheck={false}
                  autoComplete="off"
                />
                {pin ? (
                  <a href={pin.href} target="_blank" rel="noreferrer">
                    {pin.label}
                  </a>
                ) : library.pinterest.trim() ? (
                  <span>Invalid</span>
                ) : null}
              </div>
            </div>
          );
        })()}
        {shoots.length > 0 && <h2>Shoots</h2>}
        {shoots.map((row) => {
            const link = links[row.id] ?? { pinterest: "", boards: [] };
            const pin = parsePinterestBoard(link.pinterest);
            return (
              <div
                key={row.id}
                className="celinen-poses__shoot"
                data-current={shoot === row.id ? "true" : undefined}
              >
                <h3>{row.title}</h3>
                <div className="celinen-poses__pin">
                  <BrandMark id="pinterest" />
                  <input
                    value={link.pinterest}
                    onChange={(event) => setPinterest(row.id, event.target.value)}
                    aria-label={`Pinterest board for ${row.title}`}
                    placeholder="pinterest.com/you/board"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  {pin ? (
                    <a href={pin.href} target="_blank" rel="noreferrer">
                      {pin.label}
                    </a>
                  ) : link.pinterest.trim() ? (
                    <span>Invalid</span>
                  ) : null}
                </div>
                <div className="celinen-poses__attach">
                  {POSE_BOARDS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={link.boards.includes(item.id)}
                      onClick={() => toggleBoard(row.id, item.id)}
                    >
                      {item.title}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
      </section>
    </div>
  );
}
