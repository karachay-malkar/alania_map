import { CONFIG } from './config.js';
import { loadCanonicalData, summarizeMountains } from './data.js';
import { createMap } from './map.js';

const status = document.getElementById('status');
const stats = document.getElementById('stats');

function renderSummary(summary) {
  const categories = Object.entries(CONFIG.categories).map(([key, definition]) => {
    const count = summary.categories[key] || 0;
    return `<div class="category-item"><span class="category-dot" style="background:${definition.color}"></span><span class="category-label">${definition.label}</span><span class="category-count">${count}</span></div>`;
  }).join('');
  stats.innerHTML = `<div class="stats-summary">${summary.total} точек · главных: ${summary.main} · 5000+: ${summary.five}</div><div class="category-grid">${categories}</div>`;
}

(async () => {
  try {
    const data = await loadCanonicalData();
    const summary = summarizeMountains(data.mountains);
    createMap(data);
    renderSummary(summary);
    status.textContent = 'Геометрия загружена. Север внизу, юг вверху.';
  } catch (error) {
    console.error(error);
    status.textContent = `Ошибка: ${error.message || error}`;
    status.dataset.error = 'true';
  }
})();
