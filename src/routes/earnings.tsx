import { createFileRoute } from "@tanstack/react-router";
import { EarningsWorkspace } from "@/components/earnings/EarningsWorkspace";
import { PRODUCT_HEADLINE } from "@/lib/product";
export { EarningsWorkspace } from "@/components/earnings/EarningsWorkspace";

export const Route = createFileRoute("/earnings")({
  head: () => ({
    meta: [
      { title: PRODUCT_HEADLINE },
      {
        name: "description",
        content:
          "Shoot-linked invoices, collected payments, outstanding balances and your business ledger.",
      },
    ],
  }),
  component: EarningsWorkspace,
});
