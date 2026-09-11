import { Link } from "@tanstack/react-router";
import { PublicPage } from "./PublicPage";

const CONTACT = "hello@lenslab.dev";

export function TermsPage() {
  return (
    <PublicPage title="Terms of Service">
      <article className="legal-doc">
        <p className="legal-doc__updated">Last updated 9 September 2026</p>
        <p>
          These terms are the agreement for using FOTO at lenslab.dev (the “Services”). If you do
          not accept them, do not create an account or use the workspace. Questions: {CONTACT}.
        </p>

        <h2>1. Who this is for</h2>
        <p>
          FOTO is a photography workspace: import a shoot, pick keepers, and send a gallery. It does
          not post your work to social networks for you.
        </p>
        <p>
          You must be 18 or the age of majority where you live, whichever is higher. If you use
          FOTO for a studio, you confirm you can bind that studio.
        </p>

        <h2>2. Your account</h2>
        <p>
          You may be asked to create an account, choose a password, and give us contact details such
          as your name and email. You promise that registration information is accurate, complete,
          and kept up to date. You may not use a name you do not have the right to use, or another
          person’s name in order to impersonate them. You may not transfer your account without our
          prior written permission.
        </p>
        <p>
          Do not share your account. Protect the security of your account, password, and any other
          access tools or credentials. You are responsible for activity on your account.
        </p>

        <h2>3. Your photographs</h2>
        <p>
          You keep ownership of your photographs and client work. Originals stay on the machine you
          use unless you choose to publish a gallery or connect a service that sends copies.
        </p>
        <p>
          You grant FOTO only the licence needed to operate the workspace for you: display, transcode,
          and deliver files you ask us to process. That licence ends when you delete the material or
          close the account, except for copies you already sent to a client or a third party.
        </p>
        <p>
          You are responsible for model releases, property releases, and the right to show identifiable
          people. Do not upload work you are not allowed to use.
        </p>

        <h2>4. Photo credits and billing</h2>
        <p>
          Paid plans are billed in USD. Listed volumes (for example 1,000 photo credits / month on
          Pro billed yearly at USD 16 / mo) are the published amounts at checkout. Annual prices are
          the equivalent monthly rate for a year prepaid. We do not change those published amounts
          in this document.
        </p>
        <p>
          You can cancel before the next renewal. Unused credits do not roll into cash. EU and UK
          consumers keep any non-waivable withdrawal rights under local law.
        </p>

        <h2>5. AI in the workspace</h2>
        <p>
          Some pick and edit suggestions use machine learning. Outputs can be wrong. You review
          keepers before a gallery goes out. FOTO does not use your originals to train a shared
          model for other photographers.
        </p>

        <h2>6. Acceptable use</h2>
        <p>
          Do not break the law, attack the service, scrape accounts, try to obtain another person’s
          password or credentials, or use FOTO to infringe someone else’s copyright or publicity
          rights. We may suspend an account that does.
        </p>

        <h2>7. Privacy</h2>
        <p>
          The <Link to="/privacy">Privacy Policy</Link> is part of this agreement, including how we
          treat photographers in the EEA, UK, and Switzerland.
        </p>

        <h2>8. Disclaimers</h2>
        <p>
          The Services are provided as available. Photography files, calendars, and deliveries can
          fail; keep your own backups of originals. Nothing here limits liability that law does not
          allow us to limit, including for EU consumers.
        </p>

        <h2>9. Changes</h2>
        <p>
          If these terms change in a way that matters, we will post the new version on this page.
          Stop using FOTO if you do not accept the update.
        </p>

        <h2>10. Contact</h2>
        <p>
          FOTO · lenslab.dev · {CONTACT}
        </p>
      </article>
    </PublicPage>
  );
}

export function PrivacyPage() {
  return (
    <PublicPage title="Privacy Policy">
      <article className="legal-doc">
        <p className="legal-doc__updated">Last updated 9 September 2026</p>
        <p>
          This policy explains how FOTO (lenslab.dev) handles personal data for photographers and
          the people who appear in their work. It is written for use in the EEA, UK, Switzerland,
          and elsewhere. It is not legal advice. Contact {CONTACT}.
        </p>

        <h2>1. What we collect</h2>
        <ul>
          <li>Account: name, email, password hash, workspace preferences.</li>
          <li>
            Photographs you import, picks you make, and galleries you choose to publish.
          </li>
          <li>Billing details processed by our payment provider when you buy a plan.</li>
          <li>Device and log data needed to run and secure the site (IP, browser, errors).</li>
          <li>
            Optional analytics only after you Accept cookies. Reject records nothing.
          </li>
        </ul>

        <h2>2. Why we use it</h2>
        <div className="legal-doc__table-wrap">
          <table>
            <thead>
              <tr>
                <th>Purpose</th>
                <th>Legal basis (GDPR)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Create and run your account</td>
                <td>Contract, Art. 6(1)(b)</td>
              </tr>
              <tr>
                <td>Pick, develop, and send work you ask for</td>
                <td>Contract, Art. 6(1)(b)</td>
              </tr>
              <tr>
                <td>Charge photo-credit plans</td>
                <td>Contract, Art. 6(1)(b)</td>
              </tr>
              <tr>
                <td>Keep the service safe</td>
                <td>Legitimate interests, Art. 6(1)(f)</td>
              </tr>
              <tr>
                <td>Optional visit analytics</td>
                <td>Consent, Art. 6(1)(a)</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>3. Photographs and learning</h2>
        <p>
          Original files remain read-only in your workspace. FOTO can learn from photos you import
          and edits you keep so the tool is more useful <em>for you</em>. That learning stays in
          your workspace. We do not use originals to train a shared model for other photographers.
          Turn this off in Settings → Privacy.
        </p>
        <p>
          Client galleries you publish are copies you chose to send. People in those photos may have
          their own rights; you are responsible for how you share them.
        </p>

        <h2>4. Europe, UK, and Switzerland</h2>
        <p>
          If you are in the EEA, UK, or Switzerland you can ask to access, correct, delete, export,
          or restrict your data, object to legitimate-interest processing, and withdraw consent.
          Email {CONTACT} with the subject “Privacy rights”. We respond within one month, longer
          only when the request is complex and the law allows.
        </p>
        <p>
          You may also complain to your local data protection authority. We do not sell personal
          data.
        </p>
        <p>
          FOTO is operated from outside the EEA. When we transfer personal data from the EEA, UK, or
          Switzerland we use appropriate safeguards such as Standard Contractual Clauses. Ask{" "}
          {CONTACT} for a copy.
        </p>

        <h2>5. Cookies</h2>
        <p id="cookies">
          Essential cookies keep you signed in. Analytics cookies run only after Accept. Reject
          keeps the site working and does not record visits. The choice is stored in the
          foto_consent cookie for one year. The full{" "}
          <Link to="/legal/cookies">Cookie Policy</Link> is effective as of September 10, 2026.
        </p>

        <h2>6. Retention</h2>
        <p>
          Account and workspace data last for the life of the account. After you delete the account
          we remove personal data within 30 days except records the law requires us to keep (for
          example billing). Local originals on your machine are yours to keep or erase.
        </p>

        <h2>7. Children</h2>
        <p>FOTO is not for anyone under 18. We delete an under-18 account if we learn of one.</p>

        <h2>8. Changes</h2>
        <p>Material changes will be posted on this page before they take effect.</p>

        <h2>9. Contact</h2>
        <p>
          FOTO · lenslab.dev · {CONTACT}
        </p>
      </article>
    </PublicPage>
  );
}
