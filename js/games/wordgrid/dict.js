// Dictionary: ENABLE public-domain word list (3–16 letter words).
// Loaded once in the background at app boot; ~500KB gzipped over the wire.

let dictPromise = null;

export function loadDictionary() {
  if (!dictPromise) {
    dictPromise = fetch(new URL("../../../data/dictionary.txt", import.meta.url))
      .then((r) => {
        if (!r.ok) throw new Error(`dictionary fetch failed: ${r.status}`);
        return r.text();
      })
      .then((text) => new Set(text.split("\n").filter(Boolean)));
  }
  return dictPromise;
}
