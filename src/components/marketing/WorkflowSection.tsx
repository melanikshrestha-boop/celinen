import { FolderInput, Scissors, SlidersHorizontal, Image, Images } from "lucide-react";
import "./marketing-value.css";

const WORKFLOW = [
  {
    title: "Import",
    icon: FolderInput,
    copy: "Bring in a shoot. Work from local previews while your original files stay untouched.",
  },
  {
    title: "Cull",
    icon: Scissors,
    copy: "Review focus and duplicate suggestions. Keep the frames that tell your story. Every decision stays yours.",
  },
  {
    title: "Edit",
    icon: SlidersHorizontal,
    copy: "Adjust your keepers, then export ratings and supported develop settings for your Adobe workflow.",
  },
  {
    title: "Finish",
    icon: Image,
    copy: "Perfect the details in your preferred editor. Prepare the final photos for your client gallery.",
    note: "Advanced retouching stays in your editor.",
  },
  {
    title: "Deliver",
    icon: Images,
    copy: "Publish prepared gallery copies for clients to view, choose favorites and leave feedback.",
    note: "Publishing requires a connected account.",
  },
] as const;

export function WorkflowSection() {
  return (
    <section
      className="marketing-workflow"
      id="workflow"
      aria-labelledby="workflow-heading"
      data-reveal
    >
      <p className="marketing-value__eyebrow">From the first frame to the final gallery</p>
      <h2 id="workflow-heading">Less between you and your next shoot.</h2>
      <div className="marketing-workflow__carousel" aria-label="Photography workflow">
        {WORKFLOW.map(({ title, icon: Icon, copy, ...rest }, index) => (
          <article
            key={title}
            className="marketing-workflow__card"
            aria-label={`Step ${index + 1} of ${WORKFLOW.length}: ${title}`}
          >
            <Icon size={30} strokeWidth={1.5} aria-hidden="true" />
            <p className="marketing-value__eyebrow">Step {index + 1}</p>
            <h3>{title}</h3>
            <p>{copy}</p>
            {"note" in rest && <small>{rest.note}</small>}
          </article>
        ))}
      </div>
    </section>
  );
}
