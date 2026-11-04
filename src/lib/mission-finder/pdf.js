// 結果の紙面（result.js の pdfHtml）を画面の外に描いて画像にし、A4 の PDF にしてそのままダウンロードさせる。
// 文字も画像として入るので、日本語フォントを埋め込まなくていい。
// 画像にするライブラリ（html2canvas-pro）は、ボタンを押したときにだけ読み込む。

const MM = 72 / 25.4; // 1mm を PDF の pt に
const PAGE = { w: 210 * MM, h: 297 * MM };
const MARGIN = { x: 14 * MM, top: 14 * MM, bottom: 16 * MM };
const CONTENT = { w: PAGE.w - MARGIN.x * 2, h: PAGE.h - MARGIN.top - MARGIN.bottom };
const PX_PER_PT = 96 / 72;
// 紙面を描く幅（CSS px）。紙面の CSS は pt で書いてあり、A4 の本文幅で組むとちょうどいい
const SHEET_WIDTH = Math.round(CONTENT.w * PX_PER_PT);
const PAGE_HEIGHT = Math.floor(CONTENT.h * PX_PER_PT);
// iPhone の Safari はキャンバスの面積に上限があるので、それを超えない倍率で描く
const MAX_CANVAS_AREA = 16_000_000;

// 紙面の HTML から PDF をつくってダウンロードさせる
export async function downloadPdf(html, filename) {
  const { default: html2canvas } = await import('html2canvas-pro');
  const host = document.createElement('div');
  host.className = 'mf-pdf-host';
  host.setAttribute('aria-hidden', 'true');
  host.style.width = `${SHEET_WIDTH}px`;
  host.innerHTML = html;
  document.body.appendChild(host);
  try {
    await document.fonts?.ready;
    const sheet = host.firstElementChild;
    const height = sheet.offsetHeight;
    const scale = Math.min(2, Math.sqrt(MAX_CANVAS_AREA / (SHEET_WIDTH * height)));
    const canvas = await html2canvas(sheet, { scale, backgroundColor: '#ffffff', logging: false });
    const pages = [];
    for (const [top, bottom] of pageRanges(sheet, height)) {
      pages.push(await pageImage(canvas, top * scale, (bottom - top) * scale, bottom - top));
    }
    save(pdfFromImages(pages), filename);
  } finally {
    host.remove();
  }
}

// 1ページに収まる高さで、ブロックの切れ目を選んで区切る（行の途中で切らない）
function pageRanges(sheet, height) {
  const origin = sheet.getBoundingClientRect().top;
  const cuts = [...sheet.querySelectorAll(':scope > *, .mfp-sec > :nth-child(n+3), .mfp-list > li, .mfp-missions > li')]
    .map((el) => Math.round(el.getBoundingClientRect().top - origin))
    .filter((y) => y > 0)
    .sort((a, b) => a - b);
  const ranges = [];
  let top = 0;
  while (height - top > PAGE_HEIGHT) {
    const fits = cuts.filter((y) => y > top && y <= top + PAGE_HEIGHT);
    // 1ページより高いブロックしかないときだけ、ページの高さでそのまま切る
    const bottom = fits.length ? fits[fits.length - 1] : top + PAGE_HEIGHT;
    ranges.push([top, bottom]);
    top = bottom;
  }
  ranges.push([top, height]);
  return ranges;
}

// キャンバスの一部を切り出して JPEG にする
async function pageImage(canvas, sy, sh, cssHeight) {
  const page = document.createElement('canvas');
  page.width = canvas.width;
  page.height = Math.max(1, Math.round(sh));
  const ctx = page.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, page.width, page.height);
  ctx.drawImage(canvas, 0, Math.round(sy), page.width, page.height, 0, 0, page.width, page.height);
  const blob = await new Promise((resolve) => page.toBlob(resolve, 'image/jpeg', 0.9));
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: page.width, height: page.height, ptHeight: cssHeight / PX_PER_PT };
}

// JPEG を1ページに1枚ずつ貼っただけの PDF を組み立てる
function pdfFromImages(pages) {
  const encoder = new TextEncoder();
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (part) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (id, ...body) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    body.forEach(push);
    push('\nendobj\n');
  };
  const n = (value) => value.toFixed(2);

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // バイナリを含むことを示す行
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  pages.forEach((p, i) => {
    const [pageId, contentId, imageId] = [3 + i * 3, 4 + i * 3, 5 + i * 3];
    const y = PAGE.h - MARGIN.top - p.ptHeight;
    const content = `q ${n(CONTENT.w)} 0 0 ${n(p.ptHeight)} ${n(MARGIN.x)} ${n(y)} cm /Im0 Do Q`;
    object(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(PAGE.w)} ${n(PAGE.h)}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    object(contentId, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    object(imageId,
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg,
      '\nendstream');
  });

  const xref = length;
  push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (let id = 1; id < offsets.length; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

function save(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // iPhone はダウンロードの確認を待つので、すぐには消さない
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
