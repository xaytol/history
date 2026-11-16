'use strict';

const DATA_URL = 'data/variants.json?v=20261117-1';
const STORAGE_KEY = 'history-lab-colloquium-v1';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let variants = [];
let questions = [];
let activeVariant = 1;
let deck = [];
let deckPosition = 0;
let trainerQueue = [];
let trainerPosition = 0;
let showAllAnswers = false;
let libraryLimit = 30;
let toastTimer;

const state = loadState();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      known: Array.isArray(saved.known) ? saved.known : [],
      review: Array.isArray(saved.review) ? saved.review : [],
      favorites: Array.isArray(saved.favorites) ? saved.favorites : [],
      tasks: saved.tasks && typeof saved.tasks === 'object' ? saved.tasks : {},
      activeVariant: Number(saved.activeVariant) || 1
    };
  } catch {
    return { known: [], review: [], favorites: [], tasks: {}, activeVariant: 1 };
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      known: state.known,
      review: state.review,
      favorites: state.favorites,
      tasks: state.tasks,
      activeVariant
    }));
  } catch (error) {
    console.warn('Не удалось сохранить прогресс в браузере:', error);
  }
  updateStats();
}

function unique(items) {
  return [...new Set(items)];
}

function isKnown(id) {
  return state.known.includes(id);
}

function needsReview(id) {
  return state.review.includes(id);
}

function isFavorite(id) {
  return state.favorites.includes(id);
}

function currentVariant() {
  return variants.find(variant => variant.id === activeVariant);
}

function currentVariantQuestions() {
  return questions
    .filter(question => question.variantId === activeVariant)
    .sort((a, b) => a.number - b.number);
}

function toast(message) {
  const element = $('#toast');
  if (!element) return;
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 2200);
}

function updateStats() {
  const total = questions.length;
  const knownCount = questions.filter(question => isKnown(question.id)).length;
  const reviewCount = questions.filter(question => !isKnown(question.id) || needsReview(question.id)).length;
  const percentage = total ? Math.round((knownCount / total) * 100) : 0;
  const variantQuestions = currentVariantQuestions();
  const variantKnown = variantQuestions.filter(question => isKnown(question.id)).length;

  $('#stat-total').textContent = total;
  $('#hero-total').textContent = total;
  $('#stat-known').textContent = knownCount;
  $('#stat-review').textContent = reviewCount;
  $('#stat-percent').textContent = percentage + '%';
  $('#progress-fill').style.width = percentage + '%';

  const summary = $('#variant-summary');
  if (summary && currentVariant()) {
    summary.textContent = currentVariant().title + ': ' + variantKnown + ' из 30 отмечено «Знаю»';
  }
  const deckTotal = $('#deck-total');
  if (deckTotal) deckTotal.textContent = String(variantQuestions.length || 30);
}

function renderVariantPicker() {
  const container = $('#variant-picker');
  container.replaceChildren();

  variants.forEach(variant => {
    const variantQuestions = questions.filter(question => question.variantId === variant.id);
    const knownCount = variantQuestions.filter(question => isKnown(question.id)).length;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'variant-option' + (variant.id === activeVariant ? ' active' : '');
    button.dataset.variant = String(variant.id);
    button.setAttribute('aria-pressed', String(variant.id === activeVariant));

    const title = document.createElement('strong');
    title.textContent = 'Вариант ' + variant.id;
    const count = document.createElement('span');
    count.textContent = knownCount + '/30 выучено';
    button.append(title, count);
    button.addEventListener('click', () => selectVariant(variant.id));
    container.append(button);
  });

  const note = $('#variant-note');
  const selected = currentVariant();
  note.textContent = selected ? (selected.note || selected.source || '') : '';
  note.hidden = !note.textContent;
  updateStats();
}

function selectVariant(variantId) {
  if (!variants.some(variant => variant.id === variantId)) return;
  activeVariant = variantId;
  deck = currentVariantQuestions();
  deckPosition = 0;
  trainerQueue = currentVariantQuestions();
  trainerPosition = 0;
  libraryLimit = 30;
  renderVariantPicker();
  renderCard();
  renderTrainer();
  renderLibrary();
  saveState();
}

function buildDeck(shuffleDeck = false) {
  const ordered = currentVariantQuestions();
  deck = shuffleDeck ? shuffle(ordered) : ordered;
  deckPosition = 0;
  renderCard();
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }
  return result;
}

function currentCard() {
  return deck[deckPosition] || currentVariantQuestions()[0];
}

