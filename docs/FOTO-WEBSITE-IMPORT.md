# FOTO website-content import

FOTO's `/portfolio` page now offers a file-only migration preview. Open it from **Settings → Import → Review website import**. This is not full website migration, domain transfer, or publishing. The editor is session-only; no account database or existing website is changed.

## Supported input reference

| Input                              | Reviewed content                                                                 | Not imported                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Saved `.html` / `.htm`             | One page's site/title text, first headline, description, up to eight menu labels | Photos, video, theme, CSS, fonts, forms, scripts, working navigation, linked pages |
| Pixieset folder-information `.csv` | Up to 1,000 collection names and credential-free URL references                  | Photos/videos, gallery creation, contacts, PINs, passwords, purchases              |
| FOTO migration-plan `.json`        | Strict `foto-portfolio-migration` version 1, carrying the above reviewed content | Arbitrary provider JSON, full website backups, customer databases                  |

All files are capped at 2 MiB. CSV permits 64 columns and 8,192 characters per cell; malformed rows reject the whole input, not only the failing row. Text limits are name 120, description 1,000, headline 200, menu label 80, and collection name 200 characters. Text extraction is approximate and shortened to these limits. Duplicate collection records are preserved.

ZIP, XML, proprietary themes, connected account exports and automatic image downloads are not implemented. Photos added through the existing editor are user-chosen files, not migration downloads, and are not included in the migration-plan JSON.

## How to preview and bring over text

1. Save a page you own as HTML in your browser. Open `/portfolio`, optionally enter its original HTTPS website address, and confirm permission to copy the content.
2. Choose the HTML file. The review lists supported text without loading its scripts, styles, images, or links. Nothing is selected or applied automatically.
3. Select the desired fields and choose **Fill blank fields**. Existing text, photos, theme and handle remain unchanged. Blank fields receive the reviewed text.

Check the editor below to verify the result. **Download migration plan** saves a portable record of the parsed input, not the current edited layout or a complete website backup. Download it before leaving if you want to resume the preflight later. Keep original files and the old site unchanged.

## How to review Pixieset collection metadata

Pixieset documents a folder-information CSV export under Collections → select folder → Export. Its export includes collection links and sensitive client/access columns, but **no photo or video files**. FOTO keeps only collection names and sanitized link references; contact, password, PIN and other columns are discarded. The records stay in the downloadable plan and do not create FOTO galleries or clients. Keep the source CSV private. [Pixieset folder export documentation](https://help.pixieset.com/hc/en-us/articles/31178129650957-Using-folders-to-share-and-organize-galleries).

## Ownership and domain cutover are separate

An entered URL records provenance; FOTO does not fetch it, check DNS, or verify ownership. The user confirmation is permission attestation, not technical proof. URL queries and fragments are removed because they may carry access tokens. Rejecting local/IP addresses and credentials is input hygiene, not a network security boundary: there is no importer network request.

Pixieset's default website address uses `mypixieset.com`; its client-gallery address uses `pixieset.com`. A custom domain remains with its third-party registrar. Pointing DNS at a website is not transferring domain ownership. [Pixieset domain documentation](https://help.pixieset.com/hc/en-us/articles/360059864271-All-you-need-to-know-about-Domains).

Keep the old website live until a separately implemented destination, URL redirect map, asset permissions, forms and gallery access have been checked. Any future DNS cutover needs explicit authorization and must preserve email records. Pixieset warns against modifying MX records and documents DNS propagation delays, so a two-second complete migration promise would be unsupported. No DNS, email, registrar, account, billing or publishing changes occur in this feature. [Pixieset custom-domain guide](https://help.pixieset.com/hc/en-us/articles/360034020052-Setting-up-a-Custom-Domain-for-Pixieset-Website).

## Developer reference

- `src/lib/portfolio-import.ts`: `parsePortfolioImport(text, { fileName, sourceUrl? })`, `normalizePortfolioSourceUrl(input)`, `serializePortfolioImport(plan)`, strict `portfolioImportSchema` / `portfolioContentSchema`, and `fillEmptyPortfolioFields(current, proposed)`.
- `PortfolioImportPanel({ onApply(content) })`: bounded local file read, generation-guarded cancellation/unmount, explicit field checklist, and user-triggered JSON download. HTML is parsed as strings, never an iframe/DOM document or `dangerouslySetInnerHTML`.
- `/portfolio`: applies via a functional state merge at confirmation time, preserving newer edits. The editor remounts on account-scope changes; migration content is not written into another user's scope or a global persistent store.
- `portfolio-import.functions.ts`: the legacy `importPortfolio` server endpoint now fails explicitly without any fetch. The old unauthenticated scraper and remote-image import were removed.

## Verification and troubleshooting

Live isolated-browser check on September 8: `tests/portfolio-import.browser.js` passed **11 checks**. It exercised the real file inputs, permission gate, unchecked review fields, inert saved HTML, preservation of an edited name and existing photo, filling a blank headline, credential-free CSV preview/download, and zero import network calls. This verifies the local content preflight, not a provider migration, persisted website or ownership transfer.

Run `bun test tests/portfolio-import.test.ts tests/typography.test.ts`. Focused tests cover preserved edits/media, strict JSON/version rejection, credential stripping, unsafe URLs, malformed/bounded CSV, incomplete HTML tags, and 1,000 varied JSON round-trips. Typography compatibility remains covered separately. These are unit/source checks, not a claim of live browser or provider migration verification.

- **No supported page text:** the saved page may be script-rendered. Copy text manually; FOTO does not execute the page to reconstruct it.
- **Wrong CSV columns:** export folder information, not contacts or payments. Required headers are `Collection Name` and `Collection URL`.
- **Source URL mismatch:** clear the optional URL or use the address recorded in the JSON plan. The importer does not silently rewrite provenance.
- **Fields did not change:** only checked, blank fields can be filled. Existing edits are intentionally preserved.
- **Lost session preview after leaving:** no website persistence is claimed. Reopen a downloaded migration plan and reselect original photos as needed.
