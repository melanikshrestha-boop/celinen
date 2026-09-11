const OPEN = "\uE000";
const CLOSE = "\uE001";

/** VS Code Dark+ colors on docs snippets. Placeholders are letter-tagged so numbers cannot eat them. */
export function highlightDocsCode(code: string): string {
  let text = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const held: string[] = [];
  const keep = (html: string) => {
    const i = held.length;
    held.push(html);
    return `${OPEN}x${i}x${CLOSE}`;
  };
  text = text.replace(/"((?:\\.|[^"\\])*)"(?=\s*:)/g, (_, key: string) =>
    keep(`<span class="docs-tok-key">"${key}"</span>`),
  );
  text = text.replace(/"((?:\\.|[^"\\])*)"/g, (value) => keep(`<span class="docs-tok-str">${value}</span>`));
  text = text.replace(
    /\b(curl|from|import|print|const|await|return|true|false|null|class)\b/g,
    '<span class="docs-tok-kw">$1</span>',
  );
  text = text.replace(/(^|\s)(-[A-Za-z])\b/g, '$1<span class="docs-tok-flag">$2</span>');
  text = text.replace(
    /\b(Authorization|Bearer|Content-Type|OpenAI)\b/g,
    '<span class="docs-tok-type">$1</span>',
  );
  text = text.replace(/\b([A-Za-z_][\w]*)(?=\()/g, '<span class="docs-tok-fn">$1</span>');
  text = text.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="docs-tok-num">$1</span>');
  return text.replace(new RegExp(`${OPEN}x(\\d+)x${CLOSE}`, "g"), (_, index: string) => held[Number(index)]!);
}
