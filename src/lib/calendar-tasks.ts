export type CalendarTask = {
  id: string;
  title: string;
  done: boolean;
};

function key(scope: string) {
  return `celinen.calendar.tasks.v1:${scope}`;
}

export function readCalendarTasks(scope: string): CalendarTask[] {
  try {
    const raw = localStorage.getItem(key(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const item = row as Record<string, unknown>;
        if (typeof item.id !== "string" || typeof item.title !== "string") return null;
        return { id: item.id.slice(0, 80), title: item.title.slice(0, 200), done: item.done === true };
      })
      .filter((item): item is CalendarTask => Boolean(item))
      .slice(0, 80);
  } catch {
    return [];
  }
}

export function writeCalendarTasks(scope: string, tasks: CalendarTask[]) {
  try {
    localStorage.setItem(key(scope), JSON.stringify(tasks.slice(0, 80)));
  } catch {
    /* private mode */
  }
}
