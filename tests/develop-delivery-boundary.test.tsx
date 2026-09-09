import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DevelopPage } from "../src/components/develop/DevelopPage";
import { DeliveryVersionBoundary } from "../src/components/develop/DeliveryVersionBoundary";

describe("exact delivery references cannot fall through to the working Develop recipe", () => {
  const projectId = "eeaf3000-1111-4222-8333-193901d95331";
  const frameId = `frame:${"long-existing-id/".repeat(75)}?source=original&v=1`;

  test.each(["historical-v1", "latest-v2"])(
    "%s stays outside editor, storage, and export hooks until exact native version support exists",
    (versionId) => {
      // No router, account, IndexedDB, or native processing provider is installed:
      // a delivery-only reference must be fenced BEFORE any editor hooks mount.
      const html = renderToStaticMarkup(
        <DevelopPage
          scope="isolated-delivery-boundary-test"
          projectId={projectId}
          deliveryFocus={{ frameId, versionId, handoffId: "reviewed-handoff" }}
        />,
      );
      expect(html).toContain("Exact Version Not Available in Develop");
      expect(html).toContain('role="alert"');
      expect(html).toContain(versionId);
      expect(html).not.toContain("Opening Develop");
      expect(html).not.toContain('type="file"');
      expect(html).not.toContain("Export Preview");
      expect(html).not.toContain('aria-label="Exposure"');
      const href = html.match(/data-working-edit="true" href="([^"]+)"/)?.[1];
      expect(href).toBeDefined();
      const url = new URL(href!.replaceAll("&amp;", "&"), "https://foto.invalid");
      expect(decodeURIComponent(url.pathname)).toBe(`/shoots/project:${projectId}/develop`);
      expect(url.searchParams.get("photo")).toBe(`studio:${frameId}`);
      expect([...url.searchParams.keys()]).toEqual(["photo"]);
      expect(html).toContain("Open Current Working Edit");
      expect(html).toContain("This leaves the requested delivery version");
    },
  );

  test.each([1994, 2000, 4200])(
    "preserves a %i-character frame without truncating or crashing",
    (length) => {
      const exact = "f".repeat(length);
      const html = renderToStaticMarkup(
        <DevelopPage
          scope="isolated-delivery-boundary-test"
          projectId={projectId}
          deliveryFocus={{ frameId: exact, versionId: "v1" }}
        />,
      );
      const href = html.match(/data-working-edit="true" href="([^"]+)"/)![1]!;
      expect(new URL(href, "https://foto.invalid").searchParams.get("photo")).toBe(
        `studio:${exact}`,
      );
    },
  );

  test("invalid references stay fenced without a fallback link", () => {
    for (const id of ["", " ", "f".repeat(4201)]) {
      const html = renderToStaticMarkup(
        <DevelopPage
          scope="isolated-delivery-boundary-test"
          projectId={projectId}
          deliveryFocus={{ frameId: id, versionId: "<script>never execute</script>" }}
        />,
      );
      expect(html).toContain('role="alert"');
      expect(html).not.toContain("data-working-edit");
      expect(html).not.toContain("<script>");
    }
  });

  test("shared boundary never renders a hidden controller that could adopt the current recipe", () => {
    let mounts = 0;
    function LegacyController() {
      mounts++;
      return <span>Legacy controller</span>;
    }
    const focused = renderToStaticMarkup(
      <DeliveryVersionBoundary projectId={projectId} deliveryFocus={{ frameId, versionId: "v1" }}>
        <LegacyController />
      </DeliveryVersionBoundary>,
    );
    expect(mounts).toBe(0);
    expect(focused).not.toContain("Legacy controller");
    const working = renderToStaticMarkup(
      <DeliveryVersionBoundary projectId={projectId}>
        <LegacyController />
      </DeliveryVersionBoundary>,
    );
    expect(mounts).toBe(1);
    expect(working).toContain("Legacy controller");
  });
});
