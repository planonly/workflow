// Claude client for turning a clip transcript into a publishing package.
//
// The API key is held in this browser only — never committed, never synced to
// Firestore. That keeps it off the public web, but anyone with access to this
// machine can read it. If that stops being acceptable, put this one fetch call
// behind a proxy that holds the key server-side.

const KEY_ANTHROPIC = "wfc_key_anthropic";
const KEY_MODEL = "wfc_ai_model";
const KEY_ADOPTS = "wfc_ad_options";

// YouTube's self-certification categories, in the order they appear in Studio.
// Each is a radio group running from mildest to most severe, plus "none".
export const AD_CATEGORIES = [
  ["Inappropriate language", "profanity in title, thumbnail or content"],
  ["Adult content", "sexual behaviour, language or expressions"],
  ["Violence", "situations showing hurt, damage or injury"],
  ["Shocking content", "situations that may upset, disgust or shock"],
  ["Harmful acts and unreliable claims", "situations that may endanger participants"],
  ["Recreational drugs content", "recreational use of drugs"],
  ["Enabling dishonest behaviour", "glorifying or promoting dishonest behaviour"],
  ["Hateful and derogatory content", "hate, disparagement or harassment"],
  ["Firearms-related content", "showing or discussion of real or fake guns"],
  ["Sensitive events", "war, death or tragedy"],
  ["Controversial issues", "sensitive topics that could be traumatic to viewers"],
];

export function getKeys() {
  try {
    return {
      anthropic: localStorage.getItem(KEY_ANTHROPIC) || "",
      model: localStorage.getItem(KEY_MODEL) || "claude-sonnet-4-6",
      adOptions: localStorage.getItem(KEY_ADOPTS) || "",
    };
  } catch (e) {
    return { anthropic: "", model: "claude-sonnet-4-6", adOptions: "" };
  }
}

export function setKeys({ anthropic, model, adOptions }) {
  try {
    if (anthropic !== undefined) localStorage.setItem(KEY_ANTHROPIC, anthropic);
    if (model !== undefined) localStorage.setItem(KEY_MODEL, model);
    if (adOptions !== undefined) localStorage.setItem(KEY_ADOPTS, adOptions);
  } catch (e) { /* private browsing */ }
}

/**
 * Normalise a transcript. SRT/VTT timing is collapsed into an inline [HH:MM:SS]
 * marker rather than thrown away — the editor needs it to find segments.
 */
export function cleanTranscript(text) {
  const raw = (text || "").replace(/^WEBVTT.*$/gim, "").trim();

  // Premiere Pro's transcript export: a semicolon-delimited timecode RANGE
  // line ("00;00;00;08 - 00;00;23;29"), then a bare speaker-name line, then
  // the spoken text, then a blank line, repeating. Nothing like SRT/VTT
  // structurally — no index number, no arrow, frame numbers instead of
  // milliseconds, and speaker names on their own line instead of inline —
  // so it needs its own parser rather than being forced through the
  // SRT/VTT path below, which never recognized this format as timed at all.
  const premiereRange = /^(\d{2});(\d{2});(\d{2});\d{2}\s*-\s*\d{2};\d{2};\d{2};\d{2}\s*$/;
  const lines = raw.split(/\r?\n/);
  if (premiereRange.test((lines[0] || "").trim())) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const m = lines[i].trim().match(premiereRange);
      if (m) {
        const stamp = `${m[1]}:${m[2]}:${m[3]}`;
        const speaker = (lines[i + 1] || "").trim();
        const bodyLines = [];
        let j = i + 2;
        while (j < lines.length && lines[j].trim() !== "") { bodyLines.push(lines[j].trim()); j++; }
        const body = bodyLines.join(" ").trim();
        if (body) {
          const label = speaker ? speaker.replace(/\b\w/g, (c) => c.toUpperCase()) + ": " : "";
          out.push(`[${stamp}] ${label}${body}`);
        }
        i = j + 1;
      } else {
        i++;
      }
    }
    return out.join("\n");
  }

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

