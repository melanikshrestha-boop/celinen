/** Official transparent marks from conference sites. Never invented letter tiles. */

import { schoolMarkSrc } from "@/components/marketing/college-football";

export function UseCaseMark({ id }: { id: string }) {
  const src = schoolMarkSrc(id);
  if (src) {
    return <img src={src} alt="" />;
  }
  return null;
}
