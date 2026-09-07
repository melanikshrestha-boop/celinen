import { analyseFilePreview } from "@/lib/imaging";
import type { AnalysisRequest, AnalysisResponse } from "./analysis-client";

// Keep worker types isolated so the app's DOM TypeScript library remains unchanged.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<AnalysisRequest>) => void) | null;
  postMessage: (message: AnalysisResponse) => void;
};

scope.onmessage = async ({ data }) => {
  try {
    const result = await analyseFilePreview(data.file);
    scope.postMessage({ id: data.id, result });
  } catch (error) {
    scope.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : "Photo analysis failed.",
    });
  }
};
