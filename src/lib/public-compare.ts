/** Public photography comparisons. Claims dated September 2026. Do not mark unshipped work as ours. */

export type CompareWin = "us" | "even" | "them";

export type CompareRow = {
  us: string;
  them: string;
  win: CompareWin;
};

export type CompareEntry = {
  id: string;
  name: string;
  mark: string;
  href: string;
  blurb: string;
  verdict: string;
  lede: string;
  checked: string;
  sources: string;
  rows: readonly CompareRow[];
  chooseUs: readonly string[];
  chooseThem: readonly string[];
};

export const COMPARE_ENTRIES = [
  {
    id: "aftershoot",
    name: "Aftershoot",
    mark: "aftershoot",
    href: "https://aftershoot.com",
    blurb: "AI culling and editing sold as separate modules, now with galleries on top.",
    verdict:
      "The fastest first pass on a huge card. Then you still need a gallery, a Lightroom path, and a product that does not split cull, edit, and retouch into three SKUs.",
    lede:
      "Aftershoot is the AI cull everyone names. Selects starts around $10/mo for culling; Complete bundles cull, edit, and retouch near $45/mo billed annually. Galleries are a newer layer. celinen is the rest of the night: pick you still own, same-night gallery, Lightroom, Stripe books, and MCP — not a cull add-on sitting next to Pixieset.",
    checked: "aftershoot.com and aftershoot.com/pricing, checked September 2026",
    sources:
      "Aftershoot figures are taken from aftershoot.com, aftershoot.com/pricing, and aftershoot.com/blog as of September 2026 and may have changed since — check aftershoot.com for their current terms. Aftershoot is their trademark, not ours, and this page is not affiliated with or endorsed by them.",
    rows: [
      {
        us: "Hobby USD 20/mo — pick, gallery, roster/jersey on every paid plan. Cull, edit, and send are not three add-ons.",
        them: "Selects ~$10/mo for culling. Edit and retouch are separate modules. Complete ~$45/mo billed annually.",
        win: "us",
      },
      {
        us: "Suggested rejects. You keep the last word on every keeper.",
        them: "AI cull and duplicate grouping as the product. Fast first pass; the model is the author unless you fight it.",
        win: "us",
      },
      {
        us: "Originals stay on your machine unless you export them. A sent gallery is a copy, not a backup of the shoot.",
        them: "Desktop cull can run locally. Galleries still upload a delivery set.",
        win: "even",
      },
      {
        us: "Import → Pick → Lightroom → Send. Same-night gallery is the point.",
        them: "Cull and edit are the point. Galleries launched later as a second product.",
        win: "us",
      },
      {
        us: "College football, jersey/bib, roster on every paid plan.",
        them: "Sports notes exist. Jersey-to-gallery the same night is not the product.",
        win: "us",
      },
      {
        us: "Lightroom Classic and Photoshop on the connectors. Your look stays with the photograph.",
        them: "Export to Lightroom, Capture One, and Photoshop. Develop is their own RAW workspace.",
        win: "even",
      },
      {
        us: "MCP on Creator — Claude, ChatGPT, Cursor, Grok. The studio is callable.",
        them: "No photographer MCP advertised.",
        win: "us",
      },
      {
        us: "Encrypted social login, then post after the edit. We do not post to an account you have not connected.",
        them: "Not a social publisher.",
        win: "us",
      },
      {
        us: "Stripe books: collected, expenses, invoices.",
        them: "Print store on Galleries. Studio books are not the cull product.",
        win: "us",
      },
      {
        us: "Face naming is not shipped. A face count in cull is not a name.",
        them: "Key-face detection and gallery face find on Aftershoot Galleries.",
        win: "them",
      },
      {
        us: "No print lab network. Galleries are photographs you send.",
        them: "Galleries with proofing and a print store.",
        win: "them",
      },
      {
        us: "One photography plan. Not cull / edit / retouch as three Aftershoot-style add-ons.",
        them: "Modular SKUs. Cheap if you only cull. Expensive once you stack the night.",
        win: "us",
      },
    ],
    chooseUs: [
      "The job is camera → gallery tonight, not a cull sitting next to three other tabs",
      "You want suggestions, not a model that authors the set",
      "Sports, jersey, and roster are the Saturday",
      "You want Lightroom, Stripe, and MCP in the same product",
      "You refuse to buy cull, edit, and retouch as three subscriptions",
    ],
    chooseThem: [
      "You only need a desktop AI first-pass on a 5,000-frame card",
      "You already have Pixieset and Lightroom and just want Selects at $10/mo",
      "You want their gallery face-find for clients",
    ],
  },
  {
    id: "imagen",
    name: "Imagen",
    mark: "imagen",
    href: "https://imagen-ai.com",
    blurb: "Cloud AI editing trained on your catalog, billed per photo or as a bundle.",
    verdict:
      "The best personal-profile editor in this list. Then you still pick, send, and invoice somewhere else — and a Saturday of 8,000 frames is a cloud bill.",
    lede:
      "Imagen is the edit that learns you. Pay-as-you-go starts near $0.05/photo with a monthly minimum; Limitless sits near $179/mo billed annually. Culling is in the cloud. celinen is local pick, same-night send, and an editor that does not meter your Saturday.",
    checked: "imagen-ai.com, checked September 2026",
    sources:
      "Imagen figures are taken from imagen-ai.com as of September 2026 and may have changed since — check imagen-ai.com for their current terms. Imagen is their trademark, not ours, and this page is not affiliated with or endorsed by them.",
    rows: [
      {
        us: "Hobby USD 20/mo. Credits are the plan, not a per-frame tax on a football Saturday.",
        them: "Pay-as-you-go ~$0.05/photo plus a monthly minimum, or Limitless ~$179/mo billed annually.",
        win: "us",
      },
      {
        us: "Suggested rejects. You mark keepers.",
        them: "Cloud culling plus editing. Fast if the upload is fast.",
        win: "us",
      },
      {
        us: "Originals stay on your machine.",
        them: "Cloud processing. A stadium with bad wifi is not their product.",
        win: "us",
      },
      {
        us: "Same-night gallery in the same app.",
        them: "Edit is the product. Delivery is Lightroom or someone else.",
        win: "us",
      },
      {
        us: "Your look stays with the photograph in Develop. Lightroom Classic is a connector.",
        them: "Personal AI profiles trained on your catalog — the strongest edit-consistency story here.",
        win: "them",
      },
      {
        us: "College football and jersey/bib on every paid plan.",
        them: "Volume weddings and portraits. Sideline roster is not the pitch.",
        win: "us",
      },
      {
        us: "MCP on Creator.",
        them: "No photographer MCP advertised.",
        win: "us",
      },
      {
        us: "Encrypted socials, then post after the edit.",
        them: "Not a publisher.",
        win: "us",
      },
      {
        us: "Stripe books in-product.",
        them: "Not a studio ledger.",
        win: "us",
      },
      {
        us: "Develop is yours. We do not meter 8,000 sideline frames as AI credits per file.",
        them: "Per-photo editing is honest if you shoot 400 frames. It is a tax if you shoot 8,000.",
        win: "us",
      },
    ],
    chooseUs: [
      "You shoot volume and refuse a per-photo cloud bill",
      "The night has to leave the building as a gallery, not as an XMP sidecar",
      "You want the pick and the send in the same product",
      "Sideline, jersey, roster",
    ],
    chooseThem: [
      "You already cull in Photo Mechanic and only want an AI profile that matches last season’s catalog",
      "You are happy uploading the shoot to their cloud",
    ],
  },
  {
    id: "pixieset",
    name: "Pixieset",
    mark: "pixieset",
    href: "https://pixieset.com",
    blurb: "Client galleries, a photographer site, and a store — the delivery tab everyone already has.",
    verdict:
      "The prettiest client gallery in the category. Then you still cull and edit in two other products, and Studio Manager is another SKU.",
    lede:
      "Pixieset is how a lot of weddings get seen. Plus starts near $8–10/mo billed annually; Pro near $24/mo; Ultimate near $40/mo billed annually after the 2026 increase. Photo Editor is an add-on. celinen is the work before the pretty link — pick, develop, send — without a second subscription for the studio desk.",
    checked: "pixieset.com/pricing, checked September 2026",
    sources:
      "Pixieset figures are taken from pixieset.com/pricing as of September 2026 and may have changed since — check pixieset.com for their current terms. Pixieset is their trademark, not ours, and this page is not affiliated with or endorsed by them.",
    rows: [
      {
        us: "Hobby USD 20/mo includes pick and send. Not a gallery plan plus an editor add-on.",
        them: "Gallery plans from ~$8/mo billed annually. Photo Editor ~$12 extra. Studio Manager is separate.",
        win: "us",
      },
      {
        us: "Import → Pick → Send. The gallery is the keepers you chose tonight.",
        them: "Upload a finished set. Cull and color live somewhere else.",
        win: "us",
      },
      {
        us: "Masters stay with you. The client gets a published copy.",
        them: "Storage-based hosting. Ultimate is unlimited storage after the 2026 price rise.",
        win: "even",
      },
      {
        us: "Passcode, favourites, downloads. Find me by name or jersey.",
        them: "Mature client galleries, selection, and a polished download flow.",
        win: "even",
      },
      {
        us: "No photographer website builder. The product is the work, not a template site.",
        them: "Built-in website builder and custom domains.",
        win: "them",
      },
      {
        us: "No print lab store. Stripe invoices live on Earnings.",
        them: "Print store and fulfillment. Commission on lower plans.",
        win: "them",
      },
      {
        us: "Sports roster and jersey on every paid plan.",
        them: "Galleries for every job type. Sideline tools are not the product.",
        win: "us",
      },
      {
        us: "MCP on Creator.",
        them: "No photographer MCP advertised.",
        win: "us",
      },
      {
        us: "Encrypted social login after the edit.",
        them: "Not a social publisher.",
        win: "us",
      },
      {
        us: "Lightroom Classic connector. Develop in-product.",
        them: "You edit in Lightroom, then upload.",
        win: "us",
      },
    ],
    chooseUs: [
      "You are tired of cull in one app, color in another, Pixieset last",
      "Tonight is the deadline, not next week’s upload",
      "Sports and jersey matter",
      "You want MCP and Stripe in the photography product",
    ],
    chooseThem: [
      "You only need a client gallery and a photographer website",
      "Print store and lab fulfillment are the business",
      "The set is already culled and edited before it arrives",
    ],
  },
  {
    id: "shootproof",
    name: "ShootProof",
    mark: "shootproof",
    href: "https://www.shootproof.com",
    blurb: "Proofing, labs, contracts, and invoicing — studio delivery with a photo-count ceiling.",
    verdict:
      "The lab network is real. The $15 plan that holds 100 photos is not a wedding. We send the set you picked without metering the card.",
    lede:
      "ShootProof is the proofing incumbent: contracts, invoices, and 30+ labs. Plans still talk in photo counts — cheap tiers are hundreds of frames, unlimited sits near $45–50/mo. celinen does not price your Saturday by how many keepers you dared to upload.",
    checked: "shootproof.com, checked September 2026",
    sources:
      "ShootProof figures are taken from shootproof.com as of September 2026 and may have changed since — check shootproof.com for their current terms. ShootProof is their trademark, not ours, and this page is not affiliated with or endorsed by them.",
    rows: [
      {
        us: "Hobby USD 20/mo. Credits, not a 100-photo ceiling.",
        them: "Tiers from ~$15/mo / 100 photos up to ~$45–50/mo unlimited. Photo-count plans punish a football card.",
        win: "us",
      },
      {
        us: "Pick in-product, then send.",
        them: "Upload a finished gallery. Cull lives elsewhere.",
        win: "us",
      },
      {
        us: "No 30-lab print network.",
        them: "WHCC, Mpix, Bay Photo and a long lab list. Contracts and invoicing on paid plans.",
        win: "them",
      },
      {
        us: "Stripe books on Earnings.",
        them: "Invoices and contracts in the studio suite.",
        win: "even",
      },
      {
        us: "Same-night gallery. Originals stay with you.",
        them: "Hosted proofing. Archiving and photo limits are the fine print.",
        win: "us",
      },
      {
        us: "Jersey / roster.",
        them: "Not a sideline product.",
        win: "us",
      },
      {
        us: "MCP on Creator.",
        them: "No photographer MCP advertised.",
        win: "us",
      },
      {
        us: "Lightroom connector plus Develop.",
        them: "You finish in Lightroom, then upload.",
        win: "us",
      },
      {
        us: "Encrypted socials after the edit.",
        them: "Not a publisher.",
        win: "us",
      },
      {
        us: "Video is not the client gallery. We say so.",
        them: "Limited video on delivery plans.",
        win: "even",
      },
    ],
    chooseUs: [
      "You shoot more frames than their starter photo cap",
      "The bottleneck is picking, not which lab prints the 8×10",
      "You want one product from card to link",
    ],
    chooseThem: [
      "Print labs and in-gallery contracts are the studio",
      "You already have a cull and you only need proofing",
    ],
  },
  {
    id: "photo-mechanic",
    name: "Photo Mechanic",
    mark: "photomechanic",
    href: "https://home.camera-bits.com",
    blurb: "The ingest and IPTC station sports desks actually run.",
    verdict:
      "Nothing here ingests a CF card faster. Then you still color, send, and invoice in four other windows. We are the night after the ingest.",
    lede:
      "Photo Mechanic is the yellow station at every sideline. About $149/year for Plus. Captions, IPTC, contact sheets, terrifying speed. It is not a gallery, not Develop, not Stripe, not MCP. celinen does not pretend to beat Camera Bits on ingest. We beat the pile of apps that starts after it.",
    checked: "home.camera-bits.com, checked September 2026",
    sources:
      "Photo Mechanic figures are taken from home.camera-bits.com as of September 2026 and may have changed since — check Camera Bits for their current terms. Photo Mechanic is their trademark, not ours, and this page is not affiliated with or endorsed by them.",
    rows: [
      {
        us: "Hobby USD 20/mo for the rest of the path.",
        them: "Photo Mechanic Plus ~$149/year. One job: ingest, tag, cull fast.",
        win: "even",
      },
      {
        us: "We do not claim CF-card ingest faster than Photo Mechanic. That would be a lie.",
        them: "The fastest ingest and browse in working sports.",
        win: "them",
      },
      {
        us: "Jersey/bib from the roster onto frames. Find me in the gallery.",
        them: "Variables, IPTC, code replacements — the caption station wire desks trust.",
        win: "them",
      },
      {
        us: "Suggested rejects, you keep the last word. Then Develop and Send.",
        them: "Manual cull at speed. No AI author. No gallery.",
        win: "us",
      },
      {
        us: "Same-night client gallery.",
        them: "Export to FTP, PhotoShelter, or whoever still takes the wire.",
        win: "us",
      },
      {
        us: "Develop + Lightroom Classic connector.",
        them: "Not a RAW editor.",
        win: "us",
      },
      {
        us: "MCP on Creator.",
        them: "No MCP.",
        win: "us",
      },
      {
        us: "Stripe books.",
        them: "Not a studio ledger.",
        win: "us",
      },
      {
        us: "Encrypted socials after the edit.",
        them: "Not a publisher.",
        win: "us",
      },
      {
        us: "Originals stay local. The whole path is one product.",
        them: "Local, fast, and then you open three more apps.",
        win: "us",
      },
    ],
    chooseUs: [
      "The card is in. The athletic department wants a gallery before the bus leaves",
      "You want IPTC-class tagging without living in a 1990s station for the send",
      "You want MCP, Stripe, and Lightroom attached to the pick",
    ],
    chooseThem: [
      "You are a wire desk and ingest speed is the whole job",
      "You already have a caption preset library from 2009 and it still works",
    ],
  },
  {
    id: "lightroom",
    name: "Lightroom Classic",
    mark: "lightroom",
    href: "https://www.adobe.com/products/photoshop-lightroom-classic.html",
    blurb: "The catalog every photographer already pays Adobe for.",
    verdict:
      "The develop ecosystem is theirs. The same-night gallery, the jersey, the MCP, and the books are not. We connect to Classic. We do not pretend to replace twenty years of plugins.",
    lede:
      "Lightroom Classic is the catalog. Photography plans start near $10–20/mo in a Creative Cloud bundle, and the real cost is Photoshop sitting next to it. Tethering, masking, denoise, a plugin universe. celinen ships a Lightroom connector on purpose. Classic wins the catalog. We win the night you have to send.",
    checked: "adobe.com, checked September 2026",
    sources:
      "Adobe figures are taken from adobe.com as of September 2026 and may have changed since — check adobe.com for their current terms. Adobe, Lightroom, and Photoshop are their trademarks, not ours, and this page is not affiliated with or endorsed by Adobe.",
    rows: [
      {
        us: "Hobby USD 20/mo for pick, gallery, roster. Creator adds Adobe-path priority.",
        them: "Photography plan ~$10–20/mo in a CC bundle. You still buy a gallery and a cull.",
        win: "us",
      },
      {
        us: "Smart cull with you as the author, then send.",
        them: "No native AI cull. You flag in the filmstrip or buy Aftershoot.",
        win: "us",
      },
      {
        us: "Develop is in-product. Classic remains a connector — we do not rip your catalog out.",
        them: "The deepest catalog, masking, denoise, and plugin list in photography.",
        win: "them",
      },
      {
        us: "No world-class tethering. We do not fake a Capture One station.",
        them: "Tethered capture in Classic. Good enough for a lot of rooms.",
        win: "them",
      },
      {
        us: "Same-night gallery. Originals stay yours.",
        them: "Publish services exist. A client proofing gallery is not the product.",
        win: "us",
      },
      {
        us: "Jersey / roster.",
        them: "Keywords if you type them. Not a sideline roster.",
        win: "us",
      },
      {
        us: "MCP on Creator.",
        them: "No photographer MCP for cull-to-gallery.",
        win: "us",
      },
      {
        us: "Stripe books.",
        them: "Not a ledger.",
        win: "us",
      },
      {
        us: "Encrypted socials after the edit.",
        them: "Share to Adobe services. Not a social desk.",
        win: "us",
      },
      {
        us: "Photoshop on the connectors. We do not invert their logo.",
        them: "Photoshop is the retouch cathedral.",
        win: "even",
      },
    ],
    chooseUs: [
      "Classic is staying. You want the send, the jersey, and the books without another five tabs",
      "You want MCP on the photography product",
      "Tonight is the deadline",
    ],
    chooseThem: [
      "The catalog is the studio and you live in Develop",
      "You need tethering and a plugin that only exists for Classic",
      "You are not sending a client gallery tonight",
    ],
  },
  {
    id: "capture-one",
    name: "Capture One",
    mark: "captureone",
    href: "https://www.captureone.com",
    blurb: "Tethered color for rooms that cannot miss a frame.",
    verdict:
      "If the job is a studio tether, they win. If the job is 8,000 sideline frames out before midnight, they are the wrong window.",
    lede:
      "Capture One is color and tether. Perpetual licenses have lived near $299; subscriptions near $179/year depending on the SKU. Sessions, tethered proofing, the look fashion rooms pay for. celinen does not fake a tether station. We win the volume night Capture One was never priced to finish.",
    checked: "captureone.com, checked September 2026",
    sources:
      "Capture One figures are taken from captureone.com as of September 2026 and may have changed since — check captureone.com for their current terms. Capture One is their trademark, not ours, and this page is not affiliated with or endorsed by them.",
    rows: [
      {
        us: "Hobby USD 20/mo.",
        them: "Subscription or perpetual. More expensive before you have sent a gallery.",
        win: "us",
      },
      {
        us: "No fashion-room tether. We say so.",
        them: "Industry tethering and session workflow.",
        win: "them",
      },
      {
        us: "Develop is in-product. We do not claim their color science.",
        them: "The color people mean when they say color.",
        win: "them",
      },
      {
        us: "Smart cull, you keep the last word, same-night gallery.",
        them: "No AI cull product. No client gallery product.",
        win: "us",
      },
      {
        us: "Jersey / roster.",
        them: "Not a sideline roster.",
        win: "us",
      },
      {
        us: "MCP on Creator.",
        them: "No photographer MCP advertised.",
        win: "us",
      },
      {
        us: "Stripe books.",
        them: "Not a ledger.",
        win: "us",
      },
      {
        us: "Lightroom Classic connector for people who still live there. Capture One export is not our religion.",
        them: "A catalog for people who left Adobe.",
        win: "even",
      },
      {
        us: "Encrypted socials after the edit.",
        them: "Not a publisher.",
        win: "us",
      },
      {
        us: "Originals stay local. The send is the product.",
        them: "Local, beautiful, and then you still need Pixieset.",
        win: "us",
      },
    ],
    chooseUs: [
      "The job is volume, not a tethered lookbook",
      "You need a gallery tonight",
      "You want MCP and books on the photography OS",
    ],
    chooseThem: [
      "The camera is on a cable and the art director is watching the screen",
      "Color is the product and you already paid for the license",
    ],
  },
  {
    id: "cloudspot",
    name: "CloudSpot",
    mark: "cloudspot",
    href: "https://www.cloudspot.io",
    blurb: "Galleries, CRM, and sales for studios that already finished the cull.",
    verdict:
      "A solid studio desk for people who already picked. We pick, then send, then invoice — without a second home for the files.",
    lede:
      "CloudSpot is galleries plus studio CRM on paid plans, free-to-$50/mo depending on the desk you turn on. It assumes the set exists. celinen is how the set exists at 11pm.",
    checked: "cloudspot.io, checked September 2026",
    sources:
      "CloudSpot figures are taken from cloudspot.io as of September 2026 and may have changed since — check cloudspot.io for their current terms. CloudSpot is their trademark, not ours, and this page is not affiliated with or endorsed by them.",
    rows: [
      {
        us: "Hobby USD 20/mo includes the pick.",
        them: "Free to ~$50/mo. CRM and contracts unlock as you climb.",
        win: "us",
      },
      {
        us: "Pick in-product.",
        them: "Upload a finished set.",
        win: "us",
      },
      {
        us: "Passcode galleries, favourites, downloads.",
        them: "Client galleries and sales. Mature enough.",
        win: "even",
      },
      {
        us: "Stripe books. Not a full CRM.",
        them: "CRM, contracts, questionnaires on paid plans.",
        win: "them",
      },
      {
        us: "Jersey / roster.",
        them: "Not a sideline product.",
        win: "us",
      },
      {
        us: "MCP on Creator.",
        them: "No photographer MCP advertised.",
        win: "us",
      },
      {
        us: "Lightroom connector + Develop.",
        them: "You finish elsewhere, then upload.",
        win: "us",
      },
      {
        us: "Encrypted socials after the edit.",
        them: "Not a publisher.",
        win: "us",
      },
      {
        us: "Originals stay with you.",
        them: "Hosted delivery.",
        win: "us",
      },
      {
        us: "No print-lab maze. We invoice in Stripe.",
        them: "Sales tools on paid plans.",
        win: "them",
      },
    ],
    chooseUs: [
      "The set does not exist until you pick it",
      "Sports, MCP, Lightroom, send",
    ],
    chooseThem: [
      "You already culled and you want CRM + galleries in one desk",
    ],
  },
  {
    id: "pic-time",
    name: "Pic-Time",
    mark: "pictime",
    href: "https://www.pic-time.com",
    blurb: "Galleries built to sell prints, albums, and vendor upsells.",
    verdict:
      "If the business is a store, they are the store. If the business is getting the keepers out tonight, they are waiting on a zip you have not made.",
    lede:
      "Pic-Time is delivery as commerce: stores, albums, vendor copy, automation. Plans free-to-about $42/mo billed yearly. celinen does not pretend to be a print mall. We pretend to get Saturday off the card.",
    checked: "pic-time.com, checked September 2026",
    sources:
      "Pic-Time figures are taken from pic-time.com as of September 2026 and may have changed since — check pic-time.com for their current terms. Pic-Time is their trademark, not ours, and this page is not affiliated with or endorsed by them.",
    rows: [
      {
        us: "Hobby USD 20/mo for pick and send.",
        them: "Free to ~$42/mo billed yearly, aimed at store volume.",
        win: "us",
      },
      {
        us: "No album/print automation mall.",
        them: "Prints, albums, vendor galleries, upsells — the store is the product.",
        win: "them",
      },
      {
        us: "Pick in-product, same night.",
        them: "Upload a finished set.",
        win: "us",
      },
      {
        us: "Jersey / roster.",
        them: "Not a sideline roster.",
        win: "us",
      },
      {
        us: "MCP on Creator.",
        them: "No photographer MCP advertised.",
        win: "us",
      },
      {
        us: "Stripe books for the work, not a print SKU grid.",
        them: "Store commerce is deeper than our invoices.",
        win: "them",
      },
      {
        us: "Lightroom + Develop.",
        them: "You finish elsewhere.",
        win: "us",
      },
      {
        us: "Encrypted socials after the edit.",
        them: "Not a publisher.",
        win: "us",
      },
      {
        us: "Originals stay with you.",
        them: "Hosted storefronts.",
        win: "us",
      },
      {
        us: "Credits, not a store commission maze.",
        them: "Selling is the point, and the take-rate is the fine print.",
        win: "them",
      },
    ],
    chooseUs: [
      "You need the keepers out, not a mall",
      "Sports and MCP",
    ],
    chooseThem: [
      "Albums, prints, and vendor copy pay the rent",
      "The cull is already done",
    ],
  },
  {
    id: "smugmug",
    name: "SmugMug",
    mark: "smugmug",
    href: "https://www.smugmug.com",
    blurb: "Unlimited hosting and a public site for photographers who archive in public.",
    verdict:
      "Unlimited hosting is theirs. The pick, the jersey, and tonight’s gallery are not. We are not a second Flickr.",
    lede:
      "SmugMug is the long archive: unlimited photos on paid plans, SEO pages, a site that stays up. About $20–37/mo billed annually. celinen is not competing for your 2008 portfolio URL. We are competing for the two hours after the whistle.",
    checked: "smugmug.com, checked September 2026",
    sources:
      "SmugMug figures are taken from smugmug.com as of September 2026 and may have changed since — check smugmug.com for their current terms. SmugMug is their trademark, not ours, and this page is not affiliated with or endorsed by them.",
    rows: [
      {
        us: "Hobby USD 20/mo for the working path.",
        them: "Paid plans ~$20–37/mo billed annually with unlimited photo hosting.",
        win: "even",
      },
      {
        us: "No unlimited public archive. A gallery is a send, not a second website.",
        them: "Unlimited hosting and a public photographer site.",
        win: "them",
      },
      {
        us: "Pick in-product.",
        them: "Upload what you already picked.",
        win: "us",
      },
      {
        us: "Same-night private gallery, passcode.",
        them: "Public and private sharing. Proofing is not the sport.",
        win: "us",
      },
      {
        us: "Jersey / roster.",
        them: "Not a sideline roster.",
        win: "us",
      },
      {
        us: "MCP on Creator.",
        them: "No photographer MCP advertised.",
        win: "us",
      },
      {
        us: "Lightroom + Develop.",
        them: "Publish from Lightroom. The cull is still yours to suffer.",
        win: "us",
      },
      {
        us: "Stripe books.",
        them: "Prints and a store exist. Not a working ledger for the job.",
        win: "us",
      },
      {
        us: "Encrypted socials after the edit.",
        them: "Share pages. Not a social desk.",
        win: "us",
      },
      {
        us: "Originals stay with you. We do not want to host 2008.",
        them: "The long archive is the product.",
        win: "them",
      },
    ],
    chooseUs: [
      "You need tonight, not a public archive of every JPEG since 2011",
      "Sports, pick, send, MCP",
    ],
    chooseThem: [
      "Unlimited hosting and SEO pages are the business",
      "You already picked and you want the photos to live on the open web",
    ],
  },
] as const satisfies readonly CompareEntry[];

export type CompareId = (typeof COMPARE_ENTRIES)[number]["id"];

export function findCompare(id: string) {
  return COMPARE_ENTRIES.find((item) => item.id === id);
}

export function compareTally(rows: readonly CompareRow[]) {
  return {
    us: rows.filter((row) => row.win === "us").length,
    even: rows.filter((row) => row.win === "even").length,
    them: rows.filter((row) => row.win === "them").length,
  };
}

export function compareTotals() {
  return COMPARE_ENTRIES.reduce(
    (sum, item) => {
      const tally = compareTally(item.rows);
      return { us: sum.us + tally.us, even: sum.even + tally.even, them: sum.them + tally.them };
    },
    { us: 0, even: 0, them: 0 },
  );
}
