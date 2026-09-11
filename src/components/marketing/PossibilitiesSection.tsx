import { Camera, Heart, Images, SlidersHorizontal, Star } from "lucide-react";

const sky = "/images/foto-open-sky.webp";

export function PossibilitiesSection() {
  return (
    <section
      className="marketing-possibilities"
      id="possibilities"
      aria-labelledby="possibilities-heading"
    >
      <div className="marketing-section-intro" data-reveal>
        <p className="marketing-value__eyebrow">Room to do your thing</p>
        <h2 id="possibilities-heading">
          Less busywork.
          <br />
          More possibility.
        </h2>
        <p>
          From a folder full of maybes to a gallery you can’t wait to share. Keep the creative part
          yours.
        </p>
      </div>
      <div className="marketing-feature-grid">
        <article className="marketing-feature" data-reveal>
          <div className="marketing-feature__art marketing-feature__art--selects" aria-hidden="true">
            <span className="marketing-sticker">
              That’s the one <Heart size={16} />
            </span>
            <div className="marketing-print marketing-print--one">
              <img src={sky} alt="" loading="lazy" />
              <span>Keep the feeling.</span>
            </div>
            <div className="marketing-print marketing-print--two">
              <img src={sky} alt="" loading="lazy" />
              <span>
                <Star size={13} fill="currentColor" />
                <Star size={13} fill="currentColor" />
                <Star size={13} fill="currentColor" />
                <Star size={13} fill="currentColor" />
                <Star size={13} fill="currentColor" />
              </span>
            </div>
          </div>
          <h3>Find your favorites.</h3>
          <p>Bring in your shoot, review suggestions, and pick the frames that tell your story.</p>
        </article>
        <article className="marketing-feature" data-reveal>
          <div className="marketing-feature__art marketing-feature__art--color" aria-hidden="true">
            <div className="marketing-color-wheel">
              <SlidersHorizontal size={40} strokeWidth={1.4} />
            </div>
            <div className="marketing-palette">
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <span className="marketing-sticker">A little more you.</span>
          </div>
          <h3>Follow your own color.</h3>
          <p>
            Shape the light, explore a look, and save your treatment. Your originals stay untouched.
          </p>
        </article>
        <article className="marketing-feature" data-reveal>
          <div className="marketing-feature__art marketing-feature__art--gallery" aria-hidden="true">
            <div className="marketing-mini-gallery">
              <span>
                The good light collection <Heart size={15} />
              </span>
              <div>
                <img src={sky} alt="" loading="lazy" />
                <img src={sky} alt="" loading="lazy" />
                <img src={sky} alt="" loading="lazy" />
              </div>
            </div>
            <span className="marketing-sticker">Made to be shared ↗</span>
          </div>
          <h3>Give your photos a home.</h3>
          <p>
            Prepare a client gallery for favorites and feedback. Connect your account to publish when
            you’re ready.
          </p>
        </article>
        <article className="marketing-feature" data-reveal>
          <div className="marketing-feature__art marketing-feature__art--studio" aria-hidden="true">
            <div className="marketing-orbit">
              <span>
                <Camera size={32} />
              </span>
              <i>
                <Heart size={21} />
              </i>
              <i>
                <Images size={21} />
              </i>
              <i>
                <Star size={21} />
              </i>
            </div>
            <span className="marketing-sticker">Less juggling. More joy.</span>
          </div>
          <h3>Keep the whole shoot together.</h3>
          <p>People, plans, and photographs in one workspace. More room for whatever comes next.</p>
        </article>
      </div>
    </section>
  );
}
