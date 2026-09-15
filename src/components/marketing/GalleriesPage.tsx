import { Link } from "@tanstack/react-router";
import { useAccount } from "@/components/account/AccountProvider";
import { publicEntry } from "@/lib/public-entry";
import "./galleries-page.css";

const PILLARS = [
  {
    label: "A copy you send",
    title: "Masters stay with you.",
    body: "The gallery is a set you chose to publish. Originals stay on your machine unless you export them. A sent link is not a backup of the shoot.",
  },
  {
    label: "One path",
    title: "Pick, then publish.",
    body: "Same-night delivery fails when you polish before the set exists. Mark keepers first. Then send. Celinen is built for that order.",
  },
  {
    label: "The client side",
    title: "Favourites and downloads.",
    body: "Clients open a private link, favourite frames, and download when you allow it. They do not need a Celinen account to look.",
  },
] as const;

const CLIENT = [
  {
    title: "Passcode",
    body: "Lock the link. The client types the code you sent them. Closed and expired galleries stay closed.",
  },
  {
    title: "Favourites",
    body: "A heart on a frame is a client pick. It is not a cull, and it does not delete anything on your side.",
  },
  {
    title: "Downloads",
    body: "Single files or a zip of what you published. RAW stays RAW. You decide whether downloads are on.",
  },
  {
    title: "Lightbox",
    body: "Tap a frame to see it large. Filter to favourites when they are choosing.",
  },
  {
    title: "Find me",
    body: "Name or jersey/bib. The buyer should not scroll 80,000 frames to find themselves.",
  },
] as const;

const FAQ: [string, string][] = [
  [
    "What is a Celinen gallery?",
    "A published copy of the keepers you chose. Masters stay with you. The client gets a link, not your archive.",
  ],
  [
    "Do I need a connected account to send one?",
    "Publishing a client gallery needs a connected account. Local picking and developing do not. Check the connection before you promise a link for tonight.",
  ],
  [
    "Can clients favourite and download?",
    "Yes. Favourites are stored per visitor. Downloads are optional. Original bytes are not re-encoded in the zip.",
  ],
  [
    "Can the gallery find one athlete in 80,000 frames?",
    "In the workspace you keep a roster and tag jersey or bib numbers onto frames. The client gallery has Find my photos for a name or number. Face naming, bib OCR, and kit recognition are the next layer — not a silent identity invented from a face box today.",
  ],
  [
    "Is there face search or a print store?",
    "No face gating and no lab print checkout. Stripe books on Earnings are invoices and collected payments — a different path.",
  ],
  [
    "Can I send video in the gallery?",
    "The client gallery is photographs. Do not plan a video delivery on this link.",
  ],
  [
    "Is storage unlimited?",
    "No. A Celinen plan lists photo credits. Confirm the amount at checkout. Do not treat a gallery as cloud backup of your originals.",
  ],
  [
    "Can I post the gallery to every social at once?",
    "Connect your socials in Connectors. One send can go to every connected app — feed, Stories, and the highlights you pick. We do not post to an account you have not connected.",
  ],
];

const STILLS = [
  "/images/blog/sports-editing.jpg",
  "/images/blog/same-night-gallery.jpg",
  "/images/foto-open-sky.webp",
  "/images/blog/picking-the-frames.jpg",
  "/images/blog/lightroom-capture-one.jpg",
  "/images/blog/sports-editing.jpg",
] as const;

export function GalleriesPage() {
  const account = useAccount();
  const entry = publicEntry(account?.status);
  return (
    <div className="foto-galleries">
      <section className="foto-galleries__hero" data-reveal>
        <p className="foto-galleries__eyebrow">Galleries</p>
        <h1>
          Send the gallery
          <br />
          <em>tonight.</em>
        </h1>
        <p className="foto-galleries__lead">
          Keepers only. Passcode if you want one. Favourites come back. Originals stay on your
          machine.
        </p>
        <div className="foto-galleries__actions">
          <Link to={entry.to} search={entry.search} className="marketing-action marketing-action--primary">
            {entry.label}
            <span aria-hidden="true">→</span>
          </Link>
          <Link to="/blog/send-a-gallery-the-same-night" className="foto-galleries__text">
            How same-night delivery works
          </Link>
        </div>
        <ul className="foto-galleries__chips">
          <li>Pick</li>
          <li>Publish</li>
          <li>Passcode</li>
          <li>Favourites</li>
          <li>Download</li>
          <li>Who</li>
        </ul>
      </section>

      <div className="foto-galleries__preview" aria-hidden="true" data-reveal>
        {STILLS.map((src, index) => (
          <img key={`${src}-${index}`} src={src} alt="" />
        ))}
      </div>

      <section className="foto-galleries__block" data-reveal>
        <p className="foto-galleries__eyebrow">Pick. Publish. Send.</p>
        <h2>
          From the cull to a link
          <br />
          the client can open.
        </h2>
        <div className="foto-galleries__pillars">
          {PILLARS.map((item) => (
            <article key={item.title}>
              <p>{item.label}</p>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="foto-galleries__block" id="who" data-reveal>
        <p className="foto-galleries__eyebrow">High-volume sports</p>
        <h2>
          Tell me who is in
          <br />
          every photo.
        </h2>
        <p className="foto-galleries__lead">
          A marathon is 4,000 runners and 80,000 frames. The buyer does not want the card. They
          want Melani Shrestha → 47 photographs of Melani. Tagging every frame by hand is another
          job. PhotoDay FaceFind and Photo Mechanic jersey captions already prove the demand.
        </p>
        <div className="foto-galleries__pillars">
          <article>
            <p>In the workspace now</p>
            <h3>Roster, jersey, bib.</h3>
            <p>
              Type #23 and Celinen maps it to the roster name — the Photo Mechanic caption habit, on
              the shoot. Filter the filmstrip to one athlete. You can also group faces in this job
              as unlabeled Person 12 and name them yourself. Matching stays on this wedding or
              game. Faces are not named automatically. InsightFace buffalo weights are not shipped.
            </p>
          </article>
          <article>
            <p>For the buyer</p>
            <h3>Find my photos.</h3>
            <p>
              The gallery search is name or number. Scroll-the-whole-set is the failure mode. This
              is the product: one person, their frames.
            </p>
          </article>
          <article>
            <p>The larger version</p>
            <h3>Every photo already knows.</h3>
            <p>
              Face, jersey, bib, OCR, roster, kit colour, timing, camera position — then #23 is
              Jane Doe, USC, women’s soccer, 34th minute, without you typing it. That is the
              genie. We do not pretend it is done.
            </p>
          </article>
        </div>
      </section>

      <section className="foto-galleries__block" data-reveal>
        <p className="foto-galleries__eyebrow">On their phone</p>
        <h2>What the client actually gets.</h2>
        <div className="foto-galleries__grid">
          {CLIENT.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="foto-galleries__block foto-galleries__faq" data-reveal>
        <p className="foto-galleries__eyebrow">Questions</p>
        <h2>
          Frequently <em>asked</em>
        </h2>
        {FAQ.map(([question, answer]) => (
          <details key={question}>
            <summary>{question}</summary>
            <p>{answer}</p>
          </details>
        ))}
      </section>

      <section className="foto-galleries__close" data-reveal>
        <h2>The set is ready. Send it.</h2>
        <Link to={entry.to} search={entry.search} className="marketing-action marketing-action--primary">
          {entry.label}
          <span aria-hidden="true">→</span>
        </Link>
      </section>
    </div>
  );
}
