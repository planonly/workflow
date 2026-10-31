// The one definition of task priority order, shared by every screen that
// lists tasks. Priority is set per person on the Tasks screen (each
// person's own queue is numbered from 1), so "in priority order" always
// means: grouped by person, each person's tasks in their own queue order.
// Two screens keeping their own copy of this is how Clip Studio ended up
// ordering tasks differently from the Tasks screen — hence one copy.

import { displayNameFor } from "./core";

// A person's queue order: manual position first (tasks never ranked sort
// after ranked ones), then newest first as the tiebreak.
export function sortByOrder(arr) {
  return [...arr].sort((a, b) => {
    const ao = a.order != null ? a.order : Infinity;
    const bo = b.order != null ? b.order : Infinity;
    if (ao !== bo) return ao - bo;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
}

// One person's FULL queue — done tasks included, since they keep their slot
// and the rank numbers on the Tasks screen count them.
export function queueFor(tasks, uidVal) {
  return sortByOrder((tasks || []).filter((t) => t.assignedToUid === uidVal));
}

// The number shown on the task's card in the Tasks screen.
export function rankOf(tasks, task) {
  return queueFor(tasks, task.assignedToUid).findIndex((t) => t.id === task.id) + 1;
}

// Studio's task picker, as groups: each person's unfinished tasks in their
// own priority order (people ordered by name, same as the Tasks screen),
// then — only when includeDone — one "Done" group, most recently finished
// first. Each entry carries the same rank number the Tasks screen shows.
//
// labelled is false when there's nothing to tell groups apart (one person,
// no done group), so a single editor's own list renders flat.
export function pickerGroups(tasks, { includeDone, profiles } = {}) {
  const all = tasks || [];
  const active = all.filter((t) => t.status !== "done");
  const byPerson = {};
  active.forEach((t) => { (byPerson[t.assignedToUid] = byPerson[t.assignedToUid] || []).push(t); });
  const nameOf = (u) => displayNameFor(u, profiles);
  const people = Object.keys(byPerson).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  const groups = people.map((u) => ({
    key: u,
    label: nameOf(u),
    items: sortByOrder(byPerson[u]).map((t) => ({ task: t, rank: rankOf(all, t) })),
  }));

  if (includeDone) {
    const done = all.filter((t) => t.status === "done").sort((a, b) => {
      // Tasks finished before completion times were recorded have no doneAt;
      // they sort after the dated ones, in queue order.
      const ad = a.doneAt ? new Date(a.doneAt).getTime() : -Infinity;
      const bd = b.doneAt ? new Date(b.doneAt).getTime() : -Infinity;
      if (ad !== bd) return bd - ad;
      return sortByOrder([a, b])[0] === a ? -1 : 1;
    });
    if (done.length) groups.push({ key: "__done", label: "Done", done: true, items: done.map((t) => ({ task: t, rank: null })) });
  }

  return { groups, labelled: groups.length > 1 || !!(includeDone && groups.some((g) => g.done)) };
}
