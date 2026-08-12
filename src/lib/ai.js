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
      model: localStorage.getItem(KEY_MODEL) || "claude-sonnet-5",
      adOptions: localStorage.getItem(KEY_ADOPTS) || "",
    };
  } catch (e) {
    return { anthropic: "", model: "claude-sonnet-5", adOptions: "" };
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
  //
  // Each block's marker keeps BOTH its start and end time ("[start-end]"),
  // not just the start. A short whose in-point and out-point both fall
  // inside the same block used to show the same timestamp twice — not
  // because the code was wrong about where the words are, but because it
  // was throwing away the one piece of data (the block's real end time)
  // that would have made the out-point actually different from the in-point.
  const premiereRange = /^(\d{2});(\d{2});(\d{2});\d{2}\s*-\s*(\d{2});(\d{2});(\d{2});\d{2}\s*$/;
  const lines = raw.split(/\r?\n/);
  if (premiereRange.test((lines[0] || "").trim())) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const m = lines[i].trim().match(premiereRange);
      if (m) {
        const startStamp = `${m[1]}:${m[2]}:${m[3]}`;
        const endStamp = `${m[4]}:${m[5]}:${m[6]}`;
        const speaker = (lines[i + 1] || "").trim();
        const bodyLines = [];
        let j = i + 2;
        while (j < lines.length && lines[j].trim() !== "") { bodyLines.push(lines[j].trim()); j++; }
        const body = bodyLines.join(" ").trim();
        if (body) {
          const label = speaker ? speaker.replace(/\b\w/g, (c) => c.toUpperCase()) + ": " : "";
          out.push(`[${startStamp}-${endStamp}] ${label}${body}`);
        }
        i = j + 1;
      } else {
        i++;
      }
    }
    return out.join("\n");
  }

  // SRT/VTT: same fix — each line already carries a real end time
  // ("00:14:22,100 --> 00:14:26,400"), previously discarded the same way.
  const timing = /(\d{2}:\d{2}:\d{2})[.,]\d{3}\s*-->\s*(\d{2}:\d{2}:\d{2})[.,]\d{3}/;
  if (!timing.test(raw)) return raw.replace(/\n{3,}/g, "\n\n").trim();

  const out = [];
  let stamp = null;
  for (const line of raw.split(/\r?\n/)) {
    const t = line.match(timing);
    if (t) { stamp = `${t[1]}-${t[2]}`; continue; }
    if (/^\d+\s*$/.test(line.trim())) continue;      // subtitle index
    const body = line.replace(/<[^>]+>/g, "").trim();  // inline tags
    if (!body) continue;
    out.push(stamp ? `[${stamp}] ${body}` : body);
    stamp = null;
  }
  return out.join("\n");
}

export function hasTimecodes(text) {
  return /\[\d{2}:\d{2}:\d{2}-\d{2}:\d{2}:\d{2}\]/.test(text || "");
}

/** Rough spoken duration — around 2.5 words a second. */
export function estimateSeconds(text) {
  const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.round(words / 2.5);
}

