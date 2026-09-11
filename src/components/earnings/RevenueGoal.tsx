import { useState } from "react";
import {
  parseGoalInput,
  remainingPerMonth,
  REVENUE_GOAL_CHIPS_USD,
  dollarsToMinor,
  suggestGoalMinor,
} from "@/lib/revenue-goal";

export function RevenueGoal({
  year,
  today,
  collectedMinor,
  goalMinor,
  money,
  onGoal,
  onAsk,
  askBusy = false,
}: {
  year: number;
  today: string;
  collectedMinor: number;
  goalMinor: number | null;
  money: (minor: number) => string;
  onGoal: (minor: number) => void;
  onAsk?: (amount: string) => void;
  askBusy?: boolean;
}) {
  const [custom, setCustom] = useState("");
  const [ask, setAsk] = useState("");
  const suggested = suggestGoalMinor(collectedMinor, today);
  const goal = goalMinor && goalMinor > 0 ? goalMinor : null;
  const ratio = goal ? Math.min(1, Math.max(0, collectedMinor / goal)) : 0;
  const leftover = goal ? remainingPerMonth(goal, collectedMinor, today) : 0;
  return (
    <div className="finance-os__goal-row">
      <article className="finance-os__card finance-os__goal">
        <h2>{year}</h2>
        {goal ? (
          <>
            <p className="finance-os__figure">
              {money(collectedMinor)} <span>/ {money(goal)}</span>
            </p>
            <div
              className="finance-os__goal-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={goal}
              aria-valuenow={Math.min(collectedMinor, goal)}
              aria-label={`${year} collected`}
            >
              <span style={{ width: `${Math.round(ratio * 100)}%` }} />
            </div>
            {leftover > 0 ? <p className="finance-os__vs">{money(leftover)} / mo</p> : null}
          </>
        ) : (
          <>
            <p className="finance-os__figure">{money(collectedMinor)}</p>
            <div className="finance-os__goal-chips" role="group" aria-label={`${year} target`}>
              {REVENUE_GOAL_CHIPS_USD.map((dollars) => {
                const minor = dollarsToMinor(dollars);
                return (
                  <button
                    key={dollars}
                    type="button"
                    aria-pressed={minor === suggested}
                    onClick={() => onGoal(minor)}
                  >
                    {dollars / 1000}k
                  </button>
                );
              })}
            </div>
          </>
        )}
        <form
          className="finance-os__goal-custom"
          onSubmit={(event) => {
            event.preventDefault();
            const minor = parseGoalInput(custom);
            if (minor) {
              onGoal(minor);
              setCustom("");
            }
          }}
        >
          <input
            inputMode="decimal"
            autoComplete="off"
            aria-label={`${year} target amount`}
            placeholder={goal ? "Change" : "or type"}
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
          />
        </form>
      </article>
      {onAsk && (
        <article className="finance-os__card finance-os__pay">
          <h2>Ask</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!ask.trim() || askBusy) return;
              onAsk(ask);
              setAsk("");
            }}
          >
            <input
              inputMode="decimal"
              autoComplete="off"
              aria-label="Amount to request"
              placeholder="0"
              value={ask}
              disabled={askBusy}
              onChange={(event) => setAsk(event.target.value)}
            />
            <button type="submit" disabled={askBusy || !ask.trim()}>
              Save
            </button>
          </form>
        </article>
      )}
    </div>
  );
}