const SYSTEM_PROMPT = `You produce the complete publishing package for a news channel that posts clips of political proceedings — committee/inquiry hearings and chamber floor debate — from national legislatures.

The country is always given explicitly in the task context, as "COUNTRY: <name>". Treat that as fact, the same as the official record. Identify the real institutions, chamber names, party names, and legislator titles for THAT country using your own knowledge plus search — never assume the United States, and never carry over American vocabulary (Congress, Capitol Hill, "the Hill") into a clip from somewhere else.

This matters most for names: many countries have politicians who share a surname with someone more famous elsewhere. Always disambiguate by the stated country before writing a name into a title, description, or nameplate — a "Senator Baldwin" in Australia is not the Wisconsin senator, and vice versa.

You receive a transcript of one clip and, usually, the assignment it belongs to.

WHAT THE TRANSCRIPT IS
Speaker names appear in the transcript itself, usually as labels like "SEN. DOE:" or "CHAIRMAN:". Identify speakers from the transcript. Do not expect them to be provided separately.

SOURCE TYPES
You handle two kinds of clip, and they are not the same job. Both exist in most parliamentary and congressional systems, under whatever the correct local name is for that country — identify and use the real name (e.g. a Senate Estimates hearing, a select committee inquiry, a House committee hearing) rather than forcing American terms onto a different system.

COMMITTEE — a hearing, inquiry, estimates session, or oversight proceeding, whatever it is properly called in that country.
  The interesting moment is usually an exchange: a member pressing a witness, a witness conceding or refusing.
  Title should name who is questioning whom, and about what.
  Nameplates cover both the questioning member and the witness. Witness titles matter — use the supplied list.

COMMITTEE, NOMINATION HEARING — a confirmation-style hearing on a specific nominee or appointee, where that process exists in the country's system.
  Frame it as a nominee being questioned about the post they are seeking, not as a generic witness.
  Nameplates must carry the post being sought, e.g. "Director Designate, Consumer Financial Protection Bureau".
  The description should make clear which position is at stake.
  A hearing may cover several nominees — write about whichever ones actually appear in this transcript, not the whole list.

FLOOR — chamber floor proceedings: speeches, debate, arguments on a measure, in whichever chamber the country's legislature uses (a Senate, a House of Representatives, a Parliament's lower or upper house, etc.).
  The interesting moment is usually a position being argued, not an exchange.
  Title should name the speaker and the position or measure at issue.
  Nameplates cover the speaking member. If a bill or resolution is identified, name it in the description.
  Do not describe it as a hearing, and do not invent a committee — floor proceedings have none.

THE OFFICIAL RECORD
If an official record is supplied, it is authoritative. Use its committee name, subcommittee, date and title exactly as given — do not search to second-guess them, and do not contradict them. Build "source" and "eventDate" from it directly.

USING WEB SEARCH
Use it freely to research and enrich the package — this is where good titles, descriptions and tags come from, not just fact-checking. But once a fact is confirmed in this run, treat it as settled: do not search again for the same person's title, the same committee's name, or anything else already established earlier in this conversation.
- Confirm a speaker's full name, current title, party and state or electorate — always searching WITH the country from the task, never a bare name. A bare name search defaults toward whichever country has the most search results for that surname, which is exactly how a same-name collision slips through.
- Confirm the correct name of the committee, subcommittee, or chamber, using that country's actual terminology.
- Confirm bill or measure numbers, nominee names, or agency/department names mentioned aloud.
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

TWO TITLES, different jobs — give both, up to 100 characters each:
  titleQuote — built around an exact quote from the transcript. The quote must be verbatim, in quotation marks, plus enough framing (who said it, in what context) to make it click-worthy and clear on its own.
  titleDescriptive — no quote. Built from who is involved + the issue at stake + where it is happening. Specific, SEO-led, no invented drama.

TWO THUMBNAIL TEXTS, different constraints — give both:
  thumbnailTextShort — an exact quote from the transcript, 30 characters maximum, verbatim. It must read as a complete, self-contained thought — not a fragment cut off mid-sentence — and create curiosity or make someone want to know more. Among fragments that qualify, choose the one with the most pull: conflict, a stark claim, an admission, a number, a refusal, or a surprise. A grammatically broken fragment is worse than a slightly shorter but complete one. It must still be real words spoken, character for character. If nothing under 30 characters is both exact and coherent, return the shortest exact fragment that reads as a complete thought and note the constraint in "caution".
  thumbnailTextLong — up to 70 characters. Does not need to be an exact quote — a short, punchy, accurate description of the moment is fine here.

LOWER THIRD HEADLINE — descriptive, 30 characters maximum. Says what is happening, not who is speaking.

NAME PLATES — one per key speaker, formatted exactly as:
  Full Name | Position (Party-Jurisdiction)
Use the correct real convention for the stated country's legislature. In the United States that's role plus party-state, e.g. "Steve Daines | U.S. Senator (R-MT)". In another country it's whatever that country's own equivalent actually is — party plus state, electorate, or constituency, however that legislature identifies its members. Get this from your own knowledge and search, grounded in the stated country — do not force the US party-state format onto a country that doesn't use it.

The designation must be as SHORT as possible regardless of country — this is on screen for a few seconds. Just the office and party-jurisdiction, nothing more:
  Correct: "U.S. Senator (D-WI)"
  Wrong: "Ranking Member, Subcommittee on Science, Manufacturing, and Competitiveness | U.S. Senator (D-WI)" — drop the committee role entirely, it doesn't belong on a nameplate.
This applies everywhere, not just the US: keep every designation to the office and party/jurisdiction only, however that's properly written for the country in question.
For a witness or nominee, use their title and organization only, as briefly as the source states it — e.g. "Director Designate, CFPB" or "Air Traffic Manager, FAA" — not their full department name spelled out if a short form exists.

TAGS — relevant search tags, 500 characters total across the whole list.

DESCRIPTION — 500 characters maximum. Strong opening line carrying the main keywords. Include the context that matters. Descriptive, not promotional.

SHORTS — find the moments inside this clip that stand alone as vertical short-form video.

What qualifies: a sharp question meeting an evasive answer; a flat refusal; an admission; a single striking line; a moment of visible friction. What does not: procedural exchanges, throat-clearing, anything that needs the surrounding context to make sense.

Rules:
- Return between 0 and 5. If nothing in this clip genuinely stands alone, return an empty array and say so in "caution". Never pad the list.
- Target 15-60 seconds of speech, roughly 40-150 words. As a rough guide to how much transcript the segment between startsWith and endsWith should span: aim under 700 characters of spoken transcript. It can run longer when the moment genuinely needs it, but must not exceed 1400 characters — past that it's a clip, not a short.
- Segments must not overlap. Two shorts built from the same moment compete with each other.
- "startsWith" and "endsWith" must be copied EXACTLY from the transcript, character for character — 6-10 words each. The editor searches these strings in their edit software to find the cut; a paraphrase makes them unfindable. Do not repeat the full segment elsewhere in the output — the editor already has the whole transcript, and the in/out points are all that's needed to locate it.
- If the transcript carries [HH:MM:SS] markers, give the range in "timecode".
- Order them strongest first.
- Each short gets its own metadata: title up to 100 characters with the speaker names in it; description up to 200 characters, repeating names where it reads naturally; tags up to 490 characters total, repeating names and adding related keywords. These are searched on their own, so they carry the names rather than relying on the parent video.

AD SUITABILITY — only produce this section if the task tells you the channel is monetised. If it isn't, or monetisation status isn't stated, omit "adSuitability" entirely (return it as null) — don't guess at it for a channel that can't run ads.

When it does apply: work through YouTube's self-certification categories for THIS clip.

Each category is a radio group in Studio running from mildest to most severe, with the option to select none. For each, return one of: "None", "Tier 1" (mildest), "Tier 2", or "Tier 3" (most severe) — plus a one-line reason.

Be liberal toward "None" — only select a tier when a category is DEFINITELY, clearly applicable, not merely plausible or arguable. If you're weighing whether something might count, that's a "None" — the bar is "this obviously applies," not "this could be read that way."

Ordinary political content is not controversial-issues or hateful content. A senator criticizing an administration's policy, arguing against a nominee, or characterizing the other party's actions in standard political language is normal congressional discourse — it is not "sensitive and controversial topics that could be traumatic to viewers," even if it's partisan or pointed. Reserve "Controversial issues" for content that could genuinely distress a viewer — not for political disagreement itself. Do not flag policy criticism as hateful/derogatory either.

Be decisive, not tentative. State the determination as an instruction the editor follows directly — "Select None" or "Select Tier 2" — never hedge with "may," "might," "could," or "possibly." If something isn't present, say so plainly: "Not present in the transcript — select None," not "This seems unlikely to apply." The editor is ticking a box from what you tell them; give them a clear answer, not a probability.

Judge only what the transcript actually contains:
- Most congressional footage is "None" across most categories. Say so plainly. Do not hunt for something to flag.
- A hearing ABOUT a difficult subject is not the same as content depicting it. Testimony discussing violence is usually Tier 1 at most under news and documentary framing, not Tier 3.
- Profanity counts only if it is actually spoken in the transcript, or would appear in your suggested title or thumbnail text.
- If a witness quotes a slur while describing an incident, flag it plainly — the editor needs to know, stated as fact not speculation.
- Anything that depends on what is on screen rather than what is said cannot be judged from a transcript. List those under "unjudgeable" — this is the one place where "I can't tell from text alone" is the honest, correct answer, not a hedge.

If the editor has supplied their own option list, use that instead of the standard categories.

QUOTES — any time you quote, anywhere in the output, it must be the exact wording from the transcript. Never tidy, never paraphrase inside quotation marks.

Return ONLY the JSON object. No preamble, no explanation of what you found, no summary before or after. Begin your reply with { and end it with }. Do not wrap it in a code fence.

Schema:
{
  "clipType": "what kind of moment this is, in a few words",
  "titleQuote": "title built around an exact quote, max 100 characters",
  "titleDescriptive": "title with no quote — names, issue, location, max 100 characters",
  "description": "max 500 characters, plain text, no markdown",
  "tags": ["tags totalling no more than 500 characters"],
  "thumbnailTextShort": "exact quote from the transcript, max 30 characters",
  "thumbnailTextLong": "up to 70 characters, punchy but need not be an exact quote",
  "thumbnailPeople": ["who should appear, most important first"],
  "thumbnailVisual": "one to two sentences: who appears and their expression/pose, PLUS supporting imagery tied to the topic — a document, chart, photo, location, or object that signals what the clip is about at a glance. Not just a description of the speaker.",
  "lowerThirdHeadline": "descriptive, max 30 characters",
  "nameplates": [{ "name": "Steve Daines", "title": "U.S. Senator (R-MT)" }],
  "eventDate": "date of the proceeding if established, formatted like '26 July 2026' — day, full month name, full year, no leading zero. Empty string if not established.",
  "shorts": [
    {
      "startsWith": "the exact first 6-10 words of the segment, copied verbatim",
      "endsWith": "the exact last 6-10 words of the segment, copied verbatim",
      "timecode": "start - end if the transcript carries [HH:MM:SS] markers, else empty string",
      "why": "one short line on why this stands alone",
      "title": "title for this short, max 100 characters, include the speaker names",
      "description": "max 200 characters, include and repeat the names where it reads naturally",
      "tags": ["tags totalling no more than 490 characters — repeat names and include related keywords"]
    }
  ],
  "adSuitability": {
    "selections": [{ "question": "the category name", "answer": "None, Tier 1, Tier 2 or Tier 3", "reason": "one line, grounded in the transcript" }],
    "overall": "one sentence on whether this is likely to be fully monetisable",
    "unjudgeable": ["any questions that can't be answered from a transcript alone"]
  },
  "caution": "one or two sentences on anything unverified, ambiguous, or any house rule you could not meet. Empty string if genuinely nothing."
}`;

