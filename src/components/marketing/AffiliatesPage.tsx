import { Link } from "@tanstack/react-router";
import { PRODUCT_NAME } from "@/lib/product";
import "./affiliates-page.css";

const APPLY = "mailto:hello@lenslab.dev?subject=Affiliate%20program";

const FAQ: [string, string][] = [
  [
    "What is my commission?",
    "You earn 30% recurring commission on every referral’s subscription for as long as they stay subscribed. Refer 100 photographers on Creator and that is $900 a month, every billing cycle.",
  ],
  [
    "How do I get paid?",
    "Payouts go out through PayPal. We send what you earned on paid referrals, minus any refunds in the window.",
  ],
  [
    "Is there a minimum payout?",
    "Yes. $50 USD in accrued commission before a PayPal transfer. Balances roll until you clear it.",
  ],
  [
    "Can I bid on “celinen” and other related keywords?",
    "No. Do not bid on celinen, lenslab, or confusing variants. Organic content and your unique link are the program.",
  ],
  [
    "Can I use the affiliate link to make a purchase for myself?",
    "No. Self-referrals are not commissionable. The 20% checkout discount is for the photographer you send, not a coupon on your own seat.",
  ],
  [
    "How long do the cookies last for?",
    "60 days. If someone lands through your link and subscribes inside that window, the referral is yours.",
  ],
];

export function AffiliatesPage() {
  return (
    <div className="foto-affiliates">
      <header className="foto-affiliates__intro" data-reveal>
        <p className="foto-affiliates__eyebrow">Earn with us</p>
        <h1>Our 30% affiliate program.</h1>
        <p>Earn recurring commission from your referrals. Incentivise your referrals with discounts at checkout.</p>
        <div className="foto-affiliates__actions">
          <a href={APPLY}>Start earning</a>
        </div>
      </header>
      <dl className="foto-affiliates__stats" data-reveal>
        <div>
          <dt>30%</dt>
          <dd>Recurring commission, every billing cycle</dd>
        </div>
        <div>
          <dt>20%</dt>
          <dd>Off the monthly price for the photographer you send</dd>
        </div>
        <div>
          <dt>PayPal</dt>
          <dd>Fast, reliable payouts</dd>
        </div>
        <div>
          <dt>60 days</dt>
          <dd>Referral cookie window</dd>
        </div>
      </dl>
      <section data-reveal>
        <p className="foto-affiliates__eyebrow">Incentives</p>
        <h2>What’s the benefit?</h2>
        <p>
          Anyone who signs up through your unique link gets an exclusive discount. The more you share,
          the more you earn — every single month.
        </p>
        <div className="foto-affiliates__split">
          <article>
            <h3>They save</h3>
            <p className="foto-affiliates__figure">20%</p>
            <p>off the full monthly price, automatically applied at checkout.</p>
          </article>
          <article>
            <h3>You earn</h3>
            <p className="foto-affiliates__figure">30%</p>
            <p>recurring commission based on their plan, every billing cycle.</p>
            <ul className="foto-affiliates__tx">
              <li>
                <span>Hobby plan referral</span>
                <strong>$6.00</strong>
              </li>
              <li>
                <span>Creator plan referral</span>
                <strong>$9.00</strong>
              </li>
              <li>
                <span>Enterprise plan referral</span>
                <strong>Custom</strong>
              </li>
            </ul>
          </article>
        </div>
      </section>
      <section data-reveal>
        <p className="foto-affiliates__eyebrow">Process</p>
        <h2>How does it work?</h2>
        <ol className="foto-affiliates__steps">
          <li>
            <h3>Generate your link</h3>
            <p>Grab your unique referral link from the affiliate desk in seconds.</p>
          </li>
          <li>
            <h3>Users register</h3>
            <p>Share it anywhere — photographers register through your link.</p>
          </li>
          <li>
            <h3>They upgrade</h3>
            <p>When they subscribe to a paid plan, they get 20% off automatically.</p>
          </li>
          <li>
            <h3>You get paid</h3>
            <p>You earn 30% recurring commission on their subscription, every month.</p>
          </li>
        </ol>
      </section>
      <section className="foto-affiliates__faq" data-reveal>
        <p className="foto-affiliates__eyebrow">Affiliate FAQ</p>
        <h2>Your questions, answered.</h2>
        {FAQ.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>
      <section className="foto-affiliates__close" data-reveal>
        <h2>Switch sides. Join us.</h2>
        <p>Import. Pick. Send tonight. Then get paid when the photographers you send stay.</p>
        <div className="foto-affiliates__actions">
          <Link to="/auth" search={{ next: "/dashboard", mode: "signin", google: true }}>
            Get started
          </Link>
          <a href={APPLY}>Start earning</a>
        </div>
      </section>
    </div>
  );
}

export function AffiliatesLanding() {
  return (
    <section className="foto-affiliates-landing" aria-labelledby="affiliates-heading" data-reveal>
      <p className="foto-affiliates__eyebrow">Earn with us</p>
      <h2 id="affiliates-heading">Our 30% affiliate program.</h2>
      <p>Earn recurring commission from your referrals. Incentivise your referrals with discounts at checkout.</p>
      <dl className="foto-affiliates__stats">
        <div>
          <dt>30%</dt>
          <dd>Recurring commission</dd>
        </div>
        <div>
          <dt>20%</dt>
          <dd>Off for the photographer you send</dd>
        </div>
        <div>
          <dt>PayPal</dt>
          <dd>Payouts</dd>
        </div>
        <div>
          <dt>60 days</dt>
          <dd>Referral cookie window</dd>
        </div>
      </dl>
      <div className="foto-affiliates__actions">
        <Link to="/affiliates">Affiliates</Link>
        <a href={APPLY}>Start earning</a>
      </div>
    </section>
  );
}
