// Minimal HLS (.m3u8) downloader that runs entirely in the browser.
//
// The whole point is that video goes straight from the source to the editor's
// machine — it never touches our storage, so there's nothing to host or pay for.
//
// The hard limit is CORS: a browser may only read bytes from another origin if
// that server sends Access-Control-Allow-Origin. Many video CDNs don't, and no
// client-side code can bypass it. When that happens we say so plainly rather
// than failing with a vague network error.

function resolveUrl(url, base) {
  try {
    return new URL(url, base).href;
  } catch (e) {
    return url;
  }
}

function parseAttributes(line) {
  // e.g. METHOD=AES-128,URI="key.bin",IV=0x1234
  const attrs = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m;
  while ((m = re.exec(line))) {
    attrs[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return attrs;
}

function hexToBytes(hex) {
  const clean = hex.replace(/^0x/i, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

/**
 * Parse a playlist. Returns either a list of variants (master playlist) or a
 * list of segments (media playlist).
 */
export function parsePlaylist(text, playlistUrl) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const variants = [];
  const segments = [];
  let currentKey = null;
  let initSegment = null;
  let mediaSequence = 0;
  let pendingVariant = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      mediaSequence = parseInt(line.split(":")[1], 10) || 0;
      continue;
    }
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      pendingVariant = parseAttributes(line);
      continue;
    }
    if (line.startsWith("#EXT-X-KEY:")) {
      const a = parseAttributes(line);
      currentKey = a.METHOD && a.METHOD !== "NONE"
        ? { method: a.METHOD, uri: a.URI ? resolveUrl(a.URI, playlistUrl) : null, iv: a.IV || null }
        : null;
      continue;
    }
    if (line.startsWith("#EXT-X-MAP:")) {
      const a = parseAttributes(line);
      if (a.URI) initSegment = resolveUrl(a.URI, playlistUrl);
      continue;
    }
    if (line.startsWith("#")) continue;

    // A non-tag line is a URL — either a variant or a segment.
    if (pendingVariant) {
      variants.push({
        url: resolveUrl(line, playlistUrl),
        bandwidth: parseInt(pendingVariant.BANDWIDTH, 10) || 0,
        resolution: pendingVariant.RESOLUTION || null,
      });
      pendingVariant = null;
    } else {
      segments.push({
        url: resolveUrl(line, playlistUrl),
        key: currentKey,
        seq: mediaSequence + segments.length,
      });
    }
  }

  return { variants, segments, initSegment, isMaster: variants.length > 0 };
}

