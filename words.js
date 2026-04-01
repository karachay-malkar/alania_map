// Можно вставлять ЛЮБУЮ ссылку на Google Sheets (даже /edit) — приложение само превратит её в CSV.
window.WORDS_SHEET_URL = "https://docs.google.com/spreadsheets/d/1X2tc9THUxj0bZOQDdycEFGl7xJMqjUBYe7MsESWIUXI/edit?usp=sharing";

// Версия кеша: измени число чтобы принудительно обновить данные из таблицы.
// Например: v13 → v14 — у всех пользователей данные загрузятся заново.
window.WORDS_CACHE_KEY = "fc_words_cache_v25";

// (Необязательно) Человеческие названия папок.
window.FOLDER_TITLES = {
  "easy": "Простой",
  "mid": "Средний",
  "hard": "Сложный",
};

// Тестовые данные (если таблица недоступна)
window.WORDS_FALLBACK = [
  { id: "B001", folder: "easy", set: 1, word: "окъургъа", trans: "читать", example: "китабны окъургъа - читать книгу", synonyms: "читать" },
  { id: "B002", folder: "easy", set: 1, word: "сау бол", trans: "спасибо", example: "Сау бол - спасибо", synonyms: "спасибо" },
  { id: "B003", folder: "easy", set: 1, word: "барыргъа", trans: "идти, ехать", example: "мен юйге барама - я иду домой", synonyms: "идти, ехать" },
];



// === STEP 4: Dictionary content data requirements ===
// Required column in Google Sheets: dict_order
// - Local order inside EACH dictionary (starts from 1)
// - Used for sorting and display in "Содержание словаря"
// - If dict_order is empty or 0, the word is NOT shown in the dictionary content view.
//
// Expected headers (minimum):
// id, dict, section, set, word, trans, dict_order
// Optional: synonyms, used_in_test
//
// Example row:
// { id: 'B101', dict: 'Основной', section: 'Быт', set: 1, dict_order: 12, word: 'окъургъа', trans: 'читать', synonyms: 'читать' }
