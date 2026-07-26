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

/**
 * Normalise a transcript. SRT/VTT timing is collapsed into an inline [HH:MM:SS]
 * marker rather than thrown away — the editor needs it to find segments.
 */
export function cleanTranscript(text) {
  const raw = (text || "").replace(/^WEBVTT.*$/gim, "").trim();
  const timing = /(\d{2}:\d{2}:\d{2})[.,]\d{3}\s*-->/;
  if (!timing.test(raw)) return raw.replace(/\n{3,}/g, "\n\n").trim();

  const out = [];
  let stamp = null;
  for (const line of raw.split(/\r?\n/)) {
    const t = line.match(timing);
    if (t) { stamp = t[1]; continue; }
    if (/^\d+\s*$/.test(line.trim())) continue;      // subtitle index
    const body = line.replace(/<[^>]+>/g, "").trim();  // inline tags
    if (!body) continue;
    out.push(stamp ? `[${stamp}] ${body}` : body);
    stamp = null;
  }
  return out.join("\n");
}

export function hasTimecodes(text) {
  return /\[\d{2}:\d{2}:\d{2}\]/.test(text || "");
}

/** Rough spoken duration — around 2.5 words a second. */
export function estimateSeconds(text) {
  const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.round(words / 2.5);
}

const SYSTEM_PROMPT = `You produce the complete publishing package for a news channel that posts clips of US congressional proceedings — hearings, floor debate, testimony, press gaggles, markups.

You receive a transcript of one clip and, usually, the assignment it belongs to.

WHAT THE TRANSCRIPT IS
Speaker names appear in the transcript itself, usually as labels like "SEN. DOE:" or "CHAIRMAN:". Identify speakers from the transcript. Do not expect them to be provided separately.

SOURCE TYPES
You handle two kinds of clip, and they are not the same job.

COMMITTEE — hearings, markups, oversight.
  The interesting moment is usually an exchange: a member pressing a witness, a witness conceding or refusing.
  Title should name who is questioning whom, and about what.
  Nameplates cover both the questioning member and the witness. Witness titles matter — use the supplied list.

COMMITTEE, NOMINATION HEARING — a confirmation hearing on a specific nominee.
  Frame it as a nominee being questioned about the post they are seeking, not as a generic witness.
  Say "confirmation hearing" in the title or description where it reads naturally.
  Nameplates must carry the post being sought, e.g. "Director Designate, Consumer Financial Protection Bureau".
  The description should make clear which position is at stake.
  A hearing may cover several nominees — write about whichever ones actually appear in this transcript, not the whole list.

FLOOR — Senate or House floor proceedings: speeches, debate, arguments on a measure.
  The interesting moment is usually a position being argued, not an exchange.
  Title should name the speaker and the position or measure at issue.
  Nameplates cover the speaking member. If a bill or resolution is identified, name it in the description.
  Do not describe it as a hearing, and do not invent a committee — floor proceedings have none.

THE OFFICIAL RECORD
If an official record is supplied, it is authoritative. Use its committee name, subcommittee, date and title exactly as given — do not search to second-guess them, and do not contradict them. Build "source" and "eventDate" from it directly.

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

HOUSE RULES — follow these exactly, they are not suggestions.

TITLE — the YouTube title. Up to 100 characters. Written for search and for the click, but never at the cost of accuracy. Build it from: the names of who is involved + the issue at stake + where it is happening. Descriptive, specific, no invented drama.

THUMBNAIL TEXT — a QUOTE from the transcript, 30 characters maximum. It must be words actually spoken, copied exactly, not paraphrased. Trim to the strongest fragment rather than rewording. If nothing under 30 characters works as a quote, return the shortest exact fragment that does and note the constraint in "caution".

LOWER THIRD HEADLINE — descriptive, 30 characters maximum. Says what is happening, not who is speaking.

NAME PLATES — one per key speaker, formatted exactly as:
  Full Name | Position (Party-State)
For example: Steve Daines | U.S. Senator (R-MT)
Use the position, portfolio or party affiliation that applies. For nominees use the post being sought.

TAGS — relevant search tags, 500 characters total across the whole list.

DESCRIPTION — 500 characters maximum. Strong opening line carrying the main keywords. Include the context that matters. Descriptive, not promotional.

SHORTS — find the moments inside this clip that stand alone as vertical short-form video.

What qualifies: a sharp question meeting an evasive answer; a flat refusal; an admission; a single striking line; a moment of visible friction. What does not: procedural exchanges, throat-clearing, anything that needs the surrounding context to make sense.

Rules:
- Return between 0 and 5. If nothing in this clip genuinely stands alone, return an empty array and say so in "caution". Never pad the list.
- Target 15-60 seconds of speech, roughly 40-150 words.
- Segments must not overlap. Two shorts built from the same moment compete with each other.
- "startsWith", "endsWith" and "transcript" must be copied EXACTLY from the transcript, character for character. The editor searches these strings in their edit software to find the cut — a paraphrase makes them unfindable.
- If the transcript carries [HH:MM:SS] markers, give the range in "timecode".
- Order them strongest first.

QUOTES — any time you quote, anywhere in the output, it must be the exact wording from the transcript. Never tidy, never paraphrase inside quotation marks.

Return ONLY a JSON object, no prose around it:
{
  "clipType": "what kind of moment this is, in a few words",
  "title": "YouTube title, max 100 characters",
  "titleAlternatives": ["two more options, same rules"],
  "description": "max 500 characters, plain text, no markdown",
  "tags": ["tags totalling no more than 500 characters"],
  "thumbnailText": "exact quote from the transcript, max 30 characters",
  "thumbnailPeople": ["who should appear, most important first"],
  "thumbnailVisual": "one sentence on composition and expression",
  "lowerThirdHeadline": "descriptive, max 30 characters",
  "nameplates": [{ "name": "Steve Daines", "title": "U.S. Senator (R-MT)" }],
  "eventDate": "date of the proceeding if established, else empty string",
  "shorts": [
    {
      "startsWith": "the exact first few words of the segment, copied verbatim",
      "endsWith": "the exact last few words of the segment, copied verbatim",
      "transcript": "the full segment, copied verbatim from the transcript",
      "timecode": "start - end if the transcript carries [HH:MM:SS] markers, else empty string",
      "why": "one short line on why this stands alone",
      "title": "title for this short, max 80 characters",
      "description": "one or two sentences, max 200 characters",
      "tags": ["6-10 tags"]
    }
  ],
  "caution": "one or two sentences on anything unverified, ambiguous, or any house rule you could not meet. Empty string if genuinely nothing."
}`;

