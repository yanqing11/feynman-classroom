/** 诊断报告长图渲染，按需加载，避免拖慢首屏。 */
import { METRICS } from './config.js';

const REPORT_IMAGE_FONT =
  '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif';

function wrapCanvasText(ctx, text, maxWidth, limit = 0) {
  const source = String(text || '').replace(/\r/g, '');
  const lines = [];
  for (const paragraph of source.split('\n')) {
    if (!paragraph.trim()) {
      if (lines.length) lines.push('');
      continue;
    }
    let line = '';
    for (const char of paragraph) {
      const next = line + char;
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line.trimEnd());
        line = char.trimStart();
        if (limit && lines.length >= limit) return lines;
      } else {
        line = next;
      }
    }
    if (line.trim()) lines.push(line.trimEnd());
    if (limit && lines.length >= limit) return lines.slice(0, limit);
  }
  return limit ? lines.slice(0, limit) : lines;
}

function roundRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

export async function renderReportImage(report, { topic = '', meta = '' } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');

  const W = 1080;
  const M = 68;
  const contentWidth = W - M * 2;
  ctx.font = `600 38px ${REPORT_IMAGE_FONT}`;
  const topicLines = wrapCanvasText(ctx, topic, contentWidth, 3);
  ctx.font = `400 23px ${REPORT_IMAGE_FONT}`;
  const verdictLines = wrapCanvasText(ctx, report.verdict || '', contentWidth, 8);
  const gaps = (report.misconceptions || []).slice(0, 2);
  ctx.font = `600 24px ${REPORT_IMAGE_FONT}`;
  const gapTitleLines = gaps.map((gap) =>
    wrapCanvasText(ctx, `${gap.title || '理解缺口'}`, contentWidth - 52, 2)
  );
  ctx.font = `400 21px ${REPORT_IMAGE_FONT}`;
  const gapFixLines = gaps.map((gap) =>
    wrapCanvasText(ctx, gap.fix || gap.why || '', contentWidth - 52, 3)
  );

  const topicBlock = 40 + topicLines.length * 48;
  const metricBlock = 3 * 74 + 18;
  const verdictBlock = 44 + verdictLines.length * 36 + 18;
  let gapsBlock = 0;
  gaps.forEach((gap, index) => {
    gapsBlock += 40 + gapTitleLines[index].length * 32 + gapFixLines[index].length * 30 + 22;
  });
  const H = Math.max(
    1200,
    178 +
      topicBlock +
      38 +
      Math.max(190, metricBlock) +
      verdictBlock +
      (gaps.length ? gapsBlock + 26 : 0) +
      168
  );

  canvas.width = W;
  canvas.height = H;

  ctx.fillStyle = '#f6f2e9';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#1f6f5c';
  roundRectPath(ctx, 0, 0, W, 150, 0);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 253, 248, 0.9)';
  ctx.font = `700 27px ${REPORT_IMAGE_FONT}`;
  ctx.fillText('费曼小课堂', M, 66);
  ctx.fillStyle = 'rgba(255, 253, 248, 0.62)';
  ctx.font = `600 15px ${REPORT_IMAGE_FONT}`;
  ctx.fillText('FEYNMAN CLASSROOM · LEARNING DIAGNOSIS', M, 96);
  const dateText = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(new Date());
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255, 253, 248, 0.82)';
  ctx.font = `500 18px ${REPORT_IMAGE_FONT}`;
  ctx.fillText(dateText, W - M, 74);
  ctx.textAlign = 'left';

  let y = 208;

  ctx.fillStyle = '#4f5c55';
  ctx.font = `700 15px ${REPORT_IMAGE_FONT}`;
  ctx.fillText('本次课题', M, y);
  y += 34;
  ctx.fillStyle = '#1f2a2a';
  ctx.font = `600 38px ${REPORT_IMAGE_FONT}`;
  for (const line of topicLines) {
    ctx.fillText(line, M, y);
    y += 48;
  }
  if (meta) {
    ctx.fillStyle = '#5c6861';
    ctx.font = `400 19px ${REPORT_IMAGE_FONT}`;
    ctx.fillText(meta, M, y + 2);
    y += 34;
  }
  y += 22;

  const scoreTop = y;
  const scoreHeight = Math.max(190, metricBlock);
  ctx.fillStyle = '#fffdf8';
  roundRectPath(ctx, M, scoreTop, contentWidth, scoreHeight, 22);
  ctx.fill();
  ctx.strokeStyle = '#ded6c6';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const overall = Number(report.overallScore);
  const scoreText = Number.isFinite(overall) ? `${Math.round(overall)}` : '—';
  ctx.fillStyle = '#1f6f5c';
  ctx.font = `700 104px ${REPORT_IMAGE_FONT}`;
  ctx.fillText(scoreText, M + 44, scoreTop + 118);
  const scoreWidth = ctx.measureText(scoreText).width;
  ctx.fillStyle = '#5c6861';
  ctx.font = `700 26px ${REPORT_IMAGE_FONT}`;
  ctx.fillText('%', M + 44 + scoreWidth + 6, scoreTop + 118);
  ctx.fillStyle = '#4f5c55';
  ctx.font = `600 18px ${REPORT_IMAGE_FONT}`;
  ctx.fillText('综合评分', M + 44, scoreTop + 152);

  const barLeft = M + 330;
  const barWidth = contentWidth - 330 - 46;
  METRICS.forEach((metric, index) => {
    const rowY = scoreTop + 44 + index * 54;
    const value = Number(report.scores?.[metric.key]);
    ctx.fillStyle = '#45524f';
    ctx.font = `600 19px ${REPORT_IMAGE_FONT}`;
    ctx.fillText(metric.label, barLeft, rowY);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#1f6f5c';
    ctx.font = `700 19px ${REPORT_IMAGE_FONT}`;
    ctx.fillText(Number.isFinite(value) ? `${Math.round(value)}%` : '—', barLeft + barWidth, rowY);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#efe9dc';
    roundRectPath(ctx, barLeft, rowY + 12, barWidth, 8, 4);
    ctx.fill();
    if (Number.isFinite(value)) {
      ctx.fillStyle = '#1f6f5c';
      roundRectPath(
        ctx,
        barLeft,
        rowY + 12,
        Math.max(8, (barWidth * Math.min(100, Math.max(0, value))) / 100),
        8,
        4
      );
      ctx.fill();
    }
  });

  y = scoreTop + scoreHeight + 48;

  ctx.fillStyle = '#4f5c55';
  ctx.font = `700 15px ${REPORT_IMAGE_FONT}`;
  ctx.fillText('老师总评', M, y);
  y += 30;
  ctx.fillStyle = '#1f2a2a';
  ctx.font = `400 23px ${REPORT_IMAGE_FONT}`;
  for (const line of verdictLines) {
    ctx.fillText(line, M, y);
    y += 36;
  }
  y += 20;

  if (gaps.length) {
    ctx.fillStyle = '#4f5c55';
    ctx.font = `700 15px ${REPORT_IMAGE_FONT}`;
    ctx.fillText('关键理解缺口', M, y);
    y += 30;
    gaps.forEach((gap, index) => {
      const top = y;
      const titleLines = gapTitleLines[index];
      const fixLines = gapFixLines[index];
      const boxHeight = 16 + titleLines.length * 32 + fixLines.length * 30 + 12;
      ctx.fillStyle = '#fbf7ee';
      roundRectPath(ctx, M, top, contentWidth, boxHeight, 16);
      ctx.fill();
      ctx.fillStyle = '#c15b3f';
      ctx.font = `700 18px ${REPORT_IMAGE_FONT}`;
      ctx.fillText(String(index + 1).padStart(2, '0'), M + 18, top + 32);
      ctx.fillStyle = '#1f2a2a';
      ctx.font = `600 24px ${REPORT_IMAGE_FONT}`;
      let lineY = top + 34;
      for (const line of titleLines) {
        ctx.fillText(line, M + 52, lineY);
        lineY += 32;
      }
      ctx.fillStyle = '#45524f';
      ctx.font = `400 21px ${REPORT_IMAGE_FONT}`;
      for (const line of fixLines) {
        ctx.fillText(line, M + 52, lineY);
        lineY += 30;
      }
      y = top + boxHeight + 18;
    });
  }

  y = H - 92;
  ctx.fillStyle = '#ded6c6';
  ctx.fillRect(M, y - 26, contentWidth, 1);
  ctx.fillStyle = '#5c6861';
  ctx.font = `600 17px ${REPORT_IMAGE_FONT}`;
  ctx.fillText('费曼小课堂 · 输出，是最好的输入。', M, y + 6);
  ctx.textAlign = 'right';
  ctx.font = `400 15px ${REPORT_IMAGE_FONT}`;
  ctx.fillText('AI 生成，仅用于学习诊断', W - M, y + 6);
  ctx.textAlign = 'left';

  return new Promise((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('blob'))), 'image/png');
  });
}
