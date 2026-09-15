import { createFileRoute, redirect } from "@tanstack/react-router";


/** Primary nav says Features; the page lives at /product. */
export const Route = createFileRoute("/features")({
  beforeLoad: () => {
    throw redirect({ to: "/product" });
  },
  component: () => null,
});