export function buildPrompt(transcript, task) {
  const bits = [];
  const ev = (task && task.event) || null;
  const type = (ev && ev.sourceType) || "committee";

  if (ev) {
    const rows = [];
    if (type === "floor") {
      rows.push(`  Source type: FLOOR PROCEEDINGS`);
      if (ev.chamber) rows.push(`  Chamber: ${ev.chamber}`);
      if (ev.measure) rows.push(`  Bill or resolution: ${ev.measure}`);
    } else {
      const isNomination = ev.hearingType === "nomination";
      rows.push(`  Source type: COMMITTEE${isNomination ? ", NOMINATION HEARING" : ""}`);
      if (ev.title) rows.push(`  Hearing: ${ev.title}`);
      if (ev.committee) rows.push(`  Committee: ${ev.committee}`);
      if (ev.subcommittee) rows.push(`  Subcommittee: ${ev.subcommittee}`);
      if (ev.witnesses) {
        const label = isNomination ? "Nominees appearing" : "Witnesses";
        rows.push(`  ${label} (use these names and titles exactly):\n${ev.witnesses.split("\n").filter(Boolean).map((w) => `    - ${w.trim()}`).join("\n")}`);
      }
    }
    if (ev.congress) rows.push(`  Congress: ${ev.congress}`);
    if (ev.date) rows.push(`  Date: ${ev.date}`);
    if (ev.location) rows.push(`  Location: ${ev.location}`);
    if (ev.url) rows.push(`  Official page: ${ev.url}`);
    if (ev.source) rows.push(`  Source attribution (the editor supplies this; do not generate one): ${ev.source}`);

    if (rows.length > 1) {
      bits.push("OFFICIAL RECORD (verified — use exactly, do not search to confirm these):");
      bits.push(rows.join("\n"));
      bits.push("");
    }
  }

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
