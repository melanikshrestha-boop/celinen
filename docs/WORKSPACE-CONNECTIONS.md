# Gmail and web research activation

These integrations extend the existing Lovable/TanStack/Supabase application. Do not move the app to a different hosting platform or replace existing environment values. No Google or Brave credentials have been provisioned by this change; neither provider has been tested with a real account yet.

## Gmail: explicit, read-only session connection

1. In the Google Cloud project for LensLabs, enable the Gmail API. Configure the OAuth consent screen with the correct application name, support contact, authorized domain, privacy policy, and test users while in Testing.
2. Create a **dedicated Web application OAuth client** for this Gmail integration. Add exact authorized JavaScript origins for the environments being used, such as `http://localhost:8080` and `https://lenslab.dev`. Do not include paths. Authorize `http://127.0.0.1:8080` separately if that origin is used. This uses a popup token model, not a redirect/code-exchange backend.
3. Set the **public** build variable `VITE_GOOGLE_GMAIL_CLIENT_ID` to that OAuth client ID and rebuild. Do not add a client secret to a Vite variable. The app does not need a Google client secret or refresh token.
4. In a Gmail tab, choose **Connect Gmail** and complete Google's permission window yourself. No mailbox search occurs just from opening the tab. A pending explicit chat search can run after you connect. Opening a message creates another tab; choose **Read message** to retrieve its body.
5. Before broad commercial release, complete Google's applicable production verification for the restricted `gmail.readonly` scope. A working test-user popup is not proof of production approval.

The app requests only `https://www.googleapis.com/auth/gmail.readonly`, with incremental inclusion of old grants disabled. Access tokens are held only in an account-owned in-memory object. Google metadata and plain-text message bodies are fetched directly by the browser and are never copied into the photo assistant, application database, or browser storage. Recognized Gmail/search commands stay visible in the local chat but are excluded from hosted planner history. Gmail search terms remain in pane/request memory; the app does not add them to tool URLs. Message references do appear in tool URLs. Email bodies, attachments, and tokens are not included in URLs.

Switching tabs/projects retains the connection for this browser session. Reloading or signing out clears it. Every API request checks expiry; revoked/expired access requires an explicit reconnect. Disconnect clears local mail immediately and asks Google to revoke access; if revocation cannot be confirmed, the app says so. Use Google Account permissions to revoke any remaining grant.

No email sending, deleting, labeling, drafting, attachment downloading, or background mailbox synchronization is implemented. HTML mail, remote tracking images, and executable content are not rendered; the original message can be opened in Gmail.

Primary references: [Google token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [OAuth client setup](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

## Web research: authenticated, bounded server requests

1. Configure a Brave Search API subscription with an appropriate provider-side spending/quota cap. Set `BRAVE_SEARCH_API_KEY` as a **server-only** secret in the existing hosting settings, never as a `VITE_` variable or in a tracked file.
2. Keep the app's existing Supabase authentication configuration. The server also needs its existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Do not expose the service-role key to the browser.
3. Apply additive migration `0016_workspace_search_limits.sql` through the existing deployment workflow. It stores counters and short-lived leases only, not search queries or mailbox/photo data. No older table or shoot is modified.
4. Sign into LensLabs and run a search from Web research. The local single-user workspace alone does not provide the authenticated cloud identity required for paid searches. Without provider setup/sign-in, the app offers an ordinary external browser search.

The server validates a 2–500 character explicit query and sends only that query to Brave's fixed search endpoint. Results are linked, escaped text, with bounded response size and no automatic page fetching. No shoot metadata, photos, or Gmail bodies are silently included. Search results are not fed into the assistant automatically.

Database admission is shared across server instances and fail-closed: 8 attempts per owner/minute, 60 total/minute, 1,000 total per fixed 24-hour window, and at most 4 active search leases. Windows begin with the first admitted request after expiry, not at calendar midnight; adjacent windows can allow a boundary burst, so this is not a rolling-day billing guarantee. Attempts including provider errors consume budget. Provider calls time out after 12 seconds; abandoned leases expire after 45 seconds. Only the server service role can invoke admission/release. Missing migration/protection blocks paid requests. These launch limits do not replace a provider-side billing cap; adjust them only with a reviewed migration.

Primary reference: [Brave Web Search API](https://api-dashboard.search.brave.com/api-reference/web/search/get).

## Required live acceptance checks

- Test Google consent denial, blocked/closed popup, expiry, reconnect, and revocation with an authorized test account.
- Read a known plain-text message; verify no mail is sent or changed. Disconnect while a request is in flight; previous results must not return.
- Open two searches and a message alongside Studio. Confirm distinct titles, preserved input/results, closing behavior, keyboard focus, and mobile Chat/Tool switching.
- Switch local projects and return to a tab after reviewing a newer delivery version; the current version must not rewind.
- Verify authenticated web results and source links. Verify unauthenticated calls, unavailable admission, and exhausted quotas do not reach the provider.
- Verify privacy/security headers, Google script availability, authorized origins, and provider policy requirements in the actual hosted environment.

Unit, type, build, and isolated SQL checks do not replace these live provider/browser checks. The live Lovable deployment remains unchanged until deployed through the approved workflow.
