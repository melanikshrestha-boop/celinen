# FOTO Photo Lab

FOTO combines a local photography workspace, Cull/Develop editing, and client and
earnings tools. This repository is a source checkpoint, not confirmation that the
latest code is published at a hosted URL or that the complete product plan is
finished. Native processing currently runs only through the local macOS engine.

## Current local workflow

Open a shoot from `/shoots`, then use its Cull and Develop tabs. Both now consume
the same account-and-shoot-scoped canonical photo records, review metadata and
saved treatment documents. Flush guards and revision checks protect saves when
navigating or receiving another tab's changes. Original bytes and full source
fingerprints are retained; import does not move or overwrite files on disk.

Legacy Studio records are imported merge-only with their original IDs, metadata
and archived edit intent. Existing Develop histories are preserved. Unsupported
legacy settings, unresolved crop intent and historical Studio versions are not
silently represented as equivalent native renders; the old stores remain intact.
Current canonical treatment is authoritative for Develop editing/export.

Import reports **Found**, **Preview Ready**, **Saved** and **Analyzed** separately.
Found means registered browser file handles, not decoded RAWs or a durable save.
Any registration-speed target applies only to discovery, not those later stages.
Saved follows the atomic storage commit; new-import analysis remains pending,
without invented quality scores. Imports can continue between local workspace
pages, but a reload requires reselecting source files to resume unfinished work.
Native source registration/receipt reuse is not yet implemented: a saved source
does not imply later native renders reuse a registered source handle.

The local lab identity is not owner authentication. Hosted owner login, authorized
publication and a real Google sign-in round trip remain separate verification
gates. The OAuth boundary checks the installed account session, but local tests
are not evidence of a successful live provider login. Website import previews do
not publish a portfolio or transfer domain/account ownership. Full Lightroom or
Pixieset parity is not claimed.

## Run locally on macOS

Requires Node.js/npm, Apple's Command Line Tools and the pinned native dependency.
Keep local environment configuration private; do not include environment files,
original photos or generated binaries in a source handoff.

```sh
npm i
sh native/bootstrap-libraw.sh
make -C native -j4
npm run dev:lab
```

Open `http://127.0.0.1:8085/shoots`. The lab configuration is loopback-only and
intentionally separate from the authenticated production configuration. Use
`npm run dev` for the latter's development server; `npm run build` builds a web
bundle, not a hosted native service or desktop installer.

## Implementation and verification notes

- [Current Develop capabilities and explicit parity gaps](docs/FOTO-DEVELOP-PARITY.md)
- [Import, rendering and histogram performance evidence](docs/FOTO-DEVELOP-PERFORMANCE.md)
- [Dated Develop milestones and verification boundaries](docs/FOTO-DEVELOP-SPRINT.md)
- [Native build, source limits and historical transport reference](native/README.md)
- [Client infrastructure, local receipts and message handoff](docs/FOTO-CLIENT-INFRASTRUCTURE.md)
- [Earnings sources and accounting boundaries](docs/earnings-workflow.md)
- [Website-content import: supported files and limits](docs/FOTO-WEBSITE-IMPORT.md)

Counts and benchmark results in those documents belong to their dated runs, not
automatically to the current checkout. A private Git push, successful web build,
local native test and verified hosted deployment are different milestones.

## Original project brief and Lovable handoff (historical)

The original brief and setup notes below are retained for provenance. They are
not a statement of current feature completion or hosted deployment status.

Create a very smart AI calling website and call it Lens OS. It should have all the pricing and stuff, exactly like how Grok has pricing for photographers. It should create AI calls that can hang up on any kind of photos, call really fast, and do the basics that Lightroom currently has, like all the basic tools. It's going to be really hard to make, so take as long as you need and create the first thing. I have about 300 photos to get through, including raw images, and it's going to be a pain in my ass. I need you to make sure the software itself works first.

This project was built with [Lovable](https://lovable.dev).

**Original hosted app address (current checkpoint not verified there)**:
https://intelligent-image-aid.lovable.app

### Original Lovable instructions

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/90a3d4fe-ecf0-4ee7-8a26-d2bff0b4545c).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

### Original web-only development instructions

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