export function buildPrompt(transcript, task) {
  const bits = [];
  const ev = (task && task.event) || null;
  const type = (ev && ev.sourceType) || "committee";

  // Stated first and unmissable — this is what stops a same-named politician
  // from a different country leaking into the output.
  if (task && task.country) {
    bits.push(`COUNTRY: ${task.country}`);
    bits.push(`This clip is from ${task.country}'s political system, not the United States unless ${task.country} literally is the United States. Identify real ${task.country} institutions, chambers, parties, and legislator titles. Disambiguate every name against this country before writing it anywhere in the output.`);
    bits.push("");
  }

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

  if (task && task.monetised) {
    if (task.adOptions && task.adOptions.trim()) {
      bits.push("YOUTUBE SELF-CERTIFICATION OPTIONS supplied by the editor (use these instead of the standard categories):");
      bits.push(task.adOptions.trim());
      bits.push("");
    } else {
      bits.push("YOUTUBE SELF-CERTIFICATION CATEGORIES (this channel is monetised — answer every one for this clip):");
      AD_CATEGORIES.forEach(([name, hint]) => bits.push(`  - ${name} — ${hint}`));
      bits.push("");
    }
  } else {
    bits.push("This channel is NOT monetised. Do not produce ad suitability information — return \"adSuitability\": null.");
    bits.push("");
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

/**
 * Find the JSON object in a reply that may also contain prose, fenced code, or
 * both. Tries progressively looser strategies rather than giving up on the
 * first failure.
 */
export function extractJson(text) {
  const raw = (text || "").trim();
  if (!raw) return null;

  const attempts = [];

  // 1. The whole reply is JSON.
  attempts.push(raw);

  // 2. A fenced block anywhere in the reply.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) attempts.push(fenced[1]);

  // 3. From the first brace to the last — catches unfenced JSON after prose.
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) attempts.push(raw.slice(first, last + 1));

  for (const candidate of attempts) {
    try {
      const value = JSON.parse(candidate.trim());
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch (e) { /* try the next strategy */ }
  }
  return null;
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
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral", ttl: "1h" } }],
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

  const parsed = extractJson(text);
  if (!parsed) return { raw: text, parseFailed: true, description: text, searchCount };
  return { ...parsed, raw: text, searchCount };
}