function renderCard() {
  const question = currentCard();
  if (!question) return;

  $('#deck-category').textContent = 'ВАРИАНТ ' + activeVariant;
  $('#card-number').textContent = String(deckPosition + 1).padStart(2, '0');
  $('#deck-total').textContent = String(deck.length);
  $('#card-question').textContent = question.question;
  $('#answer-text').textContent = question.answer;
  $('#card-answer').hidden = true;
  $('#card-label').textContent = 'ВОПРОС ' + String(question.number).padStart(2, '0');
  $('#card-hint').textContent = isKnown(question.id)
    ? 'Уже отмечено как выученное — проверь себя ещё раз'
    : needsReview(question.id)
      ? 'Эту карточку стоит повторить'
      : 'Попробуй ответить, не подглядывая';

  $('#flip-btn').innerHTML = 'Показать ответ <span aria-hidden="true">↘</span>';
  $('#reveal-btn').innerHTML = 'Открыть ответ <span>↓</span>';
  $('#bookmark-symbol').textContent = isFavorite(question.id) ? '★' : '☆';
  $('#bookmark-label').textContent = isFavorite(question.id) ? 'убрать из избранного' : 'сохранить карточку';
  $('#prev-btn').disabled = deck.length < 2 || deckPosition === 0;
  $('#next-btn').disabled = deck.length < 2 || deckPosition === deck.length - 1;
  $('#card-position-label').textContent = deckPosition + 1 === deck.length
    ? 'Последняя карточка варианта'
    : 'Карточка ' + (deckPosition + 1) + ' из ' + deck.length;
}

function flipCard() {
  const answer = $('#card-answer');
  const question = currentCard();
  if (!question) return;

  if (answer.hidden) {
    answer.hidden = false;
    $('#card-label').textContent = 'ВОПРОС ' + String(question.number).padStart(2, '0') + ' · ОТВЕТ';
    $('#card-hint').textContent = 'Оцени честно: вспомнил до открытия?';
    $('#flip-btn').textContent = 'Скрыть ответ';
    $('#reveal-btn').innerHTML = 'Скрыть ответ <span>↑</span>';
  } else {
    answer.hidden = true;
    $('#card-label').textContent = 'ВОПРОС ' + String(question.number).padStart(2, '0');
    $('#flip-btn').innerHTML = 'Показать ответ <span aria-hidden="true">↘</span>';
    $('#reveal-btn').innerHTML = 'Открыть ответ <span>↓</span>';
  }
}

function moveCard(delta) {
  const nextPosition = deckPosition + delta;
  if (nextPosition < 0 || nextPosition >= deck.length) return;
  deckPosition = nextPosition;
  renderCard();
}

function rateCard(markKnown) {
  const question = currentCard();
  if (!question) return;

  if (markKnown) {
    state.known = unique([...state.known, question.id]);
    state.review = state.review.filter(id => id !== question.id);
    toast('Отмечено: знаешь уверенно ✓');
  } else {
    state.known = state.known.filter(id => id !== question.id);
    state.review = unique([...state.review, question.id]);
    toast('Карточка добавлена в повторение ↻');
  }

  saveState();
  renderVariantPicker();
  renderCard();
  renderLibrary();
  if (deckPosition < deck.length - 1) moveCard(1);
  else toast('Вариант ' + activeVariant + ' пройден. Можно начать заново или выбрать другой.');
}

function toggleFavorite(id) {
  if (isFavorite(id)) {
    state.favorites = state.favorites.filter(item => item !== id);
    toast('Убрано из избранного');
  } else {
    state.favorites = unique([...state.favorites, id]);
    toast('Сохранено в избранное ☆');
  }
  saveState();
  renderVariantPicker();
  renderCard();
  renderLibrary();
}

function buildTrainer() {
  trainerQueue = currentVariantQuestions();
  trainerPosition = 0;
  renderTrainer();
}

function trainerCurrent() {
  return trainerQueue[trainerPosition];
}

function renderTrainer() {
  const question = trainerCurrent();
  if (!question) return;

  $('#trainer-index').textContent = 'ВОПРОС ' + question.number + ' / 30';
  $('#trainer-category').textContent = 'ВАРИАНТ ' + activeVariant;
  $('#trainer-question').textContent = question.question;
  $('#my-answer').value = '';
  $('#trainer-answer-text').textContent = question.answer;
  $('#trainer-answer').hidden = true;
  $('#trainer-reveal').disabled = false;
  $('#trainer-reveal').textContent = 'Сверить с ответом';
  $('#trainer-no').disabled = false;
  $('#trainer-yes').disabled = false;
  $('#trainer-skip').disabled = false;
}

function advanceTrainer() {
  if (trainerPosition < trainerQueue.length - 1) {
    trainerPosition += 1;
    renderTrainer();
    return;
  }
  toast('Вариант ' + activeVariant + ': все 30 вопросов пройдены');
  trainerPosition = 0;
  renderTrainer();
}

