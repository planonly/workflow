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

async function decryptSegment(buffer, key, seq) {
  if (!key || key.method !== "AES-128" || !key.uri) return buffer;
  const keyRes = await fetch(key.uri, { mode: "cors" });
  const keyBytes = await keyRes.arrayBuffer();
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]);
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

/**
 * Download an HLS stream and return a Blob.
 * onProgress({ done, total, phase })
 */
export async function downloadHls(url, { onProgress, signal, quality = "highest" } = {}) {
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

  const parts = [];

  if (parsed.initSegment) {
    const initRes = await fetchWithCheck(parsed.initSegment, signal);
    parts.push(await initRes.arrayBuffer());
  }

  const total = parsed.segments.length;
  for (let i = 0; i < total; i++) {
    if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
    const seg = parsed.segments[i];
    const res = await fetchWithCheck(seg.url, signal);
    let buf = await res.arrayBuffer();
    if (seg.key) buf = await decryptSegment(buf, seg.key, seg.seq);
    parts.push(buf);
    report("segments", i + 1, total);
  }

  const isFmp4 = !!parsed.initSegment;
  return {
    blob: new Blob(parts, { type: isFmp4 ? "video/mp4" : "video/mp2t" }),
    extension: isFmp4 ? "mp4" : "ts",
    segmentCount: total,
  };
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

export function ytDlpCommand(url, name) {
  const safe = (name || "video").replace(/[^a-z0-9]+/gi, "_").slice(0, 60);
  return `yt-dlp -o "${safe}.%(ext)s" "${(url || "").trim()}"`;
}
