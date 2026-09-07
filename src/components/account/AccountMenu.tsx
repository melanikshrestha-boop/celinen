import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronUp, LogOut, Settings, Gauge, Cat, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
  const navigate = useNavigate();
  const [invite, setInvite] = useState(false);
  const [inviteNote, setInviteNote] = useState("");
  const [preferenceError, setPreferenceError] = useState("");
  const openSection = async (hash: string) => {
    if (await workbench?.openTool("/settings"))
      await navigate({ search: true, hash, replace: true });
  };
  if (!account) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="account-trigger" aria-label={`Account menu for ${account.name}`}>
            <span className="account-avatar">{accountInitials(account.name)}</span>
            <span>
              {account.name}
              <small title={account.workspaceName}>{account.workspaceName}</small>
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
              void openSection("usage");
            }}
          >
            <Gauge size={17} />
            Usage <kbd>{account.local ? "Local" : "Storage"}</kbd>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              try {
                account.savePreferences({ showPet: !account.preferences.showPet });
                setPreferenceError("");
              } catch {
                setPreferenceError("Could not save the pet preference.");
              }
            }}
          >
            <Cat size={17} />
            {account.preferences.showPet ? "Hide pet" : "Show pet"}
            <kbd>⌃Space</kbd>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setInvite(true);
              setInviteNote("");
            }}
          >
            <Send size={17} />
            Invite a friend
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              void openSection("general");
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
      {preferenceError && (
        <p role="alert" className="account-inline-error">
          {preferenceError}
        </p>
      )}
      <Dialog open={invite} onOpenChange={setInvite}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a friend</DialogTitle>
            <DialogDescription>
              Share LensLabs. This link opens the public website, not your private shoots.
            </DialogDescription>
          </DialogHeader>
          <input
            aria-label="LensLabs invitation link"
            value="https://lenslab.dev/"
            readOnly
            onFocus={(event) => event.target.select()}
            className="settings-shortcut-search"
          />
          <button
            className="settings-button primary"
            onClick={() => {
              void navigator.clipboard
                .writeText("https://lenslab.dev/")
                .then(() => setInviteNote("Link copied"))
                .catch(() => setInviteNote("Select the link above and copy it manually."));
            }}
          >
            Copy link
          </button>
          <p role="status">{inviteNote}</p>
        </DialogContent>
      </Dialog>
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
