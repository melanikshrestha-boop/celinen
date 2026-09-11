import { createFileRoute } from "@tanstack/react-router";
import { BookSite } from "@/components/studio-desk/BookSite";
import { PRODUCT_NAME } from "@/lib/product";

export const Route = createFileRoute("/book-site")({
  head: () => ({
    meta: [
      { title: `Book — ${PRODUCT_NAME}` },
      {
        name: "description",
        content: "College football photography sessions. Times follow the timezone you confirm.",
      },
    ],
  }),
  component: BookSite,
});