const SYSTEM_PROMPT = `You produce the complete publishing package for a news channel that posts clips of political proceedings — committee/inquiry hearings, chamber floor debate, and press briefings — from national legislatures and governments.

The country is always given explicitly in the task context, as "COUNTRY: <name>". Treat that as fact, the same as the official record. Identify the real institutions, chamber names, party names, and legislator titles for THAT country using your own knowledge plus search — never assume the United States, and never carry over American vocabulary (Congress, Capitol Hill, "the Hill") into a clip from somewhere else.

This matters most for names: many countries have politicians who share a surname with someone more famous elsewhere. Always disambiguate by the stated country before writing a name into a title, description, or nameplate — a "Senator Baldwin" in Australia is not the Wisconsin senator, and vice versa.

You receive a transcript of one clip and, usually, the assignment it belongs to.

WHAT THE TRANSCRIPT IS
Speaker names appear in the transcript itself, usually as labels like "SEN. DOE:" or "CHAIRMAN:". Identify speakers from the transcript. Do not expect them to be provided separately.

SOURCE TYPES
You handle three kinds of clip, and they are not the same job. The first two exist in most parliamentary and congressional systems, under whatever the correct local name is for that country — identify and use the real name (e.g. a Senate Estimates hearing, a select committee inquiry, a House committee hearing) rather than forcing American terms onto a different system. The third is a government or agency press briefing, which isn't a legislative proceeding at all.

COMMITTEE — a hearing, inquiry, estimates session, or oversight proceeding, whatever it is properly called in that country.
  The interesting moment is usually an exchange: a member pressing a witness, a witness conceding or refusing.
  Title should name who is questioning whom, and about what.
  Nameplates cover both the questioning member and the witness. Witness titles matter — use the supplied list.

COMMITTEE, NOMINATION HEARING — a confirmation-style hearing on a specific nominee or appointee, where that process exists in the country's system.
  Frame it as a nominee being questioned about the post they are seeking, not as a generic witness.
  Nameplates must carry the post being sought, e.g. "Director Designate, Consumer Financial Protection Bureau".
  The description should make clear which position is at stake.
  A hearing may cover several nominees — write about whichever ones actually appear in this transcript, not the whole list.

COMMITTEE, MARKUP / BUSINESS MEETING — members of the committee debating and voting on amendments to a bill among themselves, not outside witnesses testifying. Sometimes called a "business meeting" in committee materials.
  There is no witness list here — the participants are the members themselves. Do not invent witnesses or expect a witness-style exchange.
  The interesting moment is usually a member arguing for or against a specific amendment, a contested vote, or a sharp disagreement between members over the bill's language.
  Nameplates cover the members speaking, in the normal party-jurisdiction format — they're legislators here, not outside witnesses.
  If a bill or resolution being marked up is identified, name it in the description.

FLOOR — chamber floor proceedings: speeches, debate, arguments on a measure, in whichever chamber the country's legislature uses (a Senate, a House of Representatives, a Parliament's lower or upper house, etc.).
  The interesting moment is usually a position being argued, not an exchange.
  Title should name the speaker and the position or measure at issue.
  Nameplates cover the speaking member. If a bill or resolution is identified, name it in the description.
  Do not describe it as a hearing, and do not invent a committee — floor proceedings have none.

PRESS BRIEFING — a spokesperson (press secretary, agency or department spokesperson, government press office) taking questions from journalists. No committee, no chamber, no party affiliation belongs anywhere in this package.
  The interesting moment is usually a sharp question meeting an evasive, combative, or newsworthy answer — structurally similar to a committee exchange, but between a reporter and a spokesperson, not a legislator and a witness.
  Title should name who is being asked, by implication (reporters are rarely named), and what the exchange is about.
  Nameplates cover the spokesperson only, formatted as their title and the organization they speak for — never a party or jurisdiction, since a spokesperson doesn't hold elected office. If a reporter's outlet is stated aloud in the transcript, it can be named in the description, but reporters do not get nameplates.
  Do not invent a committee, chamber, or bill — none of those exist in a briefing.

OTHER — anything that isn't a hearing, floor proceeding, or press briefing: a campaign rally, a town hall, a book talk or author discussion, a panel or think-tank event, court oral arguments, an interview, a debate, or anything else this kind of channel might cover. The task will usually tell you what kind of event it is and who's in it — treat that as authoritative context, the same as an official record, but use your own judgment for everything the rigid categories above dictate automatically:
  Work out for yourself what the interesting moment looks like for THIS event — a rally has a crowd-reaction line, a book talk has a striking claim or story, oral arguments have a sharp question from the bench meeting a lawyer's answer. Don't force a committee-hearing or floor-speech shape onto something that isn't one.
  Nameplates: give each speaker whatever's actually correct for their real role — "U.S. Senator (R-MT)" if they genuinely hold that office and it's relevant here, "Author, [book title]" for a writer, "Justice, Supreme Court" for a judge, plain title and organization for anyone else. Do not apply the party-jurisdiction format to someone who isn't speaking in a legislative capacity just because they happen to be a legislator elsewhere — match the format to what this event actually is, not to who the person is in general.
  Do not invent a committee, chamber, bill, or official proceeding type that wasn't stated — if the task doesn't say what kind of event this is, work it out from the transcript itself and say so plainly in "caution" rather than guessing at institutional details that were never given.

THE OFFICIAL RECORD
If an official record is supplied, it is authoritative. Use its committee name, subcommittee, date and title exactly as given — do not search to second-guess them, and do not contradict them. Build "source" and "eventDate" from it directly.

USING WEB SEARCH
The baseline, always: confirm a speaker's full name, current title, party and state or electorate — always searching WITH the country from the task, never a bare name. A bare name search defaults toward whichever country has the most search results for that surname, which is exactly how a same-name collision slips through. This part isn't optional.

Beyond that baseline, search whenever more context would genuinely make the titles, thumbnail text, description, or tags better — this is where good metadata actually comes from, not just fact-checking. The committee's exact name, a bill number, the date of the proceeding, what an agency does — pull in whatever helps you write something specific and accurate instead of something generic, as the moment calls for it, rather than working through a fixed checklist every time.

Once a fact is confirmed in this run, treat it as settled: do not search again for the same person's title, the same committee's name, or anything else already established earlier in this conversation.

Never search for, or include, what happened before or after the clip, other people's reactions, or subsequent developments. The package describes THIS clip only.

RULES, BECAUSE THIS IS JOURNALISM
- Every claim must come from the transcript or from a verifiable search result about identity/title/naming.
- Never invent figures, vote counts, quotes or events.
- Quote only exact words from the transcript.
- Describe what was said. Do not characterise motives, predict consequences, or take sides.
- Push hard for a real hook. Every title and thumbnail should make someone want to click — lean into conflict, tension, a stark admission, a sharp exchange, whatever the actual moment offers. A flat, dutiful summary that nobody would click on is a failure here, not the safe choice. The line isn't "no clickbait" — it's "no clickbait that isn't true": exaggerating what was actually said, implying something the transcript doesn't support, or manufacturing outrage that isn't genuinely there is what's off-limits, not a strong, attention-grabbing hook built honestly from what's really in the clip. No ALL CAPS in titles.
- If you could not verify something, leave the field empty and say so in "caution" rather than guessing.

WORK OUT THE CLIP TYPE YOURSELF
Read the transcript and determine whether it is an opening statement, a question-and-answer exchange, sworn testimony, a floor speech, a gaggle response, or something else. The editor will not tell you.

HOUSE RULES — follow these exactly, they are not suggestions.

TWO TITLES, different jobs — give both, up to 100 characters each:
  titleQuote — built around an exact quote from the transcript. The quote must be verbatim, in quotation marks. Choose the most striking, provocative, or surprising line available in the clip — not just any accurate quote, the one with the most pull — plus enough framing (who said it, in what context) to make it genuinely click-worthy and clear on its own. If the clip has a real moment of conflict, an admission, or a sharp line, that's the quote to build around.
  titleDescriptive — no quote. Built from who is involved + the issue at stake + where it is happening. Specific, SEO-led — and still a real hook: frame the stakes or the tension plainly rather than defaulting to a bland, procedural summary. No invented drama, but don't undersell real drama that's actually there either.

TWO THUMBNAIL TEXTS, different constraints — give both:
  thumbnailTextShort — an exact quote from the transcript, 30 characters maximum, verbatim. It must read as a complete, self-contained thought — not a fragment cut off mid-sentence — and create real curiosity or make someone want to know more. It must ALSO be accurate entirely on its own, with zero surrounding context — this is a real misinformation-risk concern, not a style preference. A fragment can be verbatim and grammatically complete and still create a false impression once isolated: sarcasm, a rhetorical question, a speaker quoting or characterizing someone ELSE's position rather than their own, a hypothetical, an objection being quoted before it's rejected, a claim that's immediately qualified or contradicted nearby, OR a sweeping, generic-sounding claim that could plausibly be about several different things — "Nobody is clean here" is honestly the speaker's own sincere point, not sarcasm or someone else's view, and still fails this test: alone it could be read as being about corruption, crime, scandal, or almost anything, when the real subject is one specific thing. Losing which specific claim is being made is its own way of misleading a viewer, distinct from misrepresenting what the speaker actually believes — a fragment can be 100% true to the speaker's view and still fail this test if a reader can't tell what topic it's even about. That is a different thing from a fragment simply needing the full clip to be completely understood — a real, verbatim, colorful line from an actual public figure is exactly the kind of hook to look for, not something to soften or avoid, as long as it clearly signals a specific real subject rather than nothing at all. If the punchiest fragment only means what it appears to mean WITH context the short won't carry, it fails this test regardless of how sharp it is — do not use it. Among fragments that are both punchy AND safe read in total isolation, choose the one with the most pull: conflict, a stark claim, an admission, a number, a refusal, or a surprise. Prioritize pull over safety only among fragments that already pass the isolation test — never trade accuracy for punch. A grammatically broken fragment is worse than a slightly shorter but complete one. It must still be real words spoken, character for character. If nothing under 30 characters is both exact, coherent, and safe out of context, return the shortest exact fragment that clears all three and note the constraint in "caution".
  thumbnailTextMedium — also an exact quote from the transcript, verbatim, but with real room to breathe: up to 100 characters, not a strict ceiling to hit exactly, just don't run past it. With this much more space, a quote can carry its own context within itself, so the isolation test that governs thumbnailTextShort matters less here — a fuller quote naturally shows more of what's actually being said. Still real words, character for character. Choose the fullest version of the sharpest moment that fits, rather than the tightest possible fragment.
  thumbnailTextLong — up to 70 characters. Does not need to be an exact quote — a short, punchy, high-pull description of the moment, built to earn the click, not just accurately label it.

LOWER THIRD HEADLINE — a broadcast-style chyron banner, 30 characters maximum. Reflects the actual substance of what's being said or discussed in THIS specific clip — the real claim, number, or moment — not a generic topic label like "Rural Health Discussed" or a title for the speech as if it were a named lecture.

It must never read as a bare assertion the channel itself is making. A headline like "16,000 Left Agency Under New Director" states a claim as settled fact with no attribution — that's the channel appearing to say it, not report it. This is reported speech from a person, and the headline has to carry that: either the speaker's name plus an action verb describing what they did — questioned, pressed, confronted, accused, revealed — or a direct quote in quotation marks making clear whose words these are. (This is the shape to aim for, not the specific wording — invent your own action verb and phrasing suited to the actual moment; do not reuse this one.) Every headline is something a named person said or did, never a standalone fact the chyron is asserting on its own authority.

NAME PLATES — one per key speaker, formatted exactly as:
  Full Name | Position (Party-Jurisdiction)
Use the correct real convention for the stated country's legislature. In the United States that's role plus party-state, e.g. "Steve Daines | U.S. Senator (R-MT)". In another country it's whatever that country's own equivalent actually is — party plus state, electorate, or constituency, however that legislature identifies its members. Get this from your own knowledge and search, grounded in the stated country — do not force the US party-state format onto a country that doesn't use it.

For a PRESS BRIEFING, there is no party or jurisdiction to give — the spokesperson doesn't hold elected office. Format it as:
  Full Name | Title, Organization
e.g. "Jane Rivera | Press Secretary, The White House" or "Marcus Webb | Spokesperson, Department of Defense". Never attach a party or state to a spokesperson, even if you know their political affiliation from other reporting — it doesn't belong on this nameplate.

The designation must be as SHORT as possible regardless of country — this is on screen for a few seconds. Just the office and party-jurisdiction, nothing more:
  Correct: "U.S. Senator (D-WI)"
  Wrong: "Ranking Member, Subcommittee on Science, Manufacturing, and Competitiveness | U.S. Senator (D-WI)" — drop the committee role entirely, it doesn't belong on a nameplate.
This applies everywhere, not just the US: keep every designation to the office and party/jurisdiction only, however that's properly written for the country in question.
For a witness or nominee, use their title and organization only, as briefly as the source states it — e.g. "Director Designate, CFPB" or "Air Traffic Manager, FAA" — not their full department name spelled out if a short form exists.

TAGS — relevant search tags, 500 characters total across the whole list.

DESCRIPTION — 500 characters maximum. Strong opening line carrying the main keywords. Include the context that matters. Descriptive, not promotional.

SHORTS — find the moments inside this clip that stand alone as vertical short-form video.

What qualifies: hunt for what actually drives attention, not just what reads as a clean, self-contained sentence. Look specifically for accusations; contradictions or a gotcha moment; a number that sounds shocking on its own; someone visibly not answering the question they were asked; a reveal or admission; a flat refusal; a moment of real friction. A sharp question meeting an evasive answer beats a tidy declarative statement every time — favor the moment with the most at stake over the moment that's merely easiest to quote. What does not qualify: procedural exchanges, throat-clearing, anything that needs MORE surrounding context than can fit in one short to make sense.

Selection happens before any suitability judgment, not instead of it. This channel is reporting what was said, not saying it — a real accusation, a scandal reference, a difficult subject discussed factually is exactly what this section exists to find, not something to filter out. There is no content-based filter at the selection stage at all: do not soften, skip, or pass over a genuinely strong moment because it touches something sensitive, controversial, or heavy. Whether a selected short is fine to monetise is a separate, later, per-short question, answered entirely in that short's own ad suitability fields below — it has zero bearing on whether something belongs in this list. A short that needs a Tier 2 flag in ad suitability is still a completely correct, valid short to include.

Explicitly include higher-risk material, not just the safest options: alongside your strongest clean candidates, actively surface anything involving real conflict, a scandal reference, or a strong reaction, even if it reads as edgier — let ad suitability flag it afterward rather than it never becoming a candidate at all. Do not default to the tidiest-sounding lines just because they're easiest to write a title for.

Get the boundaries right, not just the moment: a short that's technically about the right exchange but starts too late or ends too early defeats the whole point. "startsWith" should begin with enough real lead-in that a viewer who's seen nothing else understands what's being asked or claimed — not just the single sharpest word, cut loose from what set it up. "endsWith" must extend all the way through the actual payoff — the number, the admission, the punchline, the concession — never stopping a beat before it lands. A short that cuts away right before the point it was building to is worse than a short that's a few seconds longer. When deciding where to end, err on the side of including the full landing rather than trimming tight.

Rules:
- Return between 0 and 5. If nothing in this clip genuinely stands alone, return an empty array and say so in "caution". Never pad the list.
- Rank by real stakes, not just clarity. When choosing which moments make the list, weigh how much is actually at issue — an accusation, a contradiction, a shocking figure, a genuine dodge — alongside how clean and self-contained the moment reads. A punchy but low-stakes line should not crowd out a messier but genuinely explosive one.
- Target 15-60 seconds of speech, roughly 40-150 words. As a rough guide to how much transcript the segment between startsWith and endsWith should span: aim under 700 characters of spoken transcript. It can run longer when the moment genuinely needs it, but must not exceed 1400 characters — past that it's a clip, not a short.
- Segments must not overlap. Two shorts built from the same moment compete with each other.
- "startsWith" and "endsWith" must be copied EXACTLY from the transcript, character for character — 6-10 words each. The editor searches these strings in their edit software to find the cut; a paraphrase makes them unfindable. Do not repeat the full segment elsewhere in the output — the editor already has the whole transcript, and the in/out points are all that's needed to locate it.
- If the transcript carries [HH:MM:SS] markers, give the range in "timecode".
- Order them strongest first.
- Each short gets its own metadata: title, description, tags. These are searched on their own, so they carry the names rather than relying on the parent video.
  - Title: 100 characters is a hard ceiling, not a target — treat anything over it as a real failure, the same as missing a required field. If it's running long, that means it's trying to summarize the whole short instead of naming the one sharpest thing in it — cut down to the core who-did-what (an accusation, an admission, a number, a refusal), drop secondary clauses and qualifiers, and include the speaker's name only if it still fits without pushing past the limit.
  - Description: up to 200 characters, repeating names where it reads naturally.
  - Tags: up to 490 characters total, repeating names and adding related keywords.
- Each short also gets its OWN ad suitability determination, not the parent video's — a short is posted as its own standalone video, and pulling one specific moment out of a longer clip can change what applies to it. Judge each short's ad suitability using the exact same categories, tiers, and standard described below, based only on what that specific short actually contains.

ANCHOR SCRIPT — only produce this when the task tells you the editor has turned it on for this generation. Otherwise return "anchorScript": null for every video — don't produce it unrequested.

When requested, this is what a mainstream broadcast anchor would actually say on air surrounding this clip — the lead-in immediately before it plays, a short beat of context partway through if the clip needs one, and the wrap-up immediately after.

midCommentary and postClip specifically exist to be the reason a viewer sticks around for the surrounding commentary rather than just watching the raw clip alone — they have to carry real value on their own. A bare restatement of what was just said ("Schiff then moved to his next point," "That was Schiff urging a no vote") is not enough and must never be the whole of either one. This includes a second failure mode that reads as more sophisticated but isn't: narrating the shape of the argument instead of adding to it — "he made this point, then moved to this next one" is still just describing what the transcript already shows the viewer directly, worded as if it were commentary. Neither restating content nor narrating structure satisfies this; both leave the viewer knowing nothing they wouldn't already have from watching the clip itself.

What does satisfy it: actively search for and include at least one concrete, verifiable fact the transcript doesn't already give the viewer — this is not optional or conditional on whether it seems needed, it is the actual content of these two fields, the same way confirming a speaker's title is a mandatory search elsewhere in this package, not a "search if it seems worth it." Search the way a journalist actually would: look for real news coverage of the specific people, events, organizations, and claims in this clip — what other outlets have reported about the same story, what happened before or after this moment, how the specific things mentioned here (a program, a lawsuit, a document, a prior event) have actually been covered. That reporting is the raw material for genuine depth, not a generic instruction to "add background" — a well-sourced fact drawn from real coverage of this exact story is worth more than an abstractly relevant one. Ground every such fact the same way everything else in this package is grounded: verified, not invented, and left out entirely if it can't be confirmed rather than guessed at. The test for both fields: does this teach the viewer something they wouldn't already have from the clip itself? A structurally accurate summary of what was said and what's coming, however well worded, does not pass that test on its own.

A single surface fact clears that bar but doesn't max it out, and postClip in particular needs to go further — it's the last thing said, the reason a viewer stayed for the commentary rather than clicking away after the raw clip, and it should feel like it. Naming who someone previously worked for, or when, or on what — that's a fact, but it doesn't yet explain why it matters. What makes it worth having watched is pushing one level past that: what's actually unusual about it, how it compares to what's normally expected, what specific rule, precedent, or consequence is genuinely in tension with it, or a real pattern connecting it to something else worth knowing — the kind of connection a viewer wouldn't draw on their own even with the full clip in front of them. That is depth, not length: one well-explained piece of real insight outweighs several surface facts listed side by side, and it outweighs padding a thin one across more sentences even further. If a genuinely deeper angle can't be found and verified, the surface fact stands rather than being stretched — but look for the deeper one first, don't settle for the first fact found.

This is not license to speculate about outcomes, characterise motives, or take a side — those stay off-limits exactly as everywhere else in this package, describing what was said and its real, factual context, never predicting what happens next or whose view is right. The difference is between "here's what he just said" (too thin, not acceptable) and "here's what he just said, and here's the piece of context that makes it matter" (the actual target).

midCommentary and postClip do not get the same amount of room, because they don't do the same job. midCommentary interrupts a clip that's actively playing — it has to stay genuinely brief, one or two sentences, rarely more, the same length as before this depth requirement existed. Depth here means picking the single most useful piece of context and stating it efficiently, not adding more of it — a mid-clip break that runs long fights the pacing of the clip itself no matter how good the content is. postClip runs after the clip has already finished, where there's real room to use — the task instructions for this specific generation give the actual word ceiling to aim for; use it whenever there's genuine insight to develop, though plenty of clips will genuinely call for far less. Length still follows substance, never padded, but the ceiling given is real, not a suggestion to undershoot by default. If there's more than one worthwhile angle — the immediate context, what it connects to, what came of it since — postClip is where that belongs; midCommentary is not the place to fit it in.

More room surfaces a failure mode of its own, worth naming directly: a postClip that lists several separate true, relevant facts side by side is not the same thing as a postClip that develops one real point using several facts as its evidence. "X happened, then Y happened, then Z is also true" is still just narration — a timeline instead of a summary, but not insight, even at 300 words and even when every fact in it is accurate and well-sourced. The room is for depth, not inventory. Every fact included should be doing the same job: building toward one thing the viewer now understands that they didn't before, not just occupying the space available. And because this plays once and is gone rather than sitting on a page to return to, postClip has to actually end — arrive somewhere, not trail off on the last fact that happened to fit. A closing line that ties back to why any of it matters is what makes it feel finished rather than cut off.

For example, on a clip where a senator argues at length against confirming a nominee: a postClip that says the nominee was confirmed days later by a narrow vote, then separately notes two senators had raised a specific concern before the vote, then separately notes who cast the deciding vote, then separately adds an unconnected fact about the nominee's prior role, has covered a lot of true ground and landed on none of it — four facts, no point. A postClip built around one point instead: that the senator's warning turned out to matter beyond the speech itself, because the same concern he raised nearly sank the nomination inside the nominee's own party days later, decided by a single vote, and that near-miss is what actually establishes whether the concerns raised here were serious or just partisan noise — that's one throughline, using the vote count, the holdouts, and the deciding vote as its evidence, closing on why the outcome actually matters rather than just noting that it happened.

One more check, and it's mandatory whenever intro, midCommentary, or postClip references anything with an outcome — a nomination, a vote, a proposal, a pending case, an investigation, anything still undecided at the moment captured in the transcript: search to confirm whether it has since been resolved, and if it has, say so plainly rather than writing as though the outcome is still open. The clip captures one moment; the package is generated later, sometimes much later, and a viewer watching after the fact may already know how it turned out. "Ahead of a vote on the nomination" is wrong to write if the vote already happened by the time this is generated; "a proposed fund" is wrong to write if the fund was since abandoned. Say what actually happened: "in the vote that followed, he was confirmed," "the fund was later scrapped after congressional pushback." This isn't optional caution, it's the same verify-before-writing standard the rest of this package already holds itself to for names and titles, applied to outcomes instead.

  intro — must begin exactly with "Let's hear [Full Name]", using the speaker's real name as established elsewhere in this package, then continue with only a brief, situational clause: what they're about to do or what's about to happen — not who they are. This exact opening is a fixed house convention, not a stylistic default — no alternate lead-in phrasing is acceptable here even if something else reads more naturally to you. Do NOT restate the speaker's title, party, state, or committee membership here — that biographical detail already lives on the nameplate graphic on screen, and a real anchor never re-reads a chyron out loud before playing the tape. "Let's hear Senator Schiff press the nominee on the funding gap" is the right shape; "Let's hear from Adam Schiff, the Democratic senator from California and a member of the Senate Judiciary Committee" is not — that's a nameplate being read aloud, not an anchor lead-in. When more than one person speaks, lead with whichever speaker the moment is actually built around — the same one the titles and thumbnail are centered on.

  midCommentary — a beat an anchor inserts partway through a longer or denser clip, carrying the real value described above, ending in a forward-looking cue into whatever comes right after the insertion point in the transcript — a short transitional phrase that hands smoothly back into the footage, the way a real anchor voiceover leads back into tape rather than just stopping cold (e.g. "...here's how she responded" or "...watch what he says next"). The cue must actually match what comes next at the insertion point — don't tease something the following transcript doesn't deliver. If the clip is short and clear enough that no anchor would realistically break in, say so plainly in one honest sentence rather than manufacturing a beat that wouldn't actually air, and leave midCommentaryInsertAfter as an empty string.

  midCommentaryInsertAfter — the exact 6-10 words from the transcript, copied verbatim, marking the point where midCommentary should be inserted — same rule as shorts' startsWith/endsWith: character-for-character exact, so the editor can search it in their editing software to find the cut point. This has to be a single continuous run of words that actually appears in the transcript exactly as written — not a blend of the end of one sentence and the start of a nearby one, even if the two are talking about the same thing and the merged version reads naturally. If you can't find one continuous exact phrase at the point you want to mark, pick a different nearby exact phrase instead of constructing one. Empty string whenever midCommentary itself says no beat is needed.

  postClip — the anchor's wrap-up immediately after the clip ends, carrying the same real value described above — not just what was heard restated, but the context or stakes that make it worth having watched.

AD SUITABILITY — only produce this section if the task tells you the channel is monetised. If it isn't, or monetisation status isn't stated, omit "adSuitability" entirely (return it as null) — don't guess at it for a channel that can't run ads. This applies equally to every short's own adSuitability field: same gate, same rule — null for a non-monetised channel, never guessed.

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

MULTIPLE VIDEOS — decide first whether this transcript is genuinely one video or several.

This is specifically about splitting a transcript into multiple separate LONG-form deliverables that each need their own full package. It is not a way to pick out a highlight within a single short assignment — if the assignment itself is a short, use the shorts array for that instead, described further down; segmentStartsWith/segmentEndsWith should never be used to mark an excerpt inside a short.

Evaluate this fresh each time, on what's actually in the transcript — do not start from an assumption that it's probably one video. A single Q&A or one line of questioning on one bill genuinely is one video, and a floor speech covering several substantial, separately-evidenced subjects genuinely is several — neither is the default; both are just what the content actually is. Split whenever the transcript covers multiple topics that are each independently newsworthy and would each be searched for separately — this applies EVEN WITHIN one continuous statement by a single speaker. The test is not "is this the same speaker" or "is this one continuous throughline" — a single senator can deliver one uninterrupted floor statement that still covers several genuinely separate, independently clip-worthy subjects, and each of those deserves its own video with its own title and thumbnail built around THAT subject specifically, not a title trying to cover all of them at once. If someone would search for one of these topics by name and not care about the others in the same statement, that is real evidence for a split, regardless of whether it was all said in one breath.

A strong, concrete signal for splitting: how much sustained depth a sub-topic actually gets. A passing one-line mention is not, on its own, a separate video. But a sub-topic that runs for real minutes, with specific documents, named people, and its own evidence — the way a genuine standalone story would be reported — is strong evidence it deserves its own video, not just a paragraph inside a bigger one. Weigh actual depth, not just topic count.

Do not use "it's one speaker," "one vote," "one proceeding," "one continuous statement," or "one overall argument holding it together" as your reason to keep something as one video. These are procedural facts about the setting, not evidence about the content, and they get raised here only to name them as invalid — not as things to echo back as justification. If your reasoning for staying at one video leans on any of these, stop and check what the actual content-based reason is instead. If there isn't one beyond the procedural framing, that's a sign it should probably be split.

Concretely: a senator's single uninterrupted floor speech that moves through, say, an unrelated spending controversy, a personnel scandal involving a different official, and a separate policy dispute is several videos, not one — each of those is its own story a different set of viewers would search for, even though it's one speaker, one proceeding, and one overall argument holding it together. A hearing that spends thirty minutes on one funding bill and then moves entirely to a separate senator questioning a different witness about an unrelated policy area is also genuinely separate videos. By contrast, five senators each asking their own questions about the exact same specific bill, where every answer is actually about that one bill, is one video — there the sub-questions aren't separately newsworthy topics, they're facets of the same one.

When you do split, every video needs "segmentStartsWith" and "segmentEndsWith" — the exact words, verbatim, 6-10 words each, marking where that video's portion of the transcript begins and ends, same verbatim-exact-match rule as shorts use. This is how the editor finds where to physically cut the source footage apart. Every word of the transcript belongs to exactly one video's segment, in the order they occur — segments must not overlap and must not leave gaps between them. When there is only one video, leave both fields as empty strings — there's nothing to mark since it already covers everything.

Being mechanically contiguous is not the same as being correctly placed — the cut has to fall exactly where the topic actually changes, not at whatever sentence or paragraph break happens to be nearby. A speaker's own reaction, follow-up question, or commentary on something still belongs with that thing, even if it starts a new paragraph or comes after a pause — "here's what happened" followed by the speaker's own "and what does that even mean?" is one topic, not two, and both halves belong in the same video. Before finalizing segment boundaries, check each one specifically: does the sentence right after this cut actually start a new subject, or is it still reacting to what just ended? If it's still reacting, the boundary is in the wrong place and needs to move past it.

Once the topic-level placement is right, verify the mechanical join itself, word for word — this is a separate check from the one above, and both matter. For every pair of adjacent videos: take video N's segmentEndsWith, find it in the transcript, and read forward from there. The very next words must be video N+1's segmentStartsWith, exactly — nothing in between, and nothing repeated. If there's a sentence or phrase sitting in the gap between them, it's been cut out of both videos and needs to be assigned to whichever one it actually belongs to. If segmentStartsWith for video N+1 actually appears before segmentEndsWith for video N ends, they're overlapping, and content from one topic is bleeding into the other. Run this check on every boundary before finalizing, not just the first one.

Every video gets its own complete, independent package — its own titles, thumbnail, nameplates, shorts, and ad suitability, listed below. Write each one as if it were the only clip being processed; never reference the other video in it or assume the viewer has seen it.

Always state this decision explicitly in "splitReasoning", whether you split or not — the editor otherwise has no way to tell "I considered splitting this and decided against it" from "I never thought about it." If you kept it as one video, say briefly why (e.g., "One continuous line of questioning on the same bill throughout — no genuine subject change"). If you split it, say what the distinct subjects were.

Return ONLY the JSON object. No preamble, no explanation of what you found, no summary before or after. Begin your reply with { and end it with }. Do not wrap it in a code fence.

Schema:
{
  "videos": [
    {
      "segmentLabel": "a few words naming what this video covers — only meaningful when there's more than one; leave empty when there's just one video",
      "segmentStartsWith": "exact first 6-10 words of transcript this video covers, verbatim — empty string if this is the only video",
      "segmentEndsWith": "exact last 6-10 words of transcript this video covers, verbatim — empty string if this is the only video",
      "clipType": "what kind of moment this is, in a few words",
      "titleQuote": "title built around an exact quote, max 100 characters",
      "titleDescriptive": "title with no quote — names, issue, location, max 100 characters",
      "description": "max 500 characters, plain text, no markdown",
      "tags": ["tags totalling no more than 500 characters"],
      "thumbnailTextShort": "exact quote from the transcript, max 30 characters",
      "thumbnailTextMedium": "also an exact quote, up to 100 characters, room to breathe",
      "thumbnailTextLong": "up to 70 characters, punchy but need not be an exact quote",
      "thumbnailPeople": ["who should appear, most important first"],
      "thumbnailVisual": "one to two sentences: who appears and their expression/pose, PLUS supporting imagery tied to the topic — a document, chart, photo, location, or object that signals what the clip is about at a glance. Not just a description of the speaker.",
      "lowerThirdHeadline": "descriptive, max 30 characters",
      "nameplates": [{ "name": "Steve Daines", "title": "U.S. Senator (R-MT)" }],
      "eventDate": "date of the proceeding if established, formatted like '26 July 2026' — day, full month name, full year, no leading zero. Empty string if not established.",
      "anchorScript": {
        "intro": "must begin exactly with 'Let's hear [Full Name]', then a brief situational clause only — what they're about to do, not who they are; no title/party/state/committee, that's the nameplate's job",
        "midCommentary": "real added value, kept genuinely brief — one to two sentences, this interrupts a playing clip — ending in a forward cue into what comes next; or an honest note that none is needed for a short/clear clip",
        "midCommentaryInsertAfter": "exact 6-10 words from the transcript, verbatim, marking where midCommentary belongs — empty string if midCommentary says no beat is needed",
        "postClip": "real added value, with real room to use it — up to the word ceiling given in the task instructions for this generation, though often much less; the context, stakes, or connections that make this worth having watched, not a bare restatement of what was heard"
      },
      "shorts": [
        {
          "startsWith": "the exact first 6-10 words of the segment, copied verbatim",
          "endsWith": "the exact last 6-10 words of the segment, copied verbatim",
          "timecode": "start - end if the transcript carries [HH:MM:SS] markers, else empty string",
          "why": "one short line on why this stands alone",
          "title": "title for this short, max 100 characters, include the speaker names",
          "description": "max 200 characters, include and repeat the names where it reads naturally",
          "tags": ["tags totalling no more than 490 characters — repeat names and include related keywords"],
          "adSuitability": {
            "selections": [{ "question": "the category name", "answer": "None, Tier 1, Tier 2 or Tier 3", "reason": "one line, grounded in this short's own segment" }],
            "overall": "one sentence on whether THIS short specifically is likely to be fully monetisable",
            "unjudgeable": ["any questions that can't be answered from a transcript alone"]
          }
        }
      ],
      "adSuitability": {
        "selections": [{ "question": "the category name", "answer": "None, Tier 1, Tier 2 or Tier 3", "reason": "one line, grounded in the transcript" }],
        "overall": "one sentence on whether this is likely to be fully monetisable",
        "unjudgeable": ["any questions that can't be answered from a transcript alone"]
      }
    }
  ],
  "splitReasoning": "always filled — why this stayed one video, or what the distinct subjects were if you split it",
  "caution": "one or two sentences on anything unverified, ambiguous, or any house rule you could not meet — covering the whole generation, not any one video. Empty string if genuinely nothing."
}`;

