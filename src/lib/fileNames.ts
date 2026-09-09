const sentenceBoundary = /[。！？!?]|\.(?=\s|$)/;
const leadingMarkup = /^(?:#{1,6}\s+|[-*+]\s+|\d+[.)、]\s*)/;

export function derivePasteTitle(content: string, fallback = "未命名粘贴", maxLength = 80) {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
  const normalized = firstLine
    .replace(leadingMarkup, "")
    .replace(/\s+/g, " ")
    .trim();
  const boundary = normalized.search(sentenceBoundary);
  const firstSentence = (boundary >= 0 ? normalized.slice(0, boundary) : normalized)
    .replace(/[。！？!?.,，；;：:]+$/g, "")
    .trim();
  return [...(firstSentence || fallback)].slice(0, maxLength).join("");
}
