import { ArrowLeft, ArrowRight } from "lucide-react";
import type { useSidebarHistory } from "./useSidebarHistory";

/** App navigation, not simulated native window controls. Router guards protect drafts. */
export function SidebarHistoryControls({
  navigation,
}: {
  navigation: ReturnType<typeof useSidebarHistory>;
}) {
  return (
    <div className="workbench-history-controls">
      <button
        type="button"
        aria-label="Go back"
        title="Go back"
        disabled={!navigation.canGoBack}
        onClick={navigation.back}
      >
        <ArrowLeft size={18} />
      </button>
      <button
        type="button"
        aria-label="Go forward"
        title="Go forward"
        disabled={!navigation.canGoForward}
        onClick={navigation.forward}
      >
        <ArrowRight size={18} />
      </button>
    </div>
  );
}