function gradeTrainer(wasKnown) {
  const question = trainerCurrent();
  if (!question) return;

  if (wasKnown) {
    state.known = unique([...state.known, question.id]);
    state.review = state.review.filter(id => id !== question.id);
    toast('Отлично. Ответ воспроизведён ✓');
  } else {
    state.known = state.known.filter(id => id !== question.id);
    state.review = unique([...state.review, question.id]);
    toast('Оставили в списке повторения ↻');
  }

  saveState();
  renderVariantPicker();
  renderLibrary();
  advanceTrainer();
}

function filteredQuestions() {
  const search = $('#search-input').value.trim().toLocaleLowerCase('ru');
  const status = $('#status-filter').value;

  return currentVariantQuestions().filter(question => {
    const searchable = (question.question + ' ' + question.answer).toLocaleLowerCase('ru');
    if (search && !searchable.includes(search)) return false;
    if (status === 'new' && (isKnown(question.id) || needsReview(question.id))) return false;
    if (status === 'known' && !isKnown(question.id)) return false;
    if (status === 'review' && !needsReview(question.id)) return false;
    if (status === 'favorites' && !isFavorite(question.id)) return false;
    return true;
  });
}

function renderLibrary() {
  if (!questions.length) return;

  const filtered = filteredQuestions();
  const shown = filtered.slice(0, libraryLimit);
  const list = $('#question-list');
  list.replaceChildren();

  shown.forEach(question => {
    const details = document.createElement('details');
    details.className = 'question-item' +
      (isKnown(question.id) ? ' status-known' : '') +
      (needsReview(question.id) ? ' status-review' : '');

    const summary = document.createElement('summary');
    const dot = document.createElement('span');
    dot.className = 'item-dot';
    dot.textContent = isKnown(question.id) ? '✓' : needsReview(question.id) ? '↻' : String(question.number).padStart(2, '0');

    const content = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'item-question';
    title.textContent = question.question;

    const meta = document.createElement('div');
    meta.className = 'item-meta';
    const label = document.createElement('span');
    label.className = 'item-category';
    label.textContent = 'Вариант ' + activeVariant + ' · вопрос ' + question.number;
    meta.append(label);

    if (isKnown(question.id) || needsReview(question.id)) {
      const statusTag = document.createElement('span');
      statusTag.className = 'status-tag';
      statusTag.textContent = isKnown(question.id) ? 'ЗНАЮ' : 'ПОВТОРИТЬ';
      meta.append(statusTag);
    }

    content.append(title, meta);
    summary.append(dot, content);

    const answer = document.createElement('div');
    answer.className = 'item-answer';
    const answerText = document.createElement('div');
    answerText.textContent = question.answer;

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const knownButton = document.createElement('button');
    knownButton.type = 'button';
    knownButton.className = 'mini-action';
    knownButton.textContent = isKnown(question.id) ? 'Убрать отметку «Знаю»' : 'Отметить «Знаю»';
    knownButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (isKnown(question.id)) {
        state.known = state.known.filter(id => id !== question.id);
        state.review = unique([...state.review, question.id]);
      } else {
        state.known = unique([...state.known, question.id]);
        state.review = state.review.filter(id => id !== question.id);
      }
      saveState();
      renderVariantPicker();
      renderLibrary();
    });

    const favoriteButton = document.createElement('button');
    favoriteButton.type = 'button';
    favoriteButton.className = 'mini-action';
    favoriteButton.textContent = isFavorite(question.id) ? '★ В избранном' : '☆ В избранное';
    favoriteButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      toggleFavorite(question.id);
    });

    actions.append(knownButton, favoriteButton);
    answer.append(answerText, actions);
    if (!showAllAnswers) answer.hidden = true;
    details.append(summary, answer);

    if (showAllAnswers) details.open = true;
    details.addEventListener('toggle', () => {
      if (!showAllAnswers) answer.hidden = !details.open;
    });

    list.append(details);
  });

  $('#library-count').textContent = filtered.length + ' из 30 вопросов';
  $('#load-more').hidden = shown.length >= filtered.length;
  $('#load-more').textContent = 'Показать ещё (' + Math.min(30, filtered.length - shown.length) + ')';
  $('#toggle-all-answers').textContent = showAllAnswers ? 'Скрыть ответы' : 'Показать все ответы';
}

