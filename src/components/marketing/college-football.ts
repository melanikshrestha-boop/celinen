/** 2026 Power Four football. Official marks only — never invented tiles. */

export const BIG_TEN_TEAMS = [
  { id: "illinois", title: "Illinois" },
  { id: "indiana", title: "Indiana" },
  { id: "iowa", title: "Iowa" },
  { id: "maryland", title: "Maryland" },
  { id: "michigan", title: "Michigan" },
  { id: "michigan-state", title: "Michigan State" },
  { id: "minnesota", title: "Minnesota" },
  { id: "nebraska", title: "Nebraska" },
  { id: "northwestern", title: "Northwestern" },
  { id: "ohio-state", title: "Ohio State" },
  { id: "oregon", title: "Oregon" },
  { id: "penn-state", title: "Penn State" },
  { id: "purdue", title: "Purdue" },
  { id: "rutgers", title: "Rutgers" },
  { id: "ucla", title: "UCLA" },
  { id: "usc", title: "USC" },
  { id: "washington", title: "Washington" },
  { id: "wisconsin", title: "Wisconsin" },
] as const;

export const SEC_TEAMS = [
  { id: "alabama", title: "Alabama" },
  { id: "arkansas", title: "Arkansas" },
  { id: "auburn", title: "Auburn" },
  { id: "florida", title: "Florida" },
  { id: "georgia", title: "Georgia" },
  { id: "kentucky", title: "Kentucky" },
  { id: "lsu", title: "LSU" },
  { id: "mississippi-state", title: "Mississippi State" },
  { id: "missouri", title: "Missouri" },
  { id: "oklahoma", title: "Oklahoma" },
  { id: "ole-miss", title: "Ole Miss" },
  { id: "south-carolina", title: "South Carolina" },
  { id: "tennessee", title: "Tennessee" },
  { id: "texas", title: "Texas" },
  { id: "texas-am", title: "Texas A&M" },
  { id: "vanderbilt", title: "Vanderbilt" },
] as const;

export const ACC_TEAMS = [
  { id: "boston-college", title: "Boston College" },
  { id: "california", title: "California" },
  { id: "clemson", title: "Clemson" },
  { id: "duke", title: "Duke" },
  { id: "florida-state", title: "Florida State" },
  { id: "georgia-tech", title: "Georgia Tech" },
  { id: "louisville", title: "Louisville" },
  { id: "miami", title: "Miami" },
  { id: "nc-state", title: "NC State" },
  { id: "north-carolina", title: "North Carolina" },
  { id: "pittsburgh", title: "Pittsburgh" },
  { id: "smu", title: "SMU" },
  { id: "stanford", title: "Stanford" },
  { id: "syracuse", title: "Syracuse" },
  { id: "virginia", title: "Virginia" },
  { id: "virginia-tech", title: "Virginia Tech" },
  { id: "wake-forest", title: "Wake Forest" },
] as const;

export const BIG12_TEAMS = [
  { id: "arizona", title: "Arizona" },
  { id: "arizona-state", title: "Arizona State" },
  { id: "baylor", title: "Baylor" },
  { id: "byu", title: "BYU" },
  { id: "cincinnati", title: "Cincinnati" },
  { id: "colorado", title: "Colorado" },
  { id: "houston", title: "Houston" },
  { id: "iowa-state", title: "Iowa State" },
  { id: "kansas", title: "Kansas" },
  { id: "kansas-state", title: "Kansas State" },
  { id: "oklahoma-state", title: "Oklahoma State" },
  { id: "tcu", title: "TCU" },
  { id: "texas-tech", title: "Texas Tech" },
  { id: "ucf", title: "UCF" },
  { id: "utah", title: "Utah" },
  { id: "west-virginia", title: "West Virginia" },
] as const;

const MARK_SRC: Record<string, string> = {
  bigten: "/images/schools/bigten/conference.svg",
  sec: "/images/conferences/sec.svg",
  acc: "/images/conferences/acc.svg",
  big12: "/images/conferences/big12.svg",
};

for (const team of BIG_TEN_TEAMS) {
  MARK_SRC[team.id] = `/images/schools/bigten/${team.id}.svg`;
}
for (const team of SEC_TEAMS) {
  MARK_SRC[team.id] = `/images/schools/sec/${team.id}.png`;
}
for (const team of ACC_TEAMS) {
  MARK_SRC[team.id] = `/images/schools/acc/${team.id}.png`;
}
for (const team of BIG12_TEAMS) {
  MARK_SRC[team.id] = `/images/schools/big12/${team.id}.png`;
}

export function schoolMarkSrc(id: string): string | undefined {
  return MARK_SRC[id];
}
