/** 教师学情长图渲染，按需加载，避免拖慢学习档案首屏。 */
import { METRICS } from './config.js';
import { summarizeTeacherView } from './history.js';

const IMAGE_FONT =
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

function pct(value) {
  return Number.isFinite(value) ? `${Math.round(value)}%` : '—';
}

function deltaText(delta) {
  if (!Number.isFinite(delta)) return '';
  const rounded = Math.round(delta);
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}

function sectionTitle(ctx, text, x, y) {
  ctx.fillStyle = '#4f5c55';
  ctx.font = `700 16px ${IMAGE_FONT}`;
  ctx.fillText(text, x, y);
}

/**
 * 把当前筛选范围内的教师学情画成 1080px 宽的长图。
 * 只使用本机档案汇总结果，不新增任何网络请求。
 */
export async function renderTeacherImage(records) {
  const view = summarizeTeacherView(records);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');

  const W = 1080;
  const M = 68;
  const CW = W - M * 2;

  ctx.font = `400 26px ${IMAGE_FONT}`;
  const headlineLines = wrapCanvasText(ctx, view.headline, CW, 5);

  const weak = view.weakTags.slice(0, 3).map((item) => {
    ctx.font = `400 19px ${IMAGE_FONT}`;
    return {
      item,
      quote: wrapCanvasText(ctx, item.quote ? `学生原话：「${item.quote}」` : '', CW - 30, 2)
    };
  });
  const gaps = view.misconceptions.slice(0, 3).map((item) => {
    ctx.font = `400 19px ${IMAGE_FONT}`;
    return {
      item,
      fix: wrapCanvasText(ctx, item.fix || item.why || '', CW - 30, 2),
      quote: wrapCanvasText(ctx, item.quote ? `学生原话：「${item.quote}」` : '', CW - 30, 2)
    };
  });
  const steps = view.prioritySteps.slice(0, 3).map((item) => {
    ctx.font = `400 19px ${IMAGE_FONT}`;
    return {
      item,
      action: wrapCanvasText(ctx, item.action || item.example || '', CW - 30, 2)
    };
  });
  const stuckItems = view.stuckQuestions.slice(0, 3).map((item) => {
    ctx.font = `400 18px ${IMAGE_FONT}`;
    return {
      item,
      question: wrapCanvasText(
        ctx,
        item.question ? `问：「${item.question}」（卡住 ${item.count} 次）` : '某一步讲解',
        CW - 30,
        2
      ),
      answer: wrapCanvasText(ctx, item.answer ? `答：「${item.answer}」` : '', CW - 30, 2)
    };
  });
  const adviceItems = view.advice.slice(0, 3).map((item) => {
    ctx.font = `400 18px ${IMAGE_FONT}`;
    return { item, detail: wrapCanvasText(ctx, item.detail, CW - 30, 2) };
  });

  const headlineH = 34 + headlineLines.length * 38 + 24;
  const weekH = 184;
  const trendH = 300;
  const bandH = 132;
  const weakH = weak.length
    ? 44 + weak.reduce((sum, row) => sum + 32 + row.quote.length * 27 + 14, 0)
    : 0;
  const gapH = gaps.length
    ? 44 + gaps.reduce((sum, row) => sum + 30 + row.fix.length * 27 + row.quote.length * 27 + 16, 0)
    : 0;
  const stepH = steps.length
    ? 44 + steps.reduce((sum, row) => sum + 30 + row.action.length * 27 + 16, 0)
    : 0;
  const stuckH = stuckItems.length
    ? 44 + stuckItems.reduce((sum, row) => sum + row.question.length * 26 + row.answer.length * 25 + 16, 0)
    : 0;
  const adviceH = adviceItems.length
    ? 44 + adviceItems.reduce((sum, row) => sum + 28 + row.detail.length * 25 + 14, 0)
    : 0;

  const H = Math.max(
    1200,
    178 +
      headlineH +
      weekH +
      24 +
      trendH +
      24 +
      bandH +
      (weakH ? 24 + weakH : 0) +
      (gapH ? 24 + gapH : 0) +
      (stepH ? 24 + stepH : 0) +
      (stuckH ? 24 + stuckH : 0) +
      (adviceH ? 24 + adviceH : 0) +
      168
  );

  canvas.width = W;
  canvas.height = H;

  ctx.fillStyle = '#f6f2e9';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#1f6f5c';
  ctx.fillRect(0, 0, W, 150);
  ctx.fillStyle = 'rgba(255, 253, 248, 0.9)';
  ctx.font = `700 27px ${IMAGE_FONT}`;
  ctx.fillText('费曼小课堂', M, 66);
  ctx.fillStyle = 'rgba(255, 253, 248, 0.62)';
  ctx.font = `600 15px ${IMAGE_FONT}`;
  ctx.fillText('FEYNMAN CLASSROOM · TEACHER INSIGHT', M, 96);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255, 253, 248, 0.82)';
  ctx.font = `500 18px ${IMAGE_FONT}`;
  ctx.fillText(
    new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date()),
    W - M,
    74
  );
  ctx.textAlign = 'left';

  let y = 208;

  sectionTitle(ctx, '学情速览', M, y);
  y += 34;
  ctx.fillStyle = '#1f2a2a';
  ctx.font = `400 26px ${IMAGE_FONT}`;
  for (const line of headlineLines) {
    ctx.fillText(line, M, y);
    y += 38;
  }
  y += 24;

  const weekTop = y;
  ctx.fillStyle = '#fffdf8';
  roundRectPath(ctx, M, weekTop, CW, weekH, 22);
  ctx.fill();
  ctx.strokeStyle = '#ded6c6';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  sectionTitle(ctx, '近 7 天对比', M + 28, weekTop + 38);
  if (Number.isFinite(view.week.recent.average) && Number.isFinite(view.week.previous.average)) {
    const diff = Math.round(view.week.recent.average - view.week.previous.average);
    ctx.textAlign = 'right';
    ctx.fillStyle = diff >= 0 ? '#1f6f5c' : '#c15b3f';
    ctx.font = `700 19px ${IMAGE_FONT}`;
    ctx.fillText(`均分 ${deltaText(diff)}`, W - M - 28, weekTop + 38);
    ctx.textAlign = 'left';
  }
  const colWidth = (CW - 56 - 20) / 2;
  const drawWeekCell = (label, stats, index) => {
    const x = M + 28 + index * (colWidth + 20);
    ctx.fillStyle = '#5c6861';
    ctx.font = `600 17px ${IMAGE_FONT}`;
    ctx.fillText(label, x, weekTop + 78);
    ctx.fillStyle = '#1f2a2a';
    ctx.font = `700 38px ${IMAGE_FONT}`;
    ctx.fillText(`${stats?.sessions ?? 0} 课`, x, weekTop + 124);
    ctx.fillStyle = '#1f6f5c';
    ctx.font = `700 28px ${IMAGE_FONT}`;
    ctx.fillText(pct(stats?.average), x + 170, weekTop + 124);
    ctx.fillStyle = '#5c6861';
    ctx.font = `400 17px ${IMAGE_FONT}`;
    ctx.fillText(`卡点 ${stats?.stuck ?? 0} 个`, x, weekTop + 158);
  };
  drawWeekCell('本周', view.week.recent, 0);
  drawWeekCell('上周', view.week.previous, 1);
  y = weekTop + weekH + 24;

  const trendTop = y;
  ctx.fillStyle = '#fffdf8';
  roundRectPath(ctx, M, trendTop, CW, trendH, 22);
  ctx.fill();
  ctx.strokeStyle = '#ded6c6';
  ctx.stroke();
  sectionTitle(ctx, '表现趋势', M + 28, trendTop + 38);
  const trendRows = [
    { label: '最近 5 课', current: view.summary.recent, delta: view.summary.delta },
    ...METRICS.map((metric) => ({
      label: metric.label,
      current: view.metricTrends[metric.key]?.current,
      delta: view.metricTrends[metric.key]?.delta
    }))
  ];
  const barX = M + 190;
  const barWidth = CW - 190 - 150;
  trendRows.forEach((row, index) => {
    const rowY = trendTop + 70 + index * 54;
    ctx.fillStyle = '#45524f';
    ctx.font = `600 19px ${IMAGE_FONT}`;
    ctx.fillText(row.label, M + 28, rowY);
    ctx.fillStyle = '#efe9dc';
    roundRectPath(ctx, barX, rowY - 12, barWidth, 9, 4);
    ctx.fill();
    if (Number.isFinite(row.current)) {
      ctx.fillStyle = '#1f6f5c';
      roundRectPath(
        ctx,
        barX,
        rowY - 12,
        Math.max(9, (barWidth * Math.min(100, Math.max(0, row.current))) / 100),
        9,
        4
      );
      ctx.fill();
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = '#1f6f5c';
    ctx.font = `700 19px ${IMAGE_FONT}`;
    ctx.fillText(pct(row.current), W - M - 28, rowY);
    const delta = deltaText(row.delta);
    if (delta) {
      ctx.fillStyle = row.delta >= 0 ? '#1f6f5c' : '#c15b3f';
      ctx.font = `600 15px ${IMAGE_FONT}`;
      ctx.fillText(delta, W - M - 28, rowY + 22);
    }
    ctx.textAlign = 'left';
  });
  y = trendTop + trendH + 24;

  const bandTop = y;
  ctx.fillStyle = '#fffdf8';
  roundRectPath(ctx, M, bandTop, CW, bandH, 22);
  ctx.fill();
  ctx.strokeStyle = '#ded6c6';
  ctx.stroke();
  sectionTitle(ctx, '课时质量分布', M + 28, bandTop + 38);
  const bands = [
    ['需重讲', view.bands.retake, '#c15b3f'],
    ['待巩固', view.bands.reinforce, '#d9a441'],
    ['已掌握', view.bands.mastered, '#1f6f5c']
  ];
  const trackX = M + 28;
  const trackWidth = CW - 56;
  const trackY = bandTop + 60;
  ctx.fillStyle = '#efe9dc';
  roundRectPath(ctx, trackX, trackY, trackWidth, 14, 7);
  ctx.fill();
  let offset = 0;
  for (const [, count, color] of bands) {
    if (!count) continue;
    const width = (trackWidth * count) / Math.max(1, view.scored);
    ctx.fillStyle = color;
    roundRectPath(ctx, trackX + offset, trackY, width, 14, 7);
    ctx.fill();
    offset += width;
  }
  bands.forEach(([label, count, color], index) => {
    const x = M + 28 + index * 210;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + 5, bandTop + 104, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5c6861';
    ctx.font = `500 17px ${IMAGE_FONT}`;
    ctx.fillText(`${label} ${count} 课`, x + 18, bandTop + 110);
  });
  y = bandTop + bandH + 24;

  if (weak.length) {
    sectionTitle(ctx, '优先补的知识点', M, y);
    y += 34;
    weak.forEach((row, index) => {
      ctx.fillStyle = '#1f2a2a';
      ctx.font = `600 22px ${IMAGE_FONT}`;
      ctx.fillText(`${index + 1}. ${row.item.tag}`, M + 8, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#1f6f5c';
      ctx.font = `700 18px ${IMAGE_FONT}`;
      ctx.fillText(`${pct(row.item.average)} · ${row.item.sessions} 次`, W - M - 8, y);
      ctx.textAlign = 'left';
      y += 32;
      ctx.fillStyle = '#5c6861';
      ctx.font = `400 19px ${IMAGE_FONT}`;
      for (const line of row.quote) {
        ctx.fillText(line, M + 24, y);
        y += 27;
      }
      y += 14;
    });
    y += 24;
  }

  if (gaps.length) {
    sectionTitle(ctx, '需要关注的理解缺口', M, y);
    y += 34;
    gaps.forEach((row, index) => {
      ctx.fillStyle = '#1f2a2a';
      ctx.font = `600 21px ${IMAGE_FONT}`;
      ctx.fillText(`${index + 1}. ${row.item.title}`, M + 8, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#c15b3f';
      ctx.font = `700 17px ${IMAGE_FONT}`;
      ctx.fillText(`出现 ${row.item.count} 次`, W - M - 8, y);
      ctx.textAlign = 'left';
      y += 30;
      ctx.fillStyle = '#45524f';
      ctx.font = `400 19px ${IMAGE_FONT}`;
      for (const line of row.fix) {
        ctx.fillText(line, M + 24, y);
        y += 27;
      }
      ctx.fillStyle = '#8a6d32';
      for (const line of row.quote) {
        ctx.fillText(line, M + 24, y);
        y += 27;
      }
      y += 16;
    });
    y += 24;
  }

  if (steps.length) {
    sectionTitle(ctx, '下周教学动作', M, y);
    y += 34;
    steps.forEach((row, index) => {
      ctx.fillStyle = '#1f2a2a';
      ctx.font = `600 21px ${IMAGE_FONT}`;
      ctx.fillText(`${index + 1}. ${row.item.title}`, M + 8, y);
      y += 30;
      ctx.fillStyle = '#45524f';
      ctx.font = `400 19px ${IMAGE_FONT}`;
      for (const line of row.action) {
        ctx.fillText(line, M + 24, y);
        y += 27;
      }
      y += 16;
    });
  }

  if (stuckItems.length) {
    sectionTitle(ctx, '卡点题目复盘', M, y);
    y += 34;
    stuckItems.forEach((row) => {
      ctx.fillStyle = '#45524f';
      ctx.font = `600 19px ${IMAGE_FONT}`;
      for (const line of row.question) {
        ctx.fillText(line, M + 8, y);
        y += 26;
      }
      ctx.fillStyle = '#8a6d32';
      ctx.font = `400 18px ${IMAGE_FONT}`;
      for (const line of row.answer) {
        ctx.fillText(line, M + 24, y);
        y += 25;
      }
      y += 16;
    });
    y += 24;
  }

  if (adviceItems.length) {
    sectionTitle(ctx, '下一步教学建议', M, y);
    y += 34;
    adviceItems.forEach((row, index) => {
      ctx.fillStyle = '#1f6f5c';
      ctx.font = `700 19px ${IMAGE_FONT}`;
      ctx.fillText(`${index + 1}. ${row.item.title}`, M + 8, y);
      y += 28;
      ctx.fillStyle = '#45524f';
      ctx.font = `400 18px ${IMAGE_FONT}`;
      for (const line of row.detail) {
        ctx.fillText(line, M + 24, y);
        y += 25;
      }
      y += 14;
    });
  }

  ctx.fillStyle = '#ded6c6';
  ctx.fillRect(M, H - 118, CW, 1);
  ctx.fillStyle = '#5c6861';
  ctx.font = `600 17px ${IMAGE_FONT}`;
  ctx.fillText('费曼小课堂 · 输出，是最好的输入。', M, H - 86);
  ctx.textAlign = 'right';
  ctx.font = `400 15px ${IMAGE_FONT}`;
  ctx.fillText('数据来自本机档案，仅供教学参考', W - M, H - 86);
  ctx.textAlign = 'left';

  return new Promise((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('blob'))), 'image/png');
  });
}
