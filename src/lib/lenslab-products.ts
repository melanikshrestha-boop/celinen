/** LensLab is the company. Celinen and Heavenly are the named products. */
export const COMPANY_NAME = "LensLab";

export const LENS_PRODUCTS = [
  {
    id: "celinen",
    name: "Celinen",
    kind: "Photo agent",
    to: "/product/celinen",
    next: "/dashboard",
  },
  {
    id: "heavenly",
    name: "Heavenly",
    kind: "Video agent",
    to: "/product/heavenly",
    next: "/video",
  },
] as const;

export type LensProduct = (typeof LENS_PRODUCTS)[number];
export type LensProductId = LensProduct["id"];
