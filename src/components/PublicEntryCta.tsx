import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useAccount } from "@/components/account/AccountProvider";

type Props = {
  className?: string;
  guestLabel: ReactNode;
  memberLabel: ReactNode;
  guestMode?: "signin" | "signup";
};

/** While auth is restoring, both links stay in the DOM; CSS shows Dashboard if this browser already signed in. */
export function PublicEntryCta({
  className = "",
  guestLabel,
  memberLabel,
  guestMode = "signup",
}: Props) {
  const status = useAccount()?.status;
  const guest = (
    <Link
      to="/auth"
      search={{ next: "/dashboard", mode: guestMode }}
      className={`${className} entry-guest`.trim()}
    >
      {guestLabel}
    </Link>
  );
  const member = (
    <Link to="/dashboard" className={`${className} entry-member`.trim()}>
      {memberLabel}
    </Link>
  );
  if (status === "in") return member;
  if (status === "out") return guest;
  return (
    <>
      {guest}
      {member}
    </>
  );
}
