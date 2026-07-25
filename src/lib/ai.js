// Clients for Claude (metadata + commentary) and ElevenLabs (voiceover).
//
// Keys are held in this browser only — never committed, never synced to
// Firestore, never sent anywhere but the API they belong to. That keeps them
// off the public web, but anyone with access to this machine can read them.
// If that stops being acceptable, move these two fetch calls behind a proxy
// that holds the keys server-side; nothing else here needs to change.

const KEY_ANTHROPIC = "wfc_key_anthropic";
const KEY_ELEVEN = "wfc_key_eleven";
const KEY_VOICE = "wfc_voice_id";

export function getKeys() {
  try {
    return {
      anthropic: localStorage.getItem(KEY_ANTHROPIC) || "",
      eleven: localStorage.getItem(KEY_ELEVEN) || "",
      voiceId: localStorage.getItem(KEY_VOICE) || "",
    };
  } catch (e) {
    return { anthropic: "", eleven: "", voiceId: "" };
  }
}

export function setKeys({ anthropic, eleven, voiceId }) {
  try {
    if (anthropic !== undefined) localStorage.setItem(KEY_ANTHROPIC, anthropic);
    if (eleven !== undefined) localStorage.setItem(KEY_ELEVEN, eleven);
    if (voiceId !== undefined) localStorage.setItem(KEY_VOICE, voiceId);
  } catch (e) { /* private browsing */ }
}

const SYSTEM_PROMPT = `You prepare YouTube publishing material for a news channel that posts clips of US congressional proceedings — hearings, floor debate, testimony, press gaggles.

You are given a transcript of one clip plus whatever context the editor supplied. The context is verified fact from the editor; the transcript is the primary source.

Absolute rules, because this is journalism:
- Use ONLY the transcript and the supplied context. Never introduce facts, figures, bill numbers, vote counts, dates, job titles or events from your own knowledge.
- Where the editor gave you names, titles, party or state, use them exactly as given.
- If the transcript is ambiguous about who said something or what was meant, say so plainly rather than resolving it.
- No invented quotes. Quote only exact words from the transcript.
- Describe what happened. Don't characterise motives, predict consequences, or take a side.
- Plain description over dramatic framing. No clickbait, no manufactured outrage, no ALL CAPS.

For SHORT format: titles punchier and under 60 characters, description two sentences, commentary 30-45 words.
For LONG format: titles under 70 characters, description 2-4 short paragraphs, commentary 60-90 words.

Return ONLY a JSON object, no prose around it:
{
  "titles": ["three alternative titles"],
  "description": "plain text, no markdown",
  "tags": ["10-15 lowercase search keywords"],
  "commentary": "voiceover script to play AFTER the clip. Written to be read aloud: short sentences, no headings, no stage directions.",
  "caution": "one sentence if anything is unclear, garbled or easily misread. Otherwise empty string."
}`;

function buildContextBlock(ctx) {
  if (!ctx) return "";
  const lines = [];
  if (ctx.eventType) lines.push(`Event type: ${ctx.eventType}`);
  if (ctx.body) lines.push(`Body / committee: ${ctx.body}`);
  if (ctx.date) lines.push(`Date: ${ctx.date}`);
  if (ctx.subject) lines.push(`Subject: ${ctx.subject}`);
  if (ctx.speakers && ctx.speakers.length) {
    const named = ctx.speakers.filter((sp) => sp.name && sp.name.trim());
    if (named.length) {
      lines.push("Speakers (use these names and titles exactly):");
      named.forEach((sp) => lines.push(`  - ${sp.name}${sp.role ? ` — ${sp.role}` : ""}`));
    }
  }
  if (ctx.hook) lines.push(`Why the editor selected this clip: ${ctx.hook}`);
  if (ctx.format) lines.push(`Format: ${ctx.format === "short" ? "SHORT (vertical, under 60s)" : "LONG form"}`);
  if (ctx.channel) lines.push(`Channel: ${ctx.channel}`);
  return lines.length ? `Verified context from the editor:\n${lines.join("\n")}\n\n` : "";
}

export function buildPrompt(transcript, ctx) {
  return `${buildContextBlock(ctx)}Transcript of the clip:\n\n${(transcript || "").trim()}`;
}

/**
 * Ask Claude for publishing material based on a transcript.
 * `history` lets the editor refine the result conversationally.
 */
export async function generateMetadata({ transcript, history = [], apiKey, model = "claude-sonnet-4-6" }) {
  if (!apiKey) throw new Error("Add your Anthropic API key in Profile first.");

  const messages = history.length
    ? history
    : [{ role: "user", content: `Transcript of the clip:\n\n${transcript}` }];

  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model, max_tokens: 2000, system: SYSTEM_PROMPT, messages }),
    });
  } catch (e) {
    throw new Error("Couldn't reach the Claude API — check your connection.");
  }

  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = (j.error && j.error.message) || "";
    } catch (e) { /* non-JSON error body */ }
    if (res.status === 401) throw new Error("That Anthropic API key was rejected.");
    if (res.status === 429) throw new Error("Rate limited by Anthropic — wait a moment and retry.");
    throw new Error(detail || `Claude returned ${res.status}.`);
  }

  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();

  // The model is told to return bare JSON, but strip fences defensively.
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    // Don't lose the work if the shape is off — hand back the raw text.
    return { raw: text, titles: [], description: text, tags: [], commentary: "", caution: "" };
  }
  return {
    titles: parsed.titles || [],
    description: parsed.description || "",
    tags: parsed.tags || [],
    commentary: parsed.commentary || "",
    caution: parsed.caution || "",
    raw: text,
  };
}

/** Turn the commentary script into speech. Returns a Blob of audio. */
export async function synthesiseVoice({ text, apiKey, voiceId }) {
  if (!apiKey) throw new Error("Add your ElevenLabs API key in Profile first.");
  if (!voiceId) throw new Error("Add an ElevenLabs voice ID in Profile first.");

  let res;
  try {
    res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: "POST",
      headers: { "content-type": "application/json", "xi-api-key": apiKey },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
  } catch (e) {
    throw new Error("Couldn't reach ElevenLabs — check your connection.");
  }

  if (!res.ok) {
    if (res.status === 401) throw new Error("That ElevenLabs API key was rejected.");
    if (res.status === 422) throw new Error("ElevenLabs rejected that voice ID.");
    throw new Error(`ElevenLabs returned ${res.status}.`);
  }
  return res.blob();
}
