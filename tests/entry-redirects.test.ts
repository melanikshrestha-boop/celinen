import { expect, test } from "bun:test";
import { isRedirect } from "@tanstack/react-router";
import { Route as checkout } from "../src/routes/checkout";
import { Route as login } from "../src/routes/login";
import { Route as signin } from "../src/routes/signin";
import { Route as signIn } from "../src/routes/sign-in";
import { Route as register } from "../src/routes/register";
import { Route as waitlist } from "../src/routes/waitlist";

type Entry = { options: { beforeLoad?: unknown; validateSearch?: unknown } };

function redirectOf(route: Entry, search: Record<string, unknown> = {}) {
  const validate = route.options.validateSearch as
    ((input: Record<string, unknown>) => unknown) | undefined;
  try {
    (route.options.beforeLoad as (context: { search: unknown }) => void)({
      search: validate ? validate(search) : search,
    });
  } catch (thrown) {
    if (!isRedirect(thrown)) throw thrown;
    return { status: thrown.status, to: thrown.options.to, search: thrown.options.search };
  }
  throw new Error("route rendered instead of redirecting");
}

test("/checkout is a temporary redirect to sign-up and keeps the chosen plan", () => {
  expect(redirectOf(checkout)).toEqual({
    status: 307,
    to: "/signup",
    search: { plan: "starter", billing: "yearly" },
  });
  expect(redirectOf(checkout, { plan: "pro", billing: "monthly" }).search).toEqual({
    plan: "pro",
    billing: "monthly",
  });
  expect(redirectOf(checkout, { plan: ["pro"], billing: "weekly" }).search).toEqual({
    plan: "starter",
    billing: "yearly",
  });
});

test("sign-in aliases land on /auth in the matching mode", () => {
  for (const route of [login, signin, signIn])
    expect(redirectOf(route)).toEqual({
      status: 307,
      to: "/auth",
      search: { next: "/dashboard", mode: "signin" },
    });
  expect(redirectOf(register)).toEqual({
    status: 307,
    to: "/auth",
    search: { next: "/dashboard", mode: "signup" },
  });
});

test("/waitlist opens sign-up, never a waitlist form", () => {
  expect(redirectOf(waitlist)).toEqual({
    status: 307,
    to: "/signup",
    search: { plan: "starter", billing: "yearly" },
  });
});
