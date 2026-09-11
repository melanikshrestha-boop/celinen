import { Link } from "@tanstack/react-router";
import { PRODUCT_NAME } from "@/lib/product";
import { PublicPage } from "./PublicPage";

const CONTACT = "hello@lenslab.dev";

export function CookiePolicyPage() {
  return (
    <PublicPage title="Cookie Policy">
      <article className="legal-doc">
        <p className="legal-doc__updated">Effective as of September 10, 2026</p>
        <p>
          This Cookie Policy explains how {PRODUCT_NAME} (“{PRODUCT_NAME},” “we,” “our,” or “us”) uses
          cookies and similar storage and tracking technologies when you visit or use our platform,
          websites, and other products and services (“Services”). It describes what these technologies
          are, the categories we use, who places them, how long they last, and the choices you have
          to accept, reject, or withdraw your consent.
        </p>
        <p>
          This Cookie Policy is part of, and should be read together with, our{" "}
          <Link to="/privacy">Privacy Policy</Link> and our <Link to="/terms">Terms of Service</Link>.
          Any terms we use here without defining them have the meaning given to them in those
          documents. Where this Cookie Policy describes how we handle personal data, the broader
          practices, your rights, and our legal bases are set out in the{" "}
          <Link to="/privacy">Privacy Policy</Link>.
        </p>

        <h2>1. What Are Cookies and Similar Technologies</h2>
        <p>
          Cookies are small text files that a website places on your device to store information. We
          also use related technologies that serve the same purpose, including browser local storage
          and session storage. In this Cookie Policy we refer to all of these together as “cookies.”
        </p>
        <p>
          Cookies can be “first-party” (set by {PRODUCT_NAME}) or “third-party” (set by a service provider we
          work with). They can also be “session” cookies, which are deleted when you close your
          browser, or “persistent” cookies, which stay on your device until they expire or you
          delete them.
        </p>

        <h2>2. The Categories of Cookies We Use</h2>
        <p>
          We group the cookies we use into two categories: strictly necessary and analytics. We do
          not use advertising or cross-context behavioral advertising cookies, and we do not run
          third-party ad networks on the Services.
        </p>
        <h3>2.1 Strictly Necessary Cookies</h3>
        <p>
          These cookies are required for the Services to work. They cannot be switched off through
          our consent controls, because without them core features such as signing in and keeping
          your session secure would not function. Strictly necessary cookies include:
        </p>
        <ul>
          <li>
            <strong>Authentication and session cookies</strong> that keep you signed in, maintain
            your session, and protect against unauthorized access.
          </li>
          <li>
            <strong>Security cookies</strong> that help protect the Services against abuse.
          </li>
          <li>
            <strong>Your consent choice itself</strong>, stored so we remember whether you accepted
            or rejected non-essential cookies. This is the consent cookie, kept for one year.
          </li>
        </ul>
        <h3>2.2 Analytics and Non-Essential Cookies</h3>
        <p>
          These cookies help us understand how visitors use the public site, including pages viewed,
          in aggregate. They are not required for the Services to function. Until you choose
          Accept, analytics are not recorded. Reject keeps the site working and does not record
          visits.
        </p>

        <h2>3. When Non-Essential Cookies Run, and When They Are Off</h2>
        <ul>
          <li>
            <strong>Consent banner.</strong> We show Accept and Reject with equal weight. Non-essential
            analytics stay off until you Accept.
          </li>
          <li>
            <strong>If you Reject, or take no action,</strong> analytics remain off.
          </li>
        </ul>
        <p>Strictly necessary cookies are used because they are essential to the Services.</p>

        <h2>4. How to Manage or Withdraw Your Choices</h2>
        <ul>
          <li>
            <strong>Cookie Preferences.</strong> Use the Cookie Preferences link in the website
            footer to reopen your choice.
          </li>
          <li>
            <strong>The consent banner.</strong> Select Reject to keep non-essential cookies off, or
            Accept to allow them.
          </li>
          <li>
            <strong>Browser controls.</strong> Most browsers let you block or delete cookies. If you
            block strictly necessary cookies, signing in may not work. Clearing storage also clears
            the consent cookie.
          </li>
        </ul>

        <h2>5. Cookies Set by Our Service Providers</h2>
        <p>
          Some cookies are placed by the providers we use to deliver sign-in, session, and security.
          A fuller description is in our <Link to="/privacy">Privacy Policy</Link>.
        </p>

        <h2>6. How Long Cookies Last</h2>
        <ul>
          <li>
            <strong>Session and authentication cookies</strong> last for the signed-in session and
            are refreshed or cleared when you sign out.
          </li>
          <li>
            <strong>The consent cookie</strong> lasts one year, or until you change it through Cookie
            Preferences or clear your browser.
          </li>
          <li>
            <strong>Analytics</strong> only run after Accept, and only for visits after that choice.
          </li>
        </ul>

        <h2>7. Relationship to the Privacy Policy</h2>
        <p>
          This Cookie Policy is part of and incorporated into our{" "}
          <Link to="/privacy">Privacy Policy</Link>. If there is any conflict on a cookie-specific
          point, this Cookie Policy controls.
        </p>

        <h2>8. Children</h2>
        <p>
          The Services are intended for users who are 18 years of age or older. We do not knowingly
          use cookies to collect personal information from anyone under 18.
        </p>

        <h2>9. Changes to This Cookie Policy</h2>
        <p>
          We may update this Cookie Policy from time to time. When we make material changes, we will
          update the effective date below and, where required, provide a more prominent notice.
        </p>

        <h2>10. Contact Us</h2>
        <p>
          {PRODUCT_NAME} · lenslab.dev · {CONTACT}
        </p>
      </article>
    </PublicPage>
  );
}