export function buildPrompt(transcript, task) {
  const bits = [];
  const ev = (task && task.event) || null;
  const type = (ev && ev.sourceType) || "committee";
  // Accepts the new array format or an older saved task's newline-string,
  // so nothing already in the database breaks when this changed.
  const peopleList = (v) => (Array.isArray(v) ? v : (v || "").split("\n")).map((s) => (s || "").trim()).filter(Boolean);

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
    } else if (type === "briefing") {
      rows.push(`  Source type: PRESS BRIEFING`);
      if (ev.title) rows.push(`  Briefing: ${ev.title}`);
      if (ev.organization) rows.push(`  Organization: ${ev.organization}`);
      const spokespeople = peopleList(ev.spokespeople);
      if (spokespeople.length) {
        rows.push(`  Spokespeople appearing (use these names and titles exactly):\n${spokespeople.map((w) => `    - ${w}`).join("\n")}`);
      }
    } else if (type === "other") {
      rows.push(`  Source type: OTHER — ${ev.otherEventType || "unspecified, use your own judgment from the transcript"}`);
      const participants = peopleList(ev.participants);
      if (participants.length) {
        rows.push(`  Participants (use these names and titles exactly):\n${participants.map((w) => `    - ${w}`).join("\n")}`);
      }
    } else if (ev.hearingType === "markup") {
      rows.push(`  Source type: COMMITTEE, MARKUP / BUSINESS MEETING`);
      if (ev.title) rows.push(`  Markup: ${ev.title}`);
      if (ev.committee) rows.push(`  Committee: ${ev.committee}`);
      if (ev.subcommittee) rows.push(`  Subcommittee: ${ev.subcommittee}`);
      if (ev.measure) rows.push(`  Bill or resolution being marked up: ${ev.measure}`);
    } else {
      const isNomination = ev.hearingType === "nomination";
      rows.push(`  Source type: COMMITTEE${isNomination ? ", NOMINATION HEARING" : ""}`);
      if (ev.title) rows.push(`  Hearing: ${ev.title}`);
      if (ev.committee) rows.push(`  Committee: ${ev.committee}`);
      if (ev.subcommittee) rows.push(`  Subcommittee: ${ev.subcommittee}`);
      const witnesses = peopleList(ev.witnesses);
      if (witnesses.length) {
        const label = isNomination ? "Nominees appearing" : "Witnesses";
        rows.push(`  ${label} (use these names and titles exactly):\n${witnesses.map((w) => `    - ${w}`).join("\n")}`);
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

  if (task && task.aiContext && task.aiContext.trim()) {
    bits.push("ADDITIONAL CONTEXT FROM THE EDITOR (background the transcript alone might not make obvious):");
    bits.push(task.aiContext.trim());
    bits.push("");
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
    if (task.contentFormat === "short") {
      bits.push("This assignment is a SHORT specifically — not a long-form video, however long the supplied transcript runs. If the transcript is much longer than a single short (a full hearing, a long floor speech), do NOT try to summarise or title the whole thing as if it were the long-form deliverable, and do NOT use segmentStartsWith/segmentEndsWith to mark the excerpt — those exist only for splitting a transcript into multiple separate LONG videos, a different feature entirely, not for picking the best moment inside a single short. Instead, put the genuinely qualifying self-contained excerpts into the \"shorts\" array using its own startsWith/endsWith fields — same standard as elsewhere: however many actually clear the bar, up to 5, never padded to hit a target and never fewer than genuinely qualify. If only one moment is truly strong, one is correct; if several are, offer all of them so the editor gets a real choice rather than the model deciding unilaterally. Build every top-level field (title, thumbnail, description) around whichever excerpt is strongest — not the full transcript it came from.");
    }
    if (task.description) bits.push(`Notes from the assignment:\n${task.description}`);
    if (task.wantShorts === false) {
      bits.push("SHORTS: the editor has turned this off for this generation — skip the whole shorts section entirely. Return \"shorts\": [] and do not spend any effort hunting for short-form moments.");
    }
    if (task.wantMultipleVideos === false) {
      bits.push("MULTIPLE VIDEOS: the editor has turned this off for this generation — always return exactly one video covering the whole transcript, regardless of how many distinct subjects it covers. Leave segmentStartsWith and segmentEndsWith empty, and set splitReasoning to state plainly that splitting was skipped because the editor turned it off, not because the transcript was actually judged to be one topic.");
    }
    if (task.wantAnchorScript) {
      const wordTarget = Number.isFinite(task.anchorScriptWordTarget) && task.anchorScriptWordTarget > 0 ? task.anchorScriptWordTarget : 200;
      bits.push(`ANCHOR SCRIPT: the editor has turned this ON for this generation — produce a complete anchorScript (intro/midCommentary/postClip) for every video, following the ANCHOR SCRIPT rules above exactly, including the required "Let's hear [Full Name]" opening. postClip's word ceiling for this generation is ${wordTarget} words — use up to that much when there's genuine substance to fill it, well under it when there isn't.`);
      if (task.anchorScriptCustomInstructions && task.anchorScriptCustomInstructions.trim()) {
        bits.push(`ANCHOR SCRIPT — additional editor instructions for this generation (these add to the ANCHOR SCRIPT rules above, they don't replace them — the verbatim, accuracy, and no-speculation requirements still apply in full): ${task.anchorScriptCustomInstructions.trim()}`);
      }
    } else {
      bits.push("ANCHOR SCRIPT: not requested for this generation — return \"anchorScript\": null for every video.");
    }
  }
  const head = bits.length ? `${bits.join("\n")}\n\n` : "";
  return `${head}Transcript:\n\n${cleanTranscript(transcript)}`;
}

// One entry per regenerable block in the UI — the label must match what's
// shown on screen, fields are exactly what that section owns (used both to
// build the schema shown to the model and to filter the response so
// nothing outside this section can get overwritten even if the model
// includes something extra), and schema is the literal shape lifted
// straight from the full generation schema above, so there is exactly one
// source of truth for what each field looks like, never a second copy that
// could drift out of sync.
const SECTION_CONFIGS = {
  headline: {
    label: "Headline, nameplates & date",
    fields: ["lowerThirdHeadline", "nameplates", "eventDate"],
    schema: `{
  "lowerThirdHeadline": "descriptive, max 30 characters",
  "nameplates": [{ "name": "Steve Daines", "title": "U.S. Senator (R-MT)" }],
  "eventDate": "date of the proceeding if established, formatted like '26 July 2026' — day, full month name, full year, no leading zero. Empty string if not established."
}`,
  },
  anchorScript: {
    label: "Anchor script",
    fields: ["anchorScript"],
    schema: `{
  "anchorScript": {
    "intro": "must begin exactly with 'Let's hear [Full Name]', then a brief situational clause only — what they're about to do, not who they are; no title/party/state/committee, that's the nameplate's job",
    "midCommentary": "real added value, kept genuinely brief — one to two sentences, this interrupts a playing clip — ending in a forward cue into what comes next; or an honest note that none is needed for a short/clear clip",
    "midCommentaryInsertAfter": "exact 6-10 words from the transcript, verbatim, marking where midCommentary belongs — empty string if midCommentary says no beat is needed",
    "postClip": "real added value, with real room to use it — up to the word ceiling given in the task instructions for this generation, though often much less; the context, stakes, or connections that make this worth having watched, not a bare restatement of what was heard"
  }
}`,
  },
  thumbnail: {
    label: "Thumbnail",
    fields: ["thumbnailTextShort", "thumbnailTextMedium", "thumbnailTextLong", "thumbnailPeople", "thumbnailVisual"],
    schema: `{
  "thumbnailTextShort": "exact quote from the transcript, max 30 characters",
  "thumbnailTextMedium": "also an exact quote, up to 100 characters, room to breathe",
  "thumbnailTextLong": "up to 70 characters, punchy but need not be an exact quote",
  "thumbnailPeople": ["who should appear, most important first"],
  "thumbnailVisual": "one to two sentences: who appears and their expression/pose, PLUS supporting imagery tied to the topic — a document, chart, photo, location, or object that signals what the clip is about at a glance. Not just a description of the speaker."
}`,
  },
  metadata: {
    label: "YouTube metadata",
    fields: ["titleQuote", "titleDescriptive", "description", "tags"],
    schema: `{
  "titleQuote": "title built around an exact quote, max 100 characters",
  "titleDescriptive": "title with no quote — names, issue, location, max 100 characters",
  "description": "max 500 characters, plain text, no markdown",
  "tags": ["tags totalling no more than 500 characters"]
}`,
  },
  shorts: {
    label: "Shorts",
    fields: ["shorts"],
    schema: `{
  "shorts": [
    {
      "startsWith": "the exact first 6-10 words of the segment, copied verbatim",
      "endsWith": "the exact last 6-10 words of the segment, copied verbatim",
      "timecode": "start - end if the transcript carries [HH:MM:SS] markers, else empty string",
      "why": "one short line on why this stands alone",
      "title": "title for this short, max 100 characters, include the speaker names",
      "description": "max 200 characters, include and repeat the names where it reads naturally",
      "tags": ["tags totalling no more than 490 characters — repeat names and include related keywords"],
      "adSuitability": {
        "selections": [{ "question": "the category name", "answer": "None, Tier 1, Tier 2 or Tier 3", "reason": "one line, grounded in this short's own segment" }],
        "overall": "one sentence on whether THIS short specifically is likely to be fully monetisable",
        "unjudgeable": ["any questions that can't be answered from a transcript alone"]
      }
    }
  ]
}`,
  },
  adSuitability: {
    label: "Ad suitability",
    fields: ["adSuitability"],
    schema: `{
  "adSuitability": {
    "selections": [{ "question": "the category name", "answer": "None, Tier 1, Tier 2 or Tier 3", "reason": "one line, grounded in the transcript" }],
    "overall": "one sentence on whether this is likely to be fully monetisable",
    "unjudgeable": ["any questions that can't be answered from a transcript alone"]
  }
}`,
  },
};

// Regenerates exactly one block of an already-generated package — reuses
// buildPrompt for the task context and transcript so there's zero chance
// of the two prompts drifting apart, and reuses the exact same streaming
// and parsing machinery generatePackage uses, so this isn't a second,
// separately-trusted code path.
export async function regenerateSection({ transcript, task, section, video, apiKey, model = "claude-sonnet-5", onStatus, signal, editorNote }) {
  const config = SECTION_CONFIGS[section];
  if (!config) throw new Error(`Unknown section to regenerate: "${section}".`);

  const base = buildPrompt(transcript, section === "anchorScript" ? { ...task, wantAnchorScript: true } : task);
  const existingVideoJson = JSON.stringify(video || {}, null, 2);
  const trimmedNote = editorNote && editorNote.trim();
  const userMessage = `${base}

---

You already generated a complete package for this transcript. Here is the full package as it currently stands, for context and consistency:

${existingVideoJson}

The editor was not satisfied with one part of it and wants ONLY that section regenerated: "${config.label}".${trimmedNote ? ` They specifically asked for this: "${trimmedNote}" — follow that instruction precisely, it's the actual goal of this regeneration, not just a hint to weigh alongside other considerations.` : " Give a genuinely different take on just this section — not a light rephrasing of what's already there."} Stay fully accurate to the transcript above and consistent with everything else already decided in the package (the same names spelled the same way, the same overall subject, nothing that contradicts what's already settled elsewhere in it). Every rule from the system instructions still applies in full here — accuracy, no fabrication, exact verbatim quotes where required, character limits — being a partial regeneration relaxes none of them, and a specific editor request never overrides them either.

Return ONLY a JSON object with EXACTLY this shape, nothing else — no other fields, no preamble, no explanation. Begin your reply with { and end it with }. Do not wrap it in a code fence.

${config.schema}`;

  const { parsed, text, truncated, searchCount, cacheInfo } = await streamAndParse({
    system: SYSTEM_PROMPT, messages: [{ role: "user", content: userMessage }], model, apiKey,
    maxTokens: 32000, maxSearches: 3, onStatus, signal,
  });

  if (parsed) {
    // Only pull back fields this section actually owns — if the model
    // included anything extra despite the instruction, it's silently
    // dropped here rather than risking an overwrite of an unrelated field.
    const fields = {};
    config.fields.forEach((f) => { if (parsed[f] !== undefined) fields[f] = parsed[f]; });
    if (Object.keys(fields).length === 0) {
      throw new Error("Claude's response didn't include any of the expected fields for this section. Try again.");
    }
    return { fields, truncated, searchCount, cacheInfo };
  }

  throw new Error(truncated
    ? "Claude ran out of output budget regenerating this section. Try again — a retry usually completes."
    : "Couldn't get a usable result for this section. Try again.");
}

/**
 * Find the JSON object in a reply that may also contain prose, fenced code, or
 * both. Tries progressively looser strategies rather than giving up on the
 * first failure.
 */
// When a response gets cut off mid-generation, the naive "first { to last }"
// slice above lands on the wrong closing brace — the last COMPLETE one might
// be several fields back, leaving arrays and objects still open, which still
// isn't valid JSON. This walks the actual text character by character,
// tracking real string/bracket state, and closes exactly what's genuinely
// still open — recovering every field that did complete (three full shorts,
// a complete description, etc.) instead of discarding all of it.
function repairTruncatedJson(raw) {
  let s = raw;
  let inString = false;
  let escape = false;
  let stringStart = -1;
  const stack = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === "\\" && inString) { escape = true; continue; }
    if (c === '"') { if (!inString) stringStart = i; inString = !inString; continue; }
    if (inString) continue;
    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();
  }
  if (!stack.length) return null; // nothing was actually left open — not a truncation case

  // Cut off mid-string — e.g. a description stopping mid-word. Keeping it as
  // a "closed" string would mean a sentence that just stops could pass for
  // real, complete content. Discard the whole field instead — truncate back
  // to before it started, so recovery only ever keeps fields that finished
  // completely, never a chopped fragment.
  if (inString) s = s.slice(0, stringStart);

  s = s.replace(/,?\s*"[^"]*"\s*:\s*$/, ""); // drop a dangling "key": with no value yet
  s = s.replace(/,\s*$/, ""); // drop a dangling trailing comma
  for (let i = stack.length - 1; i >= 0; i--) s += stack[i] === "{" ? "}" : "]";
  return s;
}

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

  // 4. Repair a genuinely truncated response — only reached if nothing above
  // parsed cleanly.
  if (first !== -1) {
    const repaired = repairTruncatedJson(raw.slice(first));
    if (repaired) {
      try {
        const value = JSON.parse(repaired);
        if (value && typeof value === "object" && !Array.isArray(value)) return value;
      } catch (e) { /* genuinely unrecoverable */ }
    }
  }

  return null;
}

// Maps a JSON field name, as it appears while the response streams in, to a
// plain-language label — this is how live status shows "Writing the
// thumbnail" instead of just "writing, N characters," without needing the
// model to announce anything itself. Checked in schema order; whichever of
// these has most recently appeared in the accumulated text is what's
// actually being written right now.
const FIELD_LABELS = [
  ["splitReasoning", "Deciding if this should be split into multiple videos"],
  ["segmentLabel", "Marking where this video starts"],
  ["clipType", "Placing the clip"],
  ["titleQuote", "Writing titles"],
  ["titleDescriptive", "Writing titles"],
  ["description", "Writing the description"],
  ["tags", "Adding tags"],
  ["thumbnailTextShort", "Working on the thumbnail"],
  ["thumbnailTextMedium", "Working on the thumbnail"],
  ["thumbnailTextLong", "Working on the thumbnail"],
  ["thumbnailPeople", "Working on the thumbnail"],
  ["thumbnailVisual", "Working on the thumbnail"],
  ["lowerThirdHeadline", "Writing the headline"],
  ["nameplates", "Checking nameplates"],
  ["eventDate", "Confirming the date"],
  ["shorts", "Finding shorts"],
  ["adSuitability", "Checking ad suitability"],
  ["caution", "Wrapping up"],
];
function detectCurrentField(text) {
  // Scope to the CURRENT video only. Without this, starting a second video
  // in a multi-video result looked exactly like the whole thing restarting
  // from scratch — it's actually just moving on to the next one.
  const videoStarts = [...text.matchAll(/"clipType"\s*:/g)];
  const videoIndex = videoStarts.length;
  const videoText = videoIndex > 0 ? text.slice(videoStarts[videoStarts.length - 1].index) : text;
  const videoPrefix = videoIndex > 1 ? `Video ${videoIndex} — ` : "";

  let best = null, bestIdx = -1;
  for (const [key, label] of FIELD_LABELS) {
    const idx = videoText.lastIndexOf(`"${key}"`);
    if (idx > bestIdx) { bestIdx = idx; best = label; }
  }
  if (best === null) return null;

  // Once inside this video's shorts array, description/tags/adSuitability
  // belong to whichever SHORT is currently being written, not the video as
  // a whole — labeling them generically made writing five shorts look like
  // the same three steps looping forever with no explanation.
  const shortsStart = videoText.indexOf('"shorts"');
  if (shortsStart !== -1 && bestIdx >= shortsStart) {
    const shortsSoFar = [...videoText.slice(shortsStart).matchAll(/"startsWith"\s*:/g)].length;
    if (shortsSoFar > 0 && ["Writing the description", "Adding tags", "Checking ad suitability"].includes(best)) {
      return `${videoPrefix}Polishing short ${shortsSoFar}`;
    }
  }
  return videoPrefix + best;
}

// Shared by generatePackage and regenerateSection — the actual request,
// SSE parsing, extraction, and cache logging are identical for both; only
// what goes IN (system prompt, messages, token/search budget) and what
// happens to the parsed JSON afterward differs, and that's left to each
// caller.
async function streamAndParse({ system, messages, model, apiKey, maxTokens, maxSearches, onStatus, signal }) {
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
        max_tokens: maxTokens,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral", ttl: "1h" } }],
        messages,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearches }],
        stream: true,
      }),
      signal,
    });
  } catch (e) {
    if (e.name === "AbortError") { const err = new Error("Cancelled"); err.cancelled = true; throw err; }
    throw new Error("Couldn't reach the Claude API — check your connection.");
  }

  if (!res.ok) {
    let detail = "";
    try { const j = await res.json(); detail = (j.error && j.error.message) || ""; } catch (e) { /* non-JSON */ }
    if (res.status === 401) throw new Error("That Anthropic API key was rejected.");
    if (res.status === 429) throw new Error("Rate limited by Anthropic — wait a moment and retry.");
    throw new Error(detail || `Claude returned ${res.status}.`);
  }

  // Reading the stream by hand rather than through the SDK — this app talks
  // to the API directly from the browser, so server-sent events have to be
  // parsed manually.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const textParts = [];
  let searchCount = 0;
  let stopReason = null;
  let usage = {};
  let currentToolJson = "";
  let announcedCurrentQuery = false;
  let thinkingAnnounced = false;

  while (true) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (e) {
      if (e.name === "AbortError") { const err = new Error("Cancelled"); err.cancelled = true; throw err; }
      throw e;
    }
    const { done, value } = chunk;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // the last, possibly-incomplete line waits for the next chunk

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let evt;
      try { evt = JSON.parse(payload); } catch (e) { continue; }

      if (evt.type === "message_start" && evt.message && evt.message.usage) {
        usage = { ...usage, ...evt.message.usage };
      } else if (evt.type === "content_block_start") {
        currentToolJson = "";
        announcedCurrentQuery = false;
        thinkingAnnounced = false;
        if (evt.content_block && evt.content_block.type === "server_tool_use") {
          searchCount++;
          if (onStatus) onStatus({ phase: "searching", query: null, searchCount });
        } else if (evt.content_block && evt.content_block.type === "web_search_tool_result") {
          const results = Array.isArray(evt.content_block.content) ? evt.content_block.content : [];
          const domains = results
            .map((r) => { try { return new URL(r.url).hostname.replace(/^www\./, ""); } catch (e) { return null; } })
            .filter(Boolean);
          if (onStatus) onStatus({ phase: "search_results", searchCount, count: results.length, domains });
        } else if (evt.content_block && evt.content_block.type === "text") {
          if (onStatus) onStatus({ phase: "writing", chars: textParts.join("").length, field: detectCurrentField(textParts.join("")) });
        }
      } else if (evt.type === "content_block_delta" && evt.delta) {
        if (evt.delta.type === "text_delta") {
          textParts.push(evt.delta.text);
          const joined = textParts.join("");
          if (onStatus) onStatus({ phase: "writing", chars: joined.length, field: detectCurrentField(joined) });
        } else if (evt.delta.type === "thinking_delta") {
          if (onStatus && !thinkingAnnounced) { thinkingAnnounced = true; onStatus({ phase: "thinking" }); }
        } else if (evt.delta.type === "input_json_delta") {
          currentToolJson += evt.delta.partial_json || "";
          if (!announcedCurrentQuery) {
            const m = currentToolJson.match(/"query"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
            if (m) {
              announcedCurrentQuery = true;
              if (onStatus) onStatus({ phase: "searching", query: m[1].replace(/\\"/g, '"'), searchCount });
            }
          }
        }
      } else if (evt.type === "message_delta") {
        if (evt.delta && evt.delta.stop_reason) stopReason = evt.delta.stop_reason;
        if (evt.usage) usage = { ...usage, ...evt.usage };
      } else if (evt.type === "error") {
        throw new Error((evt.error && evt.error.message) || "The stream reported an error mid-generation.");
      }
    }
  }

  const text = textParts.join("").trim();

  const cacheInfo = {
    cacheWritten: usage.cache_creation_input_tokens || 0,
    cacheRead: usage.cache_read_input_tokens || 0,
    inputTokens: usage.input_tokens || 0,
  };
  if (cacheInfo.cacheRead > 0) {
    console.log(`[Clip Studio] Cache HIT — ${cacheInfo.cacheRead} tokens read from cache, ${cacheInfo.inputTokens} charged at full price.`);
  } else if (cacheInfo.cacheWritten > 0) {
    console.log(`[Clip Studio] Cache WRITE — ${cacheInfo.cacheWritten} tokens cached for next time (valid ~1h).`);
  } else {
    console.log("[Clip Studio] No cache activity on this request.");
  }

  const truncated = stopReason === "max_tokens";
  const parsed = extractJson(text);
  return { parsed, text, truncated, searchCount, cacheInfo };
}

export async function generatePackage({ history = [], apiKey, model = "claude-sonnet-5", onStatus, signal }) {
  const { parsed, text, truncated, searchCount, cacheInfo } = await streamAndParse({
    system: SYSTEM_PROMPT, messages: history, model, apiKey,
    maxTokens: 128000, maxSearches: 6, onStatus, signal,
  });

  // Recovery succeeded, even from a truncated response — real fields (a
  // complete title, three full shorts, etc.) go into the actual UI blocks
  // they belong in, not a wall of raw text. Flagged so the UI can still tell
  // the person something may be missing at the tail end.
  if (parsed) return { ...parsed, raw: text, searchCount, cacheInfo, truncated };

  // Nothing could be recovered at all — now it's genuinely worth naming the
  // cause plainly rather than showing an empty or unparseable result.
  if (truncated) {
    throw new Error(text
      ? "Claude ran out of output budget partway through, and not enough of the response could be recovered to show anything useful. Try again; a retry usually completes."
      : "Claude ran out of output budget mid-search, before writing any of the package — this task likely triggered a lot of search activity. Try again; it usually completes on a retry.");
  }

  return { raw: text, parseFailed: true, description: text, searchCount, cacheInfo };
}
