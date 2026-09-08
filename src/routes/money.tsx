import { createFileRoute } from "@tanstack/react-router";
import { EarningsWorkspace } from "./earnings";
export const Route = createFileRoute("/money")({
  head: () => ({ meta: [{ title: "Money — FOTO" }] }),
  component: EarningsWorkspace,
});
