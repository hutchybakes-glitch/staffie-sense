// storage.js — on-device persistence (localStorage), every access wrapped in try/catch
// because Safari private mode or blocked storage can throw.

const PREFIX = 'staffie-sense.';

// Read and JSON-parse a stored value; returns fallback on any problem.
export function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) {
    console.warn('storage load failed', key, e);
    return fallback;
  }
}

// JSON-stringify and store a value; returns true on success.
export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('storage save failed', key, e);
    return false;
  }
}

// Remove a stored value.
export function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch (e) {
    console.warn('storage remove failed', key, e);
  }
}

// Offer a file to the user: iOS share sheet when it can take files, otherwise a download link.
export async function saveFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  try {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch (e) {
    // User cancelled the share sheet, or sharing isn't allowed: fall through to download.
    if (e && e.name === 'AbortError') return;
    console.warn('share failed, downloading instead', e);
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
