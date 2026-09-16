import { createServerFn } from "@tanstack/react-start";

/** Compatibility endpoint: live scraping is deliberately disabled. No network request occurs. */
export const importPortfolio = createServerFn({ method: "POST" })
  .inputValidator((_data: unknown) => null)
  .handler(async () => {
    throw new Error(
      "Live website cloning is not supported. Open Portfolio import and choose saved HTML, a Pixieset folder CSV, or a Celinen migration-plan JSON to review locally.",
    );
  });

/** Existing editor styling is independent from content migration. */
export interface ImportedTheme {
  bg: string;
  ink: string;
  accent: string | null;
  headingFont: string;
  bodyFont: string;
  serif: boolean;
  uppercaseNav: boolean;
  layout: "grid" | "stack" | "masonry";
}
