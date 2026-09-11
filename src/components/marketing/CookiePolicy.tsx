import { Link } from "@tanstack/react-router";
import { PRODUCT_NAME } from "@/lib/product";
import { PublicPage } from "./PublicPage";

const CONTACT = "hello@lenslab.dev";

export function CookiePolicyPage() {
  return (
    <PublicPage title="Cookie Policy">
      <article className="legal-doc">
        <p className="legal-doc__updated">Effective as of September 10, 2026</p>

        <h2>1. What are cookies</h2>
        <p>
          As is common practice with almost all professional websites this site uses cookies, which
          are tiny files that are downloaded to your computer, to improve your experience. This page
          describes what information they gather, how we use it and why we sometimes need to store
          these cookies. We will also share how you can prevent these cookies from being stored
          however this may downgrade or “break” certain elements of the site’s functionality.
        </p>
        <p>
          Cookies can be first-party (set by {PRODUCT_NAME}) or third-party (set by a provider we
          work with). They can be session cookies, deleted when you close the browser, or persistent
          cookies, which stay until they expire or you delete them. In this Cookie Policy we also
          mean local storage and session storage when we say “cookies.”
        </p>

        <h2>2. How we use cookies</h2>
        <p>
          We use cookies for a variety of reasons detailed below. Unfortunately in most cases there
          are no industry standard options for disabling cookies without completely disabling the
          functionality and features they add to this site. Strictly necessary cookies keep you
          signed in and remember your consent choice. Analytics cookies stay off until you Accept.
        </p>

        <h2>3. Disabling cookies</h2>
        <p>
          You can prevent the setting of cookies by adjusting the settings on your browser (look for
          “Help” in your browser on how to do this). Be aware that disabling cookies will affect the
          functionality of this and many other websites that you visit. Disabling cookies will
          usually result in also disabling certain functionality and features of this site. Blocking
          strictly necessary cookies may stop sign-in from working.
        </p>
        <p>
          Use Cookie Preferences in the footer, or the consent banner, to Accept or Reject
          non-essential cookies. Reject keeps the site working and does not record visits. The
          consent cookie itself is kept so we remember that choice.
        </p>

        <h2>4. The cookies we set</h2>
        <ul>
          <li>
            <strong>Account related cookies</strong> — if you create an account with us then we will
            use cookies for the management of the signup process and general administration. These
            cookies will usually be deleted when you log out however in some cases they may remain
            afterwards to remember your site preferences when logged out.
          </li>
          <li>
            <strong>Login related cookies</strong> — we use cookies when you are logged in so that
            we can remember this fact. This prevents you from having to log in every single time you
            visit a new page. These cookies are typically removed or cleared when you log out to
            ensure that you can only access restricted features and areas when logged in.
          </li>
          <li>
            <strong>Forms related cookies</strong> — when you submit data through a form such as
            those found on contact pages or comment forms cookies may be set to remember your user
            details for future correspondence.
          </li>
          <li>
            <strong>Site preferences cookies</strong> — in order to provide you with a great
            experience on this site we provide the functionality to set your preferences for how
            this site runs when you use it. In order to remember your preferences we need to set
            cookies so that this information can be called whenever you interact with a page that is
            affected by your preferences. The consent cookie is one of these, kept for one year.
          </li>
        </ul>

        <h2>5. Third-party cookies</h2>
        <p>
          In some special cases we also use cookies provided by trusted third parties. The following
          section details which third party cookies you might encounter through this site.
        </p>
        <p>
          We record public-site analytics only after you Accept. Until then, analytics stay off.
          Reject records nothing. These cookies may track things such as how long you spend on the
          site and the pages that you visit so we can continue to produce a site that works for
          photographers.
        </p>
        <p>
          From time to time we test new features and make subtle changes to the way that the site is
          delivered. When we are still testing new features these cookies may be used to ensure that
          you receive a consistent experience whilst on the site whilst ensuring we understand which
          optimisations our users appreciate the most.
        </p>
        <p>
          As we sell services it’s important for us to understand statistics about how many of the
          visitors to our site actually start a paid plan and as such this is the kind of data that
          these cookies will track. This is important to you as it means that we can accurately make
          business predictions that allow us to monitor our advertising and product costs.
        </p>
        <p>
          Several partners advertise on our behalf and affiliate tracking cookies simply allow us to
          see if photographers have come to the site through one of our partner sites so that we can
          credit them appropriately and, where applicable, apply the 20% checkout discount. The
          referral cookie window is 60 days. See{" "}
          <Link to="/affiliates">Affiliates</Link>.
        </p>
        <p>
          Sign-in providers we use to keep your session secure may set their own cookies as part of
          authentication. A fuller description is in our <Link to="/privacy">Privacy Policy</Link>.
          We do not run third-party ad networks or cross-context behavioral advertising cookies on
          the Services.
        </p>

        <h2>6. How long cookies last</h2>
        <ul>
          <li>Session and authentication cookies last for the signed-in session and clear on sign-out.</li>
          <li>The consent cookie lasts one year, or until you change it through Cookie Preferences.</li>
          <li>Affiliate referral cookies last 60 days.</li>
          <li>Analytics only run after Accept, and only for visits after that choice.</li>
        </ul>

        <h2>7. More information</h2>
        <p>
          If there is something that you aren’t sure whether you need or not it’s usually safer to
          leave strictly necessary cookies enabled in case they interact with a feature you use —
          sign-in, in particular. Non-essential cookies stay off until you Accept.
        </p>

        <h2>8. Related policies</h2>
        <p>
          This Cookie Policy is part of, and should be read together with, our{" "}
          <Link to="/privacy">Privacy Policy</Link> and our <Link to="/terms">Terms of Service</Link>
          . If there is any conflict on a cookie-specific point, this Cookie Policy controls. The
          Services are intended for users who are 18 years of age or older. We do not knowingly use
          cookies to collect personal information from anyone under 18.
        </p>

        <h2>9. Contact us</h2>
        <p>
          If you have any questions about this Cookie Policy, please contact us at {CONTACT}.{" "}
          {PRODUCT_NAME} · lenslab.dev
        </p>
      </article>
    </PublicPage>
  );
}
