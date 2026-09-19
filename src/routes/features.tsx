import { createFileRoute, redirect } from "@tanstack/react-router";


/** Primary nav says Features; Celinen features live on the Celinen product page. */
export const Route = createFileRoute("/features")({
  beforeLoad: () => {
    throw redirect({ to: "/product/celinen" });
  },
  component: () => null,
});
