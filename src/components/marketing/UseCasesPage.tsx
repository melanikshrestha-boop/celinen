import { Link } from "@tanstack/react-router";
import { useAccount } from "@/components/account/AccountProvider";
import { publicEntry } from "@/lib/public-entry";
import { UseCaseMark } from "@/components/marketing/UseCaseMark";
import { USE_CASE_SECTIONS } from "@/components/marketing/UseCasesMenu";
import "./use-cases.css";

const CASES: Record<string, { heading: string; body: string }> = {
  "big-ten": {
    heading: "College football on a Big Ten Saturday",
    body: "Thousands of frames, one roster, a sideline that does not wait. Pick the keepers, tag jersey numbers, and send the athletic department a gallery tonight. Originals stay with you.",
  },
  sec: {
    heading: "SEC night games",
    body: "Long bursts under stadium lights. Peak action in, duplicates out. The set that goes to the school is the set you would stand behind.",
  },
  acc: {
    heading: "ACC football",
    body: "Coast Saturday, a long card, a buyer who wants one player. Filter the filmstrip to a jersey. The gallery that goes out is the set you would stand behind.",
  },
  "big-12": {
    heading: "Big 12 Saturday",
    body: "Wide-open games, long bursts, jersey tags before the athletic department asks. Same-night gallery. Originals stay with you.",
  },
  sports: {
    heading: "Sports photography",
    body: "A long card, peak action, duplicates out. The gallery that goes out is the set you would stand behind.",
  },
  "soccer-team": {
    heading: "Soccer team",
    body: "Roster photos, one kit, every player. Tag the jersey. Send the club a gallery tonight.",
  },
  soccer: {
    heading: "Soccer",
    body: "Match action, long bursts, keepers to the club the same night. Originals stay with you.",
  },
  wedding: {
    heading: "Wedding photography",
    body: "Moments over near-duplicates. Coverage across the day, not six identical portraits. The couple gets a gallery they can actually send.",
  },
  portrait: {
    heading: "Portrait photography",
    body: "The frame you would stand behind, not a stack of near-matches. Pick, then send.",
  },
  family: {
    heading: "Family photography",
    body: "Everyone in, the blinks out. A gallery the family can actually share.",
  },
  event: {
    heading: "Event photography",
    body: "A long night, thousands of frames. Keepers out before the client asks.",
  },
  graduation: {
    heading: "Graduation photography",
    body: "One name, one walk, a gallery the family can send the same day.",
  },
  fashion: {
    heading: "Fashion photography",
    body: "The look stays with the photograph. Pick the set the brand can use tonight.",
  },
  commercial: {
    heading: "Commercial photography",
    body: "The set the client can actually use. Originals stay with you.",
  },
  editorial: {
    heading: "Editorial photography",
    body: "A long card, a tight set. The frames you would stand behind go out.",
  },
  product: {
    heading: "Product photography",
    body: "Angle, light, the keeper. Send the set, keep the originals.",
  },
};

const FAQ: [string, string][] = [
  [
    "Can I post to Instagram, TikTok, and the rest at the same time?",
    "Yes. Connect your socials in Connectors. One send can go to every connected app at once — the feed, Stories, and the specific highlights you pick. Each destination has to be connected and allowed before you post. We do not post to an account you have not connected.",
  ],
  [
    "Does college football need a different product than weddings?",
    "No. Same Import → Pick → Send path. The roster, jersey, and bib tools sit on every paid plan. The job type changes the labels, not the software.",
  ],
  [
    "Do you name faces for Big Ten athletes automatically?",
    "No. You tag jersey or bib from the roster. Face naming is not shipped. A face count in cull is not a name.",
  ],
];

export function UseCasesPage() {
  const account = useAccount();
  const entry = publicEntry(account?.status);

  return (
    <div className="foto-use-cases">
      <header className="foto-use-cases__intro" data-reveal>
        <p className="foto-use-cases__eyebrow">Use cases</p>
        <h1>Built for the job in front of you.</h1>
        <p>College football on Saturday. A wedding on Sunday. Same night gallery either way.</p>
      </header>

      {USE_CASE_SECTIONS.map((item) => {
        const detail = CASES[item.id];
        const Icon = "icon" in item ? item.icon : undefined;
        return (
          <section
            key={item.id}
            id={item.id}
            className="foto-use-cases__block"
            data-reveal
          >
            <span className="foto-use-cases__mark" aria-hidden="true">
              {Icon ? (
                <Icon size={22} strokeWidth={1.6} />
              ) : "mark" in item ? (
                <UseCaseMark id={item.mark} />
              ) : null}
            </span>
            <h2>{detail.heading}</h2>
            <p>{detail.body}</p>
          </section>
        );
      })}

      <section className="foto-use-cases__faq" data-reveal>
        <p className="foto-use-cases__eyebrow">Questions</p>
        <h2>Frequently asked</h2>
        {FAQ.map(([question, answer]) => (
          <details key={question}>
            <summary>{question}</summary>
            <p>{answer}</p>
          </details>
        ))}
      </section>

      <p className="foto-use-cases__close" data-reveal>
        <Link to={entry.to} search={entry.search} className="marketing-action marketing-action--primary">
          {entry.label}
          <span aria-hidden="true">→</span>
        </Link>
      </p>
    </div>
  );
}
