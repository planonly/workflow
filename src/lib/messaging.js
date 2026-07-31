// Room ID conventions for the messaging system. These strings are only for
// grouping/querying — the actual security boundary is enforced by the
// explicit channelId / participantUids fields on each message doc, checked
// directly in Firestore rules. Never derive access decisions from parsing
// these strings; they're a convenience key, not a security mechanism.

export function channelRoomId(channelId) {
  return `channel_${channelId}`;
}

export function dmRoomId(uidA, uidB) {
  return `dm_${[uidA, uidB].sort().join("_")}`;
}

export function isDmRoom(roomId) {
  return typeof roomId === "string" && roomId.startsWith("dm_");
}

export function formatMessageTime(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " +
        d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch (e) { return ""; }
}

export function formatDayDivider(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return "Today";
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  } catch (e) { return ""; }
}
