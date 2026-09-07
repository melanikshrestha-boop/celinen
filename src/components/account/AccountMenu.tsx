import { useEffect, useState } from "react";
import { ChevronUp, LogOut, Settings, UserRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useWorkbench } from "@/components/workbench/context";
import { accountInitials } from "@/lib/account-preferences";
import { useAccount } from "./AccountProvider";
import "./account.css";

export function AccountMenu() {
  const account = useAccount();
  const workbench = useWorkbench();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        void workbench?.openTool("/settings");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [workbench]);
  if (!account) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="account-trigger" aria-label={`Account menu for ${account.name}`}>
            <span className="account-avatar">{accountInitials(account.name)}</span>
            <span>
              {account.name}
              <small>{account.local ? "On this device" : "Personal workspace"}</small>
            </span>
            <ChevronUp size={15} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" sideOffset={8} className="account-menu">
          <DropdownMenuLabel className="account-menu-identity">
            <span className="account-avatar">{accountInitials(account.name)}</span>
            <span>
              {account.name}
              <small>
                {account.local ? "Local profile · no cloud account" : account.user?.email}
              </small>
            </span>
          </DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={() => {
              void workbench?.openTool("/settings");
            }}
          >
            <UserRound size={17} />
            Your profile
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              void workbench?.openTool("/settings");
            }}
          >
            <Settings size={17} />
            Settings<kbd>⌘,</kbd>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfirm(true)}>
            <LogOut size={17} />
            {account.local ? "Close local workspace" : "Log out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {account.error && (
        <p className="account-inline-error" role="alert">
          {account.error}
        </p>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="account-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {account.local ? "Close this workspace?" : "Log out on this browser?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Saved photos and chats are kept. Unfinished work is checked before you leave.
              {account.local
                ? " You can reopen this local profile without a password."
                : " Your other devices stay signed in."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Stay here</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                setBusy(true);
                void account
                  .signOut()
                  .then((done) => {
                    if (done) setConfirm(false);
                  })
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Saving…" : account.local ? "Close workspace" : "Log out"}
            </AlertDialogAction>
          </AlertDialogFooter>
          {account.error && <p role="alert">{account.error}</p>}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