async function fetchWithCheck(url, signal) {
  let res;
  try {
    res = await fetch(url, { signal, mode: "cors" });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    const err = new Error("blocked");
    err.code = "CORS";
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Server returned ${res.status}`);
    err.code = "HTTP";
    throw err;
  }
  return res;
}

async function decryptSegment(buffer, key, seq, keyCache) {
  if (!key || key.method !== "AES-128" || !key.uri) return buffer;
  // Cache the PROMISE, not just the resolved key — several workers can reach
  // this before the first fetch finishes, and without deduplicating the
  // in-flight request itself, every one of them would fetch the key.
  let cryptoKeyPromise = keyCache.get(key.uri);
  if (!cryptoKeyPromise) {
    cryptoKeyPromise = (async () => {
      const keyRes = await fetch(key.uri, { mode: "cors" });
      const keyBytes = await keyRes.arrayBuffer();
      return crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]);
    })();
    keyCache.set(key.uri, cryptoKeyPromise);
  }
  const cryptoKey = await cryptoKeyPromise;
  // If no IV is given, HLS uses the segment sequence number as a big-endian 128-bit value.
  let iv;
  if (key.iv) {
    iv = hexToBytes(key.iv);
  } else {
    iv = new Uint8Array(16);
    new DataView(iv.buffer).setUint32(12, seq);
  }
  return crypto.subtle.decrypt({ name: "AES-CBC", iv }, cryptoKey, buffer);
}

async function fetchSegment(seg, signal, keyCache, retries = 3) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithCheck(seg.url, signal);
      let buf = await res.arrayBuffer();
      if (seg.key) buf = await decryptSegment(buf, seg.key, seg.seq, keyCache);
      return buf;
    } catch (e) {
      if (e.name === "AbortError") throw e;
      lastErr = e;
      // A long download hitting one flaky segment shouldn't restart from zero —
      // a short backoff and retry handles the transient case; only a segment
      // that keeps failing after retries actually fails the download.
      if (attempt < retries) await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
    }
  }
  throw lastErr;
}

/**
 * Download an HLS stream. On Chrome/Edge this writes straight to disk as
 * segments arrive, so a multi-hour file never has to fit in memory — the one
 * cost is a native "save as" prompt at the start, asked once, before any
 * fetching begins. Elsewhere it falls back to assembling in memory and
 * returning a Blob for the caller to save.
 *
 * onProgress({ phase, done, total })
 */
export async function downloadHls(url, { onProgress, signal, quality = "highest", concurrency = 6, filenameBase = "clip" } = {}) {
  const report = (phase, done, total) => { if (onProgress) onProgress({ phase, done, total }); };

  report("manifest", 0, 0);
  const manifestRes = await fetchWithCheck(url, signal);
  const manifestText = await manifestRes.text();

  let parsed = parsePlaylist(manifestText, url);

  // Master playlist: pick a variant, then fetch that media playlist.
  if (parsed.isMaster) {
    if (!parsed.variants.length) {
      const e = new Error("No streams found in that playlist.");
      e.code = "EMPTY";
      throw e;
    }
    const sorted = [...parsed.variants].sort((a, b) => b.bandwidth - a.bandwidth);
    const chosen = quality === "lowest" ? sorted[sorted.length - 1] : sorted[0];
    const mediaRes = await fetchWithCheck(chosen.url, signal);
    const mediaText = await mediaRes.text();
    parsed = parsePlaylist(mediaText, chosen.url);
  }

  if (!parsed.segments.length) {
    const e = new Error("That playlist has no video segments.");
    e.code = "EMPTY";
    throw e;
  }

  const isFmp4 = !!parsed.initSegment;
  const extension = isFmp4 ? "mp4" : "ts";
  const mimeType = isFmp4 ? "video/mp4" : "video/mp2t";

  // Ask where to save before doing any of the heavy work — one decision up
  // front, not a surprise after an hour of downloading. If the picker isn't
  // available (non-Chromium browser) or the person cancels it, fall back to
  // the in-memory path instead of failing outright.
  let writable = null;
  let useStreaming = false;
  if (typeof window !== "undefined" && window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${filenameBase}.${extension}`,
        types: [{ description: "Video", accept: { [mimeType]: [`.${extension}`] } }],
      });
      writable = await handle.createWritable();
      useStreaming = true;
    } catch (e) {
      if (e.name === "AbortError") throw e; // the person cancelled the save dialog on purpose
      useStreaming = false;
    }
  }

  const keyCache = new Map();
  const parts = useStreaming ? null : [];

  if (parsed.initSegment) {
    const initBuf = await (await fetchWithCheck(parsed.initSegment, signal)).arrayBuffer();
    if (useStreaming) await writable.write(initBuf); else parts.push(initBuf);
  }

  const total = parsed.segments.length;
  const results = new Array(total);
  let nextToWrite = 0;
  let fetchIndex = 0;
  let completedCount = 0;

  // Segments are fetched several at a time but must land on disk in order —
  // this chains writes through a single promise so concurrent completions
  // can never interleave or race each other.
  let writeLock = Promise.resolve();
  const flushReady = () => {
    writeLock = writeLock.then(async () => {
      while (nextToWrite < total && results[nextToWrite] !== undefined) {
        const buf = results[nextToWrite];
        if (useStreaming) await writable.write(buf); else parts.push(buf);
        results[nextToWrite] = undefined; // let it be garbage-collected once written
        nextToWrite++;
      }
    });
    return writeLock;
  };

  const worker = async () => {
    for (;;) {
      if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
      const i = fetchIndex++;
      if (i >= total) return;
      const buf = await fetchSegment(parsed.segments[i], signal, keyCache);
      results[i] = buf;
      completedCount++;
      report("segments", completedCount, total);
      await flushReady();
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
    await flushReady();
  } catch (e) {
    if (useStreaming) { try { await writable.abort(); } catch (_) { /* best effort */ } }
    throw e;
  }

  if (useStreaming) {
    await writable.close();
    return { streamed: true, extension, segmentCount: total };
  }
  return { blob: new Blob(parts, { type: mimeType }), extension, segmentCount: total };
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function isM3u8(url) {
  // Deliberately loose: real HLS URLs carry tokens, extra path segments after
  // the extension, or sit behind redirects. Anything mentioning m3u8 counts.
  return /m3u8/i.test((url || "").trim());
}

// YouTube can't be fetched by a browser at all — CORS plus a signature cipher
// that requires running YouTube's own JS. So these links get handed to yt-dlp
// on the editor's machine instead. The URL never appears in the interface;
// it goes straight to the clipboard inside a ready-to-run command.
export function isYouTube(url) {
  return /(?:youtube\.com|youtu\.be)/i.test((url || "").trim());
}

// Some CDNs reject a request outright unless it carries a Referer header
// matching the site that's supposed to be serving the player — a browser
// sends this automatically for its own fetches (which is part of why the
// in-browser downloader above still fails for these same sources via CORS),
// but yt-dlp on the command line sends nothing unless told to. Known
// per-domain requirements, added as they're actually discovered — C-SPAN's
// video CDN is confirmed to need this exact value.
const REFERER_BY_HOST = [
  { test: /c-spanvideo\.org$/i, referer: "https://www.c-span.org/" },
];

function refererFor(url) {
  try {
    const host = new URL(url).hostname;
    const match = REFERER_BY_HOST.find((r) => r.test.test(host));
    return match ? match.referer : null;
  } catch (e) {
    return null;
  }
}

export function ytDlpCommand(url, name, isStream) {
  const safe = (name || "video").replace(/[^a-z0-9]+/gi, "_").slice(0, 60);
  // Premiere can't decode AV1 or VP9, and YouTube now serves AV1 inside .mp4
  // containers — so asking for "mp4" isn't enough. Demand H.264 (avc1) video
  // and AAC (mp4a) audio explicitly, falling back progressively.
  const format = [
    "bv*[vcodec^=avc1][ext=mp4]+ba[acodec^=mp4a]", // ideal: pure remux, no re-encode
    "bv*[vcodec^=avc1]+ba",                        // H.264 video, any audio
    "b[vcodec^=avc1]",                             // single H.264 file
    "bv*+ba/b",                                    // last resort, may need recoding
  ].join("/");
  const referer = refererFor(url);
  return [
    "yt-dlp",
    "-N", "8", // parallel fragment downloads — the same latency problem our own downloader solves, yt-dlp solves with this flag
    // A live source's fragment count grows the whole time it's broadcasting,
    // so the initial estimate goes stale almost immediately — that's why the
    // progress percentage looks wrong on something like a live hearing feed.
    // --live-from-start captures the real broadcast from its actual
    // beginning rather than wherever the manifest happened to be when the
    // download started. Only added when the link is actually marked as a
    // stream — it changes behavior meaningfully and shouldn't apply to an
    // already-finished recording.
    ...(isStream ? ["--live-from-start"] : []),
    ...(referer ? ["--referer", `"${referer}"`] : []),
    "-f", `"${format}"`,
    "--merge-output-format", "mp4",
    "-o", `"${safe}.%(ext)s"`,
    `"${(url || "").trim()}"`,
  ].join(" ");
}

