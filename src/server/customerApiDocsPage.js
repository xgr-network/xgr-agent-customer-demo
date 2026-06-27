import fs from 'fs';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(text) {
  const escaped = escapeHtml(text);
  const withLinks = escaped.replace(
    /\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g,
    (_match, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`,
  );
  return withLinks.replace(/`([^`]+)`/g, '<code>$1</code>');
}

function markdownToHtml(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const out = [];
  let inCode = false;
  let codeLines = [];
  let listType = '';

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = '';
    }
  };

  const openList = (type) => {
    if (listType === type) return;
    closeList();
    out.push(`<${type}>`);
    listType = type;
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      closeList();
      const level = Math.min(4, heading[1].length);
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = /^-\s+(.+)$/.exec(line);
    if (bullet) {
      openList('ul');
      out.push(`<li>${renderInline(bullet[1])}</li>`);
      continue;
    }

    const numbered = /^\d+\.\s+(.+)$/.exec(line);
    if (numbered) {
      openList('ol');
      out.push(`<li>${renderInline(numbered[1])}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${renderInline(line)}</p>`);
  }

  closeList();
  if (inCode) out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  return out.join('\n');
}

export function renderCustomerApiDocsPage(markdownPath) {
  const markdown = fs.readFileSync(markdownPath, 'utf8');
  const body = markdownToHtml(markdown);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>XGR Agent Customer API Guide</title>
  <style>
    :root { color-scheme: dark; background: #07120f; color: #ecfff8; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: radial-gradient(circle at 8% -10%, rgba(64, 255, 179, .18), transparent 34%), radial-gradient(circle at 92% 8%, rgba(29, 191, 126, .12), transparent 26%), #07120f; }
    main { max-width: 1120px; margin: 0 auto; padding: 42px 22px 86px; }
    .top { border: 1px solid rgba(128,255,208,.18); background: linear-gradient(145deg, rgba(255,255,255,.07), rgba(255,255,255,.025)); border-radius: 30px; padding: clamp(22px, 4vw, 34px); margin-bottom: 24px; box-shadow: 0 26px 80px rgba(0,0,0,.24); }
    .eyebrow { margin: 0 0 10px; color: #9affd1; font-size: 12px; font-weight: 900; letter-spacing: .16em; text-transform: uppercase; }
    h1 { max-width: 900px; font-size: clamp(34px, 6vw, 70px); line-height: .96; margin: 0 0 16px; letter-spacing: -.05em; }
    .lead { max-width: 860px; font-size: clamp(16px, 2vw, 20px); color: rgba(236,255,248,.78); }
    .guide-meta { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 18px; }
    .guide-meta span { border: 1px solid rgba(154,255,209,.18); border-radius: 999px; padding: 7px 10px; background: rgba(154,255,209,.07); color: #b7ffdc; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 22px; }
    .button { display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; padding: 12px 16px; text-decoration: none; font-weight: 900; color: #ecfff8; background: rgba(255,255,255,.07); }
    .button.primary { background: linear-gradient(135deg, #51ffb3, #2eca7f); color: #062017; border: 0; }
    .doc-body { display: grid; gap: 14px; }
    .doc-body h2 { margin: 28px 0 0; padding-top: 24px; border-top: 1px solid rgba(154,255,209,.14); color: #9affd1; font-size: clamp(24px, 3vw, 34px); letter-spacing: -.03em; }
    .doc-body h3 { margin: 20px 0 0; color: #dfffee; font-size: 20px; }
    .doc-body h4 { margin: 16px 0 0; color: #ecfff8; }
    p, li { max-width: 920px; color: rgba(236,255,248,.76); line-height: 1.65; }
    ul, ol { margin-top: 0; }
    li + li { margin-top: 7px; }
    a { color: #8effc4; }
    code { color: #b8ffd9; background: rgba(0,0,0,.28); padding: 2px 5px; border-radius: 6px; }
    pre { overflow-x: auto; border-radius: 18px; border: 1px solid rgba(128,255,208,.18); background: rgba(0,0,0,.36); padding: 16px; line-height: 1.45; }
    pre code { background: transparent; padding: 0; }
    @media (max-width: 720px) {
      main { padding: 24px 14px 60px; }
      .top { border-radius: 24px; }
      .actions { display: grid; }
      .button { width: 100%; }
    }
  </style>
</head>
<body>
  <main>
    <section class="top">
      <p class="eyebrow">Customer rebuild guide</p>
      <h1>XGR Agent Customer API Guide</h1>
      <p class="lead">Copy the API flow into your own backend: load a document, extract business data with an AI agent, start a waiter session, wake XDaLa, and load explorer receipts.</p>
      <div class="guide-meta">
        <span>Backend first</span>
        <span>Multiuser safe</span>
        <span>XDaLa RPC</span>
        <span>Explorer receipts</span>
      </div>
      <div class="actions">
        <a class="button primary" href="/">Back to demo</a>
        <a class="button" href="/api/downloads/customer-api-doc">Download markdown</a>
        <a class="button" href="/api/downloads/waiter-bundle-configured">Download configured bundle</a>
      </div>
    </section>
    <section class="doc-body">
${body}
    </section>
  </main>
</body>
</html>`;
}
