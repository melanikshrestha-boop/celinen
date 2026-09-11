import { createFileRoute, redirect } from "@tanstack/react-router";

/** Intake forms are the opposite of the product. Open a shoot instead. */
export const Route = createFileRoute("/book")({
  beforeLoad: () => {
    throw redirect({ to: "/shoots" });
  },
  component: () => null,
});
