// Claude client for turning a clip transcript into a publishing package.
//
// The API key is held in this browser only — never committed, never synced to
// Firestore. That keeps it off the public web, but anyone with access to this
// machine can read it. If that stops being acceptable, put this one fetch call
// behind a proxy that holds the key server-side.

const KEY_ANTHROPIC = "wfc_key_anthropic";
const KEY_MODEL = "wfc_ai_model";

export function getKeys() {
  try {
    return {
      anthropic: localStorage.getItem(KEY_ANTHROPIC) || "",
      model: localStorage.getItem(KEY_MODEL) || "claude-sonnet-4-6",
    };
  } catch (e) {
    return { anthropic: "", model: "claude-sonnet-4-6" };
  }
}

export function setKeys({ anthropic, model }) {
  try {
    if (anthropic !== undefined) localStorage.setItem(KEY_ANTHROPIC, anthropic);
    if (model !== undefined) localStorage.setItem(KEY_MODEL, model);
  } catch (e) { /* private browsing */ }
}

/** Strip SRT/VTT timing lines so a subtitle export can be pasted straight in. */
export function cleanTranscript(text) {
  return (text || "")
    .replace(/^WEBVTT.*$/gim, "")
    .replace(/^\d+\s*$/gm, "")                                   // subtitle indices
    .replace(/^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->.*$/gm, "")       // timing lines
    .replace(/<[^>]+>/g, "")                                     // inline tags
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const SYSTEM_PROMPT = `You produce the complete publishing package for a news channel that posts clips of US congressional proceedings — hearings, floor debate, testimony, press gaggles, markups.

You receive a transcript of one clip and, usually, the assignment it belongs to.

WHAT THE TRANSCRIPT IS
Speaker names appear in the transcript itself, usually as labels like "SEN. DOE:" or "CHAIRMAN:". Identify speakers from the transcript. Do not expect them to be provided separately.

USING WEB SEARCH
Use the search tool to verify and enrich, never to invent:
- Confirm a speaker's full name, current title, party and state.
- Confirm the correct name of the committee, subcommittee or chamber.
- Confirm bill numbers, nominee names, or agency names mentioned aloud.
- Establish the date of the proceeding if the transcript makes it identifiable.
Never search for, or include, what happened before or after the clip, other people's reactions, or subsequent developments. The package describes THIS clip only.

RULES, BECAUSE THIS IS JOURNALISM
- Every claim must come from the transcript or from a verifiable search result about identity/title/naming.
- Never invent figures, vote counts, quotes or events.
- Quote only exact words from the transcript.
- Describe what was said. Do not characterise motives, predict consequences, or take sides.
- No clickbait, no manufactured outrage, no ALL CAPS in titles.
- If you could not verify something, leave the field empty and say so in "caution" rather than guessing.

WORK OUT THE CLIP TYPE YOURSELF
Read the transcript and determine whether it is an opening statement, a question-and-answer exchange, sworn testimony, a floor speech, a gaggle response, or something else. The editor will not tell you.

Return ONLY a JSON object, no prose around it:
{
  "clipType": "what kind of moment this is, in a few words",
  "title": "the strongest title, under 70 characters, factual and specific",
  "titleAlternatives": ["two more options"],
  "description": "YouTube description. 2-4 short paragraphs of plain text, no markdown. Say what the clip shows, who speaks, and the context evident from the transcript.",
  "tags": ["12-18 lowercase search keywords"],
  "thumbnailText": "3-5 words maximum, readable at small size",
  "thumbnailPeople": ["who should appear, most important first"],
  "thumbnailVisual": "one sentence on composition, expression and any supporting imagery",
  "lowerThirdHeadline": "the chyron across the lower third, under 60 characters",
  "nameplates": [{ "name": "Sen. Jane Doe", "title": "R-TX, Judiciary Committee" }],
  "eventDate": "date of the proceeding if established, else empty string",
  "source": "attribution line, e.g. Senate Judiciary Committee hearing, 25 July 2026",
  "caution": "one or two sentences on anything unverified, ambiguous or easily misread. Empty string if genuinely nothing."
}`;

export function buildPrompt(transcript, task) {
  const bits = [];
  if (task) {
    if (task.title) bits.push(`Assignment: ${task.title}`);
    if (task.channelName) bits.push(`Channel: ${task.channelName}`);
    if (task.contentFormat) bits.push(`Format: ${task.contentFormat === "short" ? "SHORT (vertical, under 60s)" : "LONG form"}`);
    if (task.description) bits.push(`Notes from the assignment:\n${task.description}`);
  }
  const head = bits.length ? `${bits.join("\n")}\n\n` : "";
  return `${head}Transcript:\n\n${cleanTranscript(transcript)}`;
}

export async function generatePackage({ history = [], apiKey, model = "claude-sonnet-4-6" }) {
  if (!apiKey) throw new Error("Add your Anthropic API key in Profile first.");

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
      body: JSON.stringify({
        model,
        max_tokens: 3000,
        system: SYSTEM_PROMPT,
        messages: history,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
      }),
    });
  } catch (e) {
    throw new Error("Couldn't reach the Claude API — check your connection.");
  }

  if (!res.ok) {
    let detail = "";
    try { const j = await res.json(); detail = (j.error && j.error.message) || ""; } catch (e) { /* non-JSON */ }
    if (res.status === 401) throw new Error("That Anthropic API key was rejected.");
    if (res.status === 429) throw new Error("Rate limited by Anthropic — wait a moment and retry.");
    throw new Error(detail || `Claude returned ${res.status}.`);
  }

  const data = await res.json();
  // Server-side web search returns tool blocks alongside text; keep the text.
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const searchCount = (data.content || []).filter((b) => b.type === "server_tool_use").length;

  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return { raw: text, parseFailed: true, description: text, searchCount };
  }
  return { ...parsed, raw: text, searchCount };
}
