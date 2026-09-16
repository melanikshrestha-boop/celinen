import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronUp, LogOut, Settings, Gauge, Cat, Send } from "lucide-react";
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
import { settingsPath, settingsSection } from "@/lib/settings-catalog";
import { InviteFriendDialog } from "./InviteFriendDialog";
import "./account.css";

export function AccountMenu() {
  const account = useAccount();
  const workbench = useWorkbench();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState(false);
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const [preferenceError, setPreferenceError] = useState("");
  const openSection = async (hash: string) => {
    const path = settingsPath(settingsSection(hash));
    if (workbench) await workbench.openTool(path);
    else {
      try {
        if (account.scope)
          sessionStorage.setItem(
            `lenslabs.settings-return:${account.scope}`,
            window.location.pathname + window.location.search,
          );
      } catch {
        /* Back still falls through to /dashboard. */
      }
      void navigate({ href: path });
    }
  };
  if (!account) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            ref={accountTrigger}
            className="account-trigger"
            aria-label={`Account menu for ${account.name}`}
          >
            <span className="account-avatar">
              {account.avatar ? <img src={account.avatar} alt="" /> : accountInitials(account.name)}
            </span>
            <span>
              {account.name}
              <small title={account.workspaceName}>{account.workspaceName}</small>
            </span>
            <ChevronUp size={15} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" sideOffset={8} className="account-menu">
          <DropdownMenuLabel className="account-menu-identity">
            <span className="account-avatar">
              {account.avatar ? <img src={account.avatar} alt="" /> : accountInitials(account.name)}
            </span>
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
            <Gauge size={16} />
            Usage
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
            <Cat size={16} />
            {account.preferences.showPet ? "Hide pet" : "Show pet"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setInvite(true);
            }}
          >
            <Send size={16} />
            Invite a friend
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              void openSection("profile");
            }}
          >
            <Settings size={16} />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfirm(true)}>
            <LogOut size={16} />
            {account.local ? "Close workspace" : "Log out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {preferenceError && (
        <p role="alert" className="account-inline-error">
          {preferenceError}
        </p>
      )}
      <InviteFriendDialog open={invite} onOpenChange={setInvite} returnFocus={accountTrigger} />
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
              {account.local ? "This profile stays on this Mac." : "This browser signs out."}
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
