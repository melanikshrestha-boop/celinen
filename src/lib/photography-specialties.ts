/** Curated from PPA's public specialty taxonomy, with common commercial subfields.
 * https://www.findaphotographer.com/search
 * Stable IDs are private profile metadata, never permissions or public listings.
 */
export const PHOTOGRAPHY_SPECIALTIES = [
  {
    group: "People & portraits",
    items: [
      ["portrait", "Portrait"],
      ["headshot", "Headshot"],
      ["personal-branding", "Personal branding"],
      ["family", "Family"],
      ["maternity", "Maternity"],
      ["newborn", "Newborn"],
      ["children", "Children & teens"],
      ["senior", "Senior & graduation"],
      ["school", "School & yearbook"],
      ["boudoir", "Boudoir"],
    ],
  },
  {
    group: "Weddings & events",
    items: [
      ["wedding", "Wedding"],
      ["elopement", "Elopement"],
      ["engagement", "Engagement & couples"],
      ["event", "Event"],
      ["corporate-event", "Corporate event"],
      ["concert", "Concert & live performance"],
    ],
  },
  {
    group: "Commercial & editorial",
    items: [
      ["commercial", "Commercial & advertising"],
      ["product", "Product & e-commerce"],
      ["food", "Food & beverage"],
      ["fashion", "Fashion"],
      ["beauty", "Beauty"],
      ["editorial", "Editorial"],
      ["automotive", "Automotive"],
      ["jewelry", "Jewelry"],
      ["industrial", "Industrial"],
      ["stock", "Stock"],
    ],
  },
  {
    group: "Spaces & property",
    items: [
      ["real-estate", "Real estate"],
      ["architecture", "Architecture"],
      ["interiors", "Interiors"],
      ["hospitality", "Hotels & hospitality"],
      ["drone", "Drone & aerial"],
      ["virtual-tour", "360° & virtual tours"],
    ],
  },
  {
    group: "Nature & adventure",
    items: [
      ["landscape", "Landscape"],
      ["wildlife", "Wildlife"],
      ["nature", "Nature"],
      ["travel", "Travel"],
      ["adventure", "Adventure"],
      ["underwater", "Underwater"],
      ["astrophotography", "Astrophotography"],
      ["macro", "Macro"],
      ["pet", "Pet"],
      ["equestrian", "Equestrian"],
    ],
  },
  {
    group: "Sport, stories & art",
    items: [
      ["sports", "Sports & action"],
      ["youth-sports", "Youth sports"],
      ["documentary", "Documentary"],
      ["photojournalism", "Photojournalism"],
      ["street", "Street"],
      ["fine-art", "Fine art"],
      ["still-life", "Still life"],
    ],
  },
  {
    group: "Specialist & motion",
    items: [
      ["scientific", "Scientific & medical"],
      ["forensic", "Forensic"],
      ["restoration", "Photo restoration"],
      ["videography", "Videography & filmmaking"],
      ["wedding-film", "Wedding videography"],
      ["other", "Other / write your own"],
    ],
  },
] as const;

export const MAX_SPECIALTIES = 5;
const labels = new Map<string, string>(
  PHOTOGRAPHY_SPECIALTIES.flatMap<readonly [string, string]>(({ items }) => [...items]),
);
export const isPhotographySpecialty = (id: string) => labels.has(id);
export const photographySpecialtyLabel = (id: string) => labels.get(id) ?? id;
