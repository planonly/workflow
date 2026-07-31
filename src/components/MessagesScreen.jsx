import React, { useState, useRef, useEffect } from "react";
import { COLORS, displayNameFor } from "../lib/core";
import { dmRoomId, formatMessageTime, formatDayDivider } from "../lib/messaging";
import { HomeIcon, ChatIcon } from "./Icon";

function initials(name) {
  return (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function RoomRow({ room, active, meta, unread, onClick }) {
  const preview = meta && meta.lastMessageText;
  return (
    <button onClick={onClick}
      style={{ backgroundColor: active ? COLORS.tealSoft : "transparent", borderColor: active ? COLORS.teal : "transparent" }}
      className="w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all hover:brightness-110">
      <div style={{ backgroundColor: room.roomType === "channel" ? COLORS.tealSoft : COLORS.violetSoft, color: room.roomType === "channel" ? COLORS.teal : COLORS.violet }}
        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-bold text-xs">
        {room.roomType === "channel" ? <ChatIcon size={16} /> : initials(room.name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p style={{ color: COLORS.textPrimary }} className="text-sm font-semibold truncate">{room.name}</p>
          {meta && meta.lastMessageAt && (
            <span style={{ color: COLORS.textFaint }} className="font-mono text-[10px] shrink-0">{formatMessageTime(meta.lastMessageAt)}</span>
          )}
        </div>
        <p style={{ color: COLORS.textFaint }} className="text-xs truncate mt-0.5">
          {preview ? `${meta.lastMessageSenderName ? meta.lastMessageSenderName + ": " : ""}${preview}` : "No messages yet"}
        </p>
      </div>
      {unread && <span style={{ backgroundColor: COLORS.teal }} className="w-2 h-2 rounded-full shrink-0" />}
    </button>
  );
}

function MessageBubble({ msg, mine, showSender }) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"} mb-1.5`}>
      <div className="max-w-[75%]">
        {!mine && showSender && (
          <p style={{ color: COLORS.textFaint }} className="text-[10px] font-mono mb-0.5 ml-1">{msg.senderName}</p>
        )}
        <div
          style={{
            backgroundColor: mine ? COLORS.teal : COLORS.bgElevated,
            color: mine ? "#04211D" : COLORS.textPrimary,
          }}
          className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words ${mine ? "rounded-br-sm" : "rounded-bl-sm"}`}>
          {msg.text}
        </div>
        <p style={{ color: COLORS.textFaint }} className={`text-[10px] font-mono mt-0.5 ${mine ? "text-right mr-1" : "ml-1"}`}>
          {formatMessageTime(msg.createdAt)}
        </p>
      </div>
    </div>
  );
}

export default function MessagesScreen({ user, profiles, channelRooms, dmTargets, activeRoom, onSelectRoom, messages, roomMeta, myRoomReads, onSendMessage, onBack }) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, activeRoom]);

  const dmRooms = dmTargets.map((t) => ({
    roomId: dmRoomId(user.uid, t.uid), roomType: "dm", otherUid: t.uid, name: t.name,
  }));

  const isUnread = (roomId) => {
    const m = roomMeta[roomId];
    if (!m || !m.lastMessageAt || m.lastMessageSenderUid === user.uid) return false;
    const lastRead = myRoomReads[roomId];
    return !lastRead || m.lastMessageAt > lastRead;
  };

  const send = () => {
    if (!draft.trim() || !activeRoom) return;
    onSendMessage(activeRoom, draft);
    setDraft("");
  };

  return (
    <div className="h-screen flex flex-col max-w-6xl w-full mx-auto px-6 py-8 sm:py-10 overflow-hidden fade-in">
      <style>{`
        @keyframes msg-rise { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
        .msg-rise { animation: msg-rise .25s ease-out both; }
        @media (prefers-reduced-motion: reduce) { .msg-rise { animation: none !important; } }
      `}</style>

      <div className="flex items-center justify-between mb-6 shrink-0">
        <h2 style={{ color: COLORS.textPrimary }} className="text-2xl sm:text-3xl font-bold">Messages</h2>
        <button onClick={onBack} aria-label="Home" style={{ borderColor: COLORS.border, color: COLORS.textMuted }}
          className="rounded-full border p-2 hover:opacity-80 transition-opacity"><HomeIcon size={18} /></button>
      </div>

      <div className="flex-1 grid md:grid-cols-[280px_1fr] gap-4 min-h-0">
        {/* ---------- room list ---------- */}
        <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }}
          className={`rounded-2xl border p-3 flex-col gap-4 overflow-y-auto ${activeRoom ? "hidden md:flex" : "flex"}`}>
          {channelRooms.length > 0 && (
            <div>
              <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase px-2 mb-1.5">Team</p>
              <div className="flex flex-col gap-1">
                {channelRooms.map((r) => (
                  <RoomRow key={r.roomId} room={r} active={activeRoom && activeRoom.roomId === r.roomId}
                    meta={roomMeta[r.roomId]} unread={isUnread(r.roomId)} onClick={() => onSelectRoom(r)} />
                ))}
              </div>
            </div>
          )}
          {dmRooms.length > 0 && (
            <div>
              <p style={{ color: COLORS.textFaint }} className="font-mono text-[10px] tracking-[0.15em] uppercase px-2 mb-1.5">Direct messages</p>
              <div className="flex flex-col gap-1">
                {dmRooms.map((r) => (
                  <RoomRow key={r.roomId} room={r} active={activeRoom && activeRoom.roomId === r.roomId}
                    meta={roomMeta[r.roomId]} unread={isUnread(r.roomId)} onClick={() => onSelectRoom(r)} />
                ))}
              </div>
            </div>
          )}
          {channelRooms.length === 0 && dmRooms.length === 0 && (
            <p style={{ color: COLORS.textFaint }} className="text-xs px-2">No conversations available yet.</p>
          )}
        </div>

        {/* ---------- conversation ---------- */}
        <div style={{ backgroundColor: COLORS.bgCard, borderColor: COLORS.border }}
          className={`rounded-2xl border flex-col min-h-0 ${activeRoom ? "flex" : "hidden md:flex"}`}>
          {!activeRoom ? (
            <div className="flex-1 flex items-center justify-center text-center px-6">
              <div>
                <ChatIcon size={28} style={{ color: COLORS.textFaint }} />
                <p style={{ color: COLORS.textFaint }} className="text-sm mt-3">Pick a conversation to start.</p>
              </div>
            </div>
          ) : (
            <>
              <div style={{ borderColor: COLORS.border }} className="border-b px-4 py-3 flex items-center gap-2 shrink-0">
                <button onClick={() => onSelectRoom(null)} aria-label="Back to list" style={{ color: COLORS.textMuted }} className="md:hidden p-1 -ml-1">
                  <HomeIcon size={16} />
                </button>
                <p style={{ color: COLORS.textPrimary }} className="font-semibold text-sm">{activeRoom.name}</p>
              </div>
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
                {messages.length === 0 ? (
                  <p style={{ color: COLORS.textFaint }} className="text-xs text-center mt-6">No messages yet — say hello.</p>
                ) : (
                  messages.map((m, i) => {
                    const prev = messages[i - 1];
                    const newDay = !prev || formatDayDivider(prev.createdAt) !== formatDayDivider(m.createdAt);
                    const showSender = !prev || prev.senderUid !== m.senderUid || newDay;
                    return (
                      <div key={m.id} className="msg-rise">
                        {newDay && (
                          <div className="flex items-center gap-2 my-3">
                            <div style={{ backgroundColor: COLORS.border }} className="h-px flex-1" />
                            <span style={{ color: COLORS.textFaint }} className="font-mono text-[10px]">{formatDayDivider(m.createdAt)}</span>
                            <div style={{ backgroundColor: COLORS.border }} className="h-px flex-1" />
                          </div>
                        )}
                        <MessageBubble msg={m} mine={m.senderUid === user.uid} showSender={showSender} />
                      </div>
                    );
                  })
                )}
              </div>
              <div style={{ borderColor: COLORS.border }} className="border-t p-3 flex items-center gap-2 shrink-0">
                <input value={draft} onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Message…" style={{ backgroundColor: COLORS.bgElevated, borderColor: COLORS.border, color: COLORS.textPrimary }}
                  className="flex-1 rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:ring-2" />
                <button onClick={send} disabled={!draft.trim()}
                  style={{ backgroundColor: COLORS.teal, color: "#04211D", opacity: draft.trim() ? 1 : 0.4 }}
                  className="rounded-xl px-4 py-2.5 text-sm font-bold shrink-0 transition-all">
                  Send
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
