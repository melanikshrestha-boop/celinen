import { useEffect, useRef } from "react";
import { observeMarketingReveals } from "@/lib/marketing-motion";
import "./marketing-motion.css";

export function useMarketingMotion(key?: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) return observeMarketingReveals(ref.current);
    return undefined;
  }, [key]);
  return ref;
}
