import { BrandMark } from "@/components/marketing/BrandMark";
import { ASSISTANT_MARKS, PUBLIC_INTEGRATIONS } from "@/lib/public-integrations";
import "./publish-everywhere.css";

function Track({
  items,
  reverse = false,
}: {
  items: readonly { id: string; title: string }[];
  reverse?: boolean;
}) {
  const loop = [...items, ...items];
  return (
    <div className={`publish-everywhere__mask${reverse ? " is-reverse" : ""}`}>
      <div className="publish-everywhere__track">
        {loop.map((item, index) => (
          <span key={`${item.id}-${index}`} className="publish-everywhere__chip">
            <BrandMark id={item.id} />
            {item.title}
          </span>
        ))}
      </div>
    </div>
  );
}

export function PublishEverywhere() {
  return (
    <section className="publish-everywhere" aria-label="Publish everywhere" data-reveal>
      <p className="publish-everywhere__eyebrow">Publish everywhere · Drive it from any AI assistant</p>
      <Track items={PUBLIC_INTEGRATIONS} />
      <Track items={ASSISTANT_MARKS} reverse />
    </section>
  );
}
