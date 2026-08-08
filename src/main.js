import { loadCanonicalData, summarizeMountains } from './data.js';
import { createMap } from './map.js';

const status = document.getElementById('status');
const stats = document.getElementById('stats');

function renderSummary(summary) {
  const categoryText = Object.entries(summary.categories).map(([key, value]) => `${key}: ${value}`).join(' · ');
  stats.textContent = `${summary.total} точек · main: ${summary.main} · 5000+: ${summary.five} · ${categoryText}`;
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