function setView(view) {
  $$('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === view));
  $$('.view').forEach(section => section.classList.toggle('active', section.id === 'view-' + view));
  if (view === 'trainer') renderTrainer();
  if (view === 'library') renderLibrary();
  const tabsTop = $('.tabs').getBoundingClientRect().top + window.scrollY - 10;
  window.scrollTo({ top: tabsTop, behavior: 'smooth' });
}

function wireEvents() {
  $$('.tab').forEach(tab => tab.addEventListener('click', () => setView(tab.dataset.view)));
  $$('[data-go]').forEach(button => button.addEventListener('click', () => setView(button.dataset.go)));

  const flashcard = $('#flashcard');
  flashcard.addEventListener('click', event => {
    if (event.target.closest('button, a, input, textarea, select, label')) return;
    flipCard();
  });
  flashcard.addEventListener('keydown', event => {
    if (event.target !== flashcard) return;
    if (event.key === 'Enter' || event.code === 'Space') {
      event.preventDefault();
      event.stopPropagation();
      flipCard();
    }
  });

  $('#shuffle-btn').addEventListener('click', () => {
    buildDeck(true);
    toast('Вариант ' + activeVariant + ' перемешан');
  });
  $('#ordered-btn').addEventListener('click', () => {
    buildDeck(false);
    toast('Вопросы снова идут по порядку');
  });
  $('#prev-btn').addEventListener('click', () => moveCard(-1));
  $('#next-btn').addEventListener('click', () => moveCard(1));
  $('#flip-btn').addEventListener('click', flipCard);
  $('#reveal-btn').addEventListener('click', flipCard);
  $('#again-btn').addEventListener('click', () => rateCard(false));
  $('#known-btn').addEventListener('click', () => rateCard(true));
  $('#bookmark-btn').addEventListener('click', () => {
    const question = currentCard();
    if (question) toggleFavorite(question.id);
  });

  $('#trainer-reveal').addEventListener('click', () => {
    $('#trainer-answer').hidden = false;
    $('#trainer-reveal').disabled = true;
  });
  $('#trainer-no').addEventListener('click', () => gradeTrainer(false));
  $('#trainer-yes').addEventListener('click', () => gradeTrainer(true));
  $('#trainer-skip').addEventListener('click', advanceTrainer);

  $('#search-input').addEventListener('input', () => {
    libraryLimit = 30;
    renderLibrary();
  });
  $('#status-filter').addEventListener('change', () => {
    libraryLimit = 30;
    renderLibrary();
  });
  $('#load-more').addEventListener('click', () => {
    libraryLimit += 30;
    renderLibrary();
  });
  $('#toggle-all-answers').addEventListener('click', () => {
    showAllAnswers = !showAllAnswers;
    renderLibrary();
  });

  $$('[data-task]').forEach(checkbox => {
    checkbox.checked = Boolean(state.tasks[checkbox.dataset.task]);
    checkbox.addEventListener('change', () => {
      state.tasks[checkbox.dataset.task] = checkbox.checked;
      saveState();
    });
  });

  $('#reset-progress').addEventListener('click', () => {
    if (!confirm('Сбросить отметки «Знаю», повторение, избранное и галочки плана на этом устройстве?')) return;
    state.known = [];
    state.review = [];
    state.favorites = [];
    state.tasks = {};
    $$('[data-task]').forEach(checkbox => { checkbox.checked = false; });
    saveState();
    renderVariantPicker();
    renderCard();
    renderTrainer();
    renderLibrary();
    toast('Прогресс сброшен');
  });

  document.addEventListener('keydown', event => {
    if (event.target.matches('input, textarea, select, button, a')) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (!$('#view-cards').classList.contains('active')) return;

    if (event.code === 'Space') {
      event.preventDefault();
      flipCard();
    } else if (event.key === 'ArrowLeft') {
      moveCard(-1);
    } else if (event.key === 'ArrowRight') {
      moveCard(1);
    }
  });
}

async function init() {
  try {
    const response = await fetch(DATA_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error('Не удалось загрузить ' + DATA_URL + ': ' + response.status);

    const payload = await response.json();
    variants = payload.variants || [];
    questions = variants.flatMap(variant =>
      variant.questions.map(([question, answer], index) => ({
        id: 'v' + variant.id + '-q' + String(index + 1).padStart(2, '0'),
        variantId: variant.id,
        number: index + 1,
        question,
        answer
      }))
    );

    if (variants.length !== 4 || variants.some(variant => variant.questions.length !== 30) || questions.length !== 120) {
      throw new Error('Набор должен содержать ровно 4 варианта по 30 вопросов.');
    }

    if (!variants.some(variant => variant.id === state.activeVariant)) activeVariant = 1;
    else activeVariant = state.activeVariant;

    deck = currentVariantQuestions();
    trainerQueue = currentVariantQuestions();
    renderVariantPicker();
    buildDeck(false);
    buildTrainer();
    updateStats();
    renderLibrary();
    wireEvents();
  } catch (error) {
    console.error(error);
    $('#card-question').textContent = 'Не удалось загрузить вопросы. Обнови страницу; локальный прогресс не сброшен.';
    $('#trainer-question').textContent = 'Набор вопросов не загрузился.';
    $('#question-list').textContent = 'Не удалось загрузить вопросы. Проверь подключение и обнови страницу.';
    $('#stat-total').textContent = '—';
    $('#stat-review').textContent = '—';
    $('#deck-category').textContent = 'ОШИБКА ЗАГРУЗКИ';
  }
}

init();
