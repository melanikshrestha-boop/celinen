import { useAccount } from "./AccountProvider";
import { workspaceLanguage, workspaceText } from "@/lib/workspace-language";
export function useWorkspaceText() {
  const value = useAccount()?.preferences.language ?? "en";
  const language = workspaceLanguage(
    value,
    typeof navigator === "undefined" ? "en" : navigator.language,
  );
  return (text: string) => workspaceText(text, language);
}
