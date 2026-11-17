'use strict';

const DATA_URL = 'data/variants.json?v=20261117-answers-checked';
const STORAGE_KEY = 'history-lab-colloquium-v1';
const THEME_KEY = 'history-lab-theme-v1';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let variants = [];
let questions = [];
let activeVariant = 1;
let deckMode = 'shuffle';
let deck = [];
let deckPosition = 0;
let randomTest = false;
let trainerQueue = [];
let trainerPosition = 0;
let showAllAnswers = false;
let libraryLimit = 30;
let toastTimer;

const state = loadState();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const known = Array.isArray(saved.known) ? saved.known : [];
    const review = Array.isArray(saved.review) ? saved.review : [];
    return {
      known,
      review,
      attempted: Array.isArray(saved.attempted) ? saved.attempted : unique([...known, ...review]),
      favorites: Array.isArray(saved.favorites) ? saved.favorites : [],
      activeVariant: saved.activeVariant === 'all' ? 'all' : (Number(saved.activeVariant) || 1),
      deckMode: saved.deckMode === 'ordered' ? 'ordered' : 'shuffle',
      edits: saved.edits && typeof saved.edits === 'object' ? saved.edits : {}
    };
  } catch {
    return { known: [], review: [], attempted: [], favorites: [], activeVariant: 1, deckMode: 'shuffle', edits: {} };
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      known: state.known,
      review: state.review,
      favorites: state.favorites,
      attempted: state.attempted,
      activeVariant,
      deckMode,
      edits: state.edits
    }));
  } catch (error) {
    console.warn('Не удалось сохранить прогресс:', error);
  }
  updateStats();
}

function applyTheme(theme) {
  const selected = theme === 'dark' ? 'dark' : 'light';
  document.body.dataset.theme = selected;
  const button = $('#theme-toggle');
  button.textContent = selected === 'dark' ? '☀' : '☾';
  button.setAttribute('aria-label', selected === 'dark' ? 'Светлая тема' : 'Тёмная тема');
  button.setAttribute('title', selected === 'dark' ? 'Светлая тема' : 'Тёмная тема');
  $('meta[name="theme-color"]').setAttribute('content', selected === 'dark' ? '#171e24' : '#f3f5f2');
}

function initTheme() {
  let theme = 'light';
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark' || stored === 'light') theme = stored;
  } catch (error) {
    console.warn('Не удалось прочитать тему:', error);
  }
  applyTheme(theme);
  $('#theme-toggle').addEventListener('click', () => {
    const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (error) {
      console.warn('Не удалось сохранить тему:', error);
    }
  });
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

function isAttempted(id) {
  return state.attempted.includes(id);
}

function currentVariantQuestions() {
  const selected = activeVariant === 'all'
    ? questions
    : questions.filter(question => question.variantId === activeVariant);
  return [...selected].sort((a, b) => a.variantId - b.variantId || a.number - b.number);
}

function variantLabel() {
  if (randomTest) return 'СЛУЧАЙНЫЙ ТЕСТ';
  return activeVariant === 'all' ? 'ВСЕ ВАРИАНТЫ' : 'ВАРИАНТ ' + activeVariant;
}

function applyLocalEdits() {
  questions.forEach(question => {
    const edit = state.edits[question.id];
    if (edit) {
      if (typeof edit.question === 'string') question.question = edit.question;
      if (typeof edit.answer === 'string') question.answer = edit.answer;
    }
  });
}

function questionLabel(question) {
  return 'ВАРИАНТ ' + question.variantId + ' · №' + question.number;
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }
  return result;
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 1800);
}

function updateStats() {
  const total = questions.length;
  const knownCount = questions.filter(question => isKnown(question.id)).length;
  const attemptedCount = questions.filter(question => isAttempted(question.id)).length;
  const percentage = total ? Math.round((attemptedCount / total) * 100) : 0;
  const selected = randomTest ? deck : currentVariantQuestions();
  const variantKnown = selected.filter(question => isKnown(question.id)).length;
  const variantAttempted = selected.filter(question => isAttempted(question.id)).length;

  $('#stat-known').textContent = String(knownCount);
  $('#stat-attempted').textContent = String(attemptedCount);
  $('#stat-total').textContent = String(total);
  $('#stat-percent').textContent = percentage + '%';
  $('#progress-fill').style.width = percentage + '%';

  $('#variant-summary').textContent = randomTest ? 'Случайный тест · 30 вопросов' :
    'Прорешано ' + variantAttempted + '/' + selected.length + ' · выучено ' + variantKnown;
}

function renderVariantPicker() {
  const container = $('#variant-picker');
  container.replaceChildren();

  const options = [
    ...variants.map(variant => ({
      id: variant.id,
      label: 'Вариант ' + variant.id,
      count: questions.filter(question => question.variantId === variant.id).length
    })),
    { id: 'all', label: 'Все варианты вместе', count: questions.length }
  ];

  options.forEach(option => {
    const optionQuestions = option.id === 'all'
      ? questions
      : questions.filter(question => question.variantId === option.id);
    const knownCount = optionQuestions.filter(question => isKnown(question.id)).length;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'variant-option' + (option.id === 'all' ? ' all-option' : '') + (option.id === activeVariant ? ' active' : '');
    button.dataset.variant = String(option.id);
    button.setAttribute('aria-pressed', String(option.id === activeVariant));

    const title = document.createElement('strong');
    title.textContent = option.label;
    const count = document.createElement('span');
    count.textContent = knownCount + ' / ' + option.count;
    count.title = 'Правильно отмечено карточек';
    button.append(title, count);
    button.addEventListener('click', () => selectVariant(option.id));
    container.append(button);
  });
  updateStats();
}

function selectVariant(variantId) {
  if (variantId !== 'all' && !variants.some(variant => variant.id === Number(variantId))) return;
  activeVariant = variantId === 'all' ? 'all' : Number(variantId);
  randomTest = false;
  deck = makeDeck();
  deckPosition = 0;
  trainerQueue = makeDeck();
  trainerPosition = 0;
  libraryLimit = activeVariant === 'all' ? 120 : 30;
  renderVariantPicker();
  renderDeckModes();
  showDeckSession();
  renderCard();
  renderTrainer();
  renderLibrary();
  renderProbability(true);
  saveState();
}

function arrangeDeck(items) {
  const ordered = [...items].sort((a, b) => a.variantId - b.variantId || a.number - b.number);
  return deckMode === 'ordered' ? ordered : shuffle(ordered);
}

function makeDeck() {
  return arrangeDeck(currentVariantQuestions());
}

function startRandomTest() {
  randomTest = true;
  deck = shuffle(questions).slice(0, 30);
  deckPosition = 0;
  trainerQueue = [...deck];
  trainerPosition = 0;
  showDeckSession();
  renderCard();
  updateStats();
  toast('Сформирован случайный тест из 30 вопросов');
}

function renderDeckModes() {
  const shuffled = $('#shuffle-btn');
  const ordered = $('#ordered-btn');
  shuffled.classList.toggle('active', deckMode === 'shuffle');
  ordered.classList.toggle('active', deckMode === 'ordered');
  shuffled.setAttribute('aria-pressed', String(deckMode === 'shuffle'));
  ordered.setAttribute('aria-pressed', String(deckMode === 'ordered'));
}

function setDeckMode(mode) {
  if (mode !== 'shuffle' && mode !== 'ordered') return;
  deckMode = mode;
  randomTest = false;
  deck = makeDeck();
  deckPosition = 0;
  trainerQueue = makeDeck();
  trainerPosition = 0;
  showDeckSession();
  renderDeckModes();
  renderCard();
  renderTrainer();
  saveState();
}

function buildDeck() {
  deck = makeDeck();
  deckPosition = 0;
  renderCard();
}

function currentCard() {
  return deck[deckPosition];
}

function renderCard() {
  const question = currentCard();
  if (!question) return;

  $('#deck-category').textContent = randomTest ? 'СЛУЧАЙНЫЙ ТЕСТ' : variantLabel();
  $('#card-number').textContent = String(deckPosition + 1).padStart(2, '0');
  $('#deck-total').textContent = String(deck.length);
  $('#card-question').textContent = question.question;
  $('#answer-text').textContent = question.answer;
  $('#card-answer').hidden = true;
  $('#card-label').textContent = questionLabel(question);
  $('#flip-btn').textContent = 'Показать ответ';
  $('#bookmark-symbol').textContent = isFavorite(question.id) ? '★' : '☆';
  $('#bookmark-label').textContent = isFavorite(question.id) ? 'В избранном' : 'В избранное';
  $('#prev-btn').disabled = deck.length < 2 || deckPosition === 0;
  $('#next-btn').disabled = deck.length === 0;
  const isLastCard = deckPosition === deck.length - 1;
  $('#next-btn').textContent = isLastCard ? '✓' : '→';
  $('#next-btn').setAttribute('title', isLastCard ? 'Завершить колоду' : 'Следующая карточка');
  $('#next-btn').setAttribute('aria-label', isLastCard ? 'Завершить колоду' : 'Следующая карточка');
  $('#flashcard').setAttribute('aria-label', question.question + '. Нажми, чтобы открыть ответ.');
}

function flipCard() {
  const answer = $('#card-answer');
  if (answer.hidden) {
    answer.hidden = false;
    $('#card-label').textContent = 'ОТВЕТ';
    $('#flip-btn').textContent = 'Скрыть ответ';
  } else {
    answer.hidden = true;
    $('#card-label').textContent = questionLabel(currentCard());
    $('#flip-btn').textContent = 'Показать ответ';
  }
}

function moveCard(delta) {
  const nextPosition = deckPosition + delta;
  if (nextPosition < 0) return;
  if (nextPosition >= deck.length) {
    showDeckCompletion();
    return;
  }
  deckPosition = nextPosition;
  renderCard();
}

function showDeckSession() {
  $('#deck-session').hidden = false;
  $('#deck-complete').hidden = true;
}

function showDeckCompletion() {
  const selected = randomTest ? deck : currentVariantQuestions();
  const knownCount = selected.filter(question => isKnown(question.id)).length;
  const attemptedCount = selected.filter(question => isAttempted(question.id)).length;
  const reviewCount = selected.filter(question => needsReview(question.id)).length;
  const unlearnedCount = selected.filter(question => !isKnown(question.id)).length;
  const untouchedCount = selected.filter(question => !isAttempted(question.id)).length;

  $('#complete-title').textContent = (randomTest ? 'Случайный тест' : (activeVariant === 'all' ? 'Все варианты' : 'Вариант ' + activeVariant)) + ' пройден.';
  $('#complete-attempted').textContent = attemptedCount + ' / ' + selected.length;
  $('#complete-known').textContent = String(knownCount);
  $('#complete-review').textContent = String(reviewCount);
  $('#complete-untouched').textContent = String(untouchedCount);
  $('#restart-unlearned-count').textContent = String(unlearnedCount);
  $('#restart-unlearned').disabled = unlearnedCount === 0;

  $('#deck-session').hidden = true;
  $('#deck-complete').hidden = false;
}

function restartWholeDeck() {
  deck = randomTest ? shuffle(deck) : makeDeck();
  deckPosition = 0;
  showDeckSession();
  renderCard();
}

function restartUnlearnedDeck() {
  const unlearned = (randomTest ? deck : currentVariantQuestions()).filter(question => !isKnown(question.id));
  if (!unlearned.length) {
    toast('Все карточки этого набора выучены');
    return;
  }
  deck = arrangeDeck(unlearned);
  deckPosition = 0;
  showDeckSession();
  renderCard();
}

function rateCard(markKnown) {
  const question = currentCard();
  if (!question) return;

  state.attempted = unique([...state.attempted, question.id]);
  if (markKnown) {
    state.known = unique([...state.known, question.id]);
    state.review = state.review.filter(id => id !== question.id);
    toast('Отмечено как выученное');
  } else {
    state.known = state.known.filter(id => id !== question.id);
    state.review = unique([...state.review, question.id]);
    toast('Добавлено на повторение');
  }

  saveState();
  renderVariantPicker();
  renderLibrary();
  if (deckPosition < deck.length - 1) moveCard(1);
  else showDeckCompletion();
}

function toggleFavorite(id) {
  if (isFavorite(id)) {
    state.favorites = state.favorites.filter(item => item !== id);
    toast('Убрано из избранного');
  } else {
    state.favorites = unique([...state.favorites, id]);
    toast('Добавлено в избранное');
  }
  saveState();
  renderVariantPicker();
  renderCard();
  renderLibrary();
}

function buildTrainer() {
  trainerQueue = makeDeck();
  trainerPosition = 0;
  renderTrainer();
}

function trainerCurrent() {
  return trainerQueue[trainerPosition];
}

function renderTrainer() {
  const question = trainerCurrent();
  if (!question) return;

  $('#trainer-index').textContent = (trainerPosition + 1) + ' / ' + trainerQueue.length;
  $('#trainer-category').textContent = questionLabel(question);
  $('#trainer-question').textContent = question.question;
  $('#my-answer').value = '';
  $('#trainer-answer-text').textContent = question.answer;
  $('#trainer-answer').hidden = true;
  $('#trainer-reveal').disabled = false;
}

function advanceTrainer() {
  if (trainerPosition < trainerQueue.length - 1) {
    trainerPosition += 1;
    renderTrainer();
    return;
  }
  toast('Все вопросы выбранной колоды пройдены');
  buildTrainer();
}

function gradeTrainer(wasKnown) {
  const question = trainerCurrent();
  if (!question) return;

  state.attempted = unique([...state.attempted, question.id]);
  if (wasKnown) {
    state.known = unique([...state.known, question.id]);
    state.review = state.review.filter(id => id !== question.id);
  } else {
    state.known = state.known.filter(id => id !== question.id);
    state.review = unique([...state.review, question.id]);
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
    const number = document.createElement('span');
    number.className = 'item-dot';
    number.textContent = activeVariant === 'all'
      ? question.variantId + '.' + question.number
      : String(question.number);

    const title = document.createElement('div');
    title.className = 'item-question';
    title.textContent = question.question;

    const meta = document.createElement('div');
    meta.className = 'item-meta';
    if (isKnown(question.id) || needsReview(question.id)) {
      const statusTag = document.createElement('span');
      statusTag.className = 'status-tag';
      statusTag.textContent = isKnown(question.id) ? 'ЗНАЮ' : 'ПОВТОРИТЬ';
      meta.append(statusTag);
    }
    const summaryText = document.createElement('div');
    summaryText.append(title, meta);
    summary.append(number, summaryText);

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
      state.attempted = unique([...state.attempted, question.id]);
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
    favoriteButton.textContent = isFavorite(question.id) ? '★ Избранное' : '☆ В избранное';
    favoriteButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      toggleFavorite(question.id);
    });

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'mini-action';
    editButton.textContent = 'Изменить вопрос / ответ';
    editButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const nextQuestion = window.prompt('Изменить формулировку вопроса:', question.question);
      if (nextQuestion === null) return;
      const nextAnswer = window.prompt('Изменить ответ:', question.answer);
      if (nextAnswer === null) return;
      question.question = nextQuestion.trim() || question.question;
      question.answer = nextAnswer.trim() || question.answer;
      state.edits[question.id] = { question: question.question, answer: question.answer };
      saveState();
      renderLibrary();
      renderCard();
      renderTrainer();
      renderProbability(false);
      toast('Изменения сохранены на этом устройстве');
    });

    actions.append(knownButton, favoriteButton, editButton);
    answer.append(answerText, actions);
    if (!showAllAnswers) answer.hidden = true;
    details.append(summary, answer);
    if (showAllAnswers) details.open = true;
    details.addEventListener('toggle', () => {
      if (!showAllAnswers) answer.hidden = !details.open;
    });
    list.append(details);
  });

  const total = activeVariant === 'all' ? questions.length : currentVariantQuestions().length;
  $('#library-count').textContent = filtered.length + ' из ' + total + ' вопросов';
  $('#load-more').hidden = shown.length >= filtered.length;
  $('#load-more').textContent = 'Показать ещё (' + Math.min(30, filtered.length - shown.length) + ')';
  $('#toggle-all-answers').textContent = showAllAnswers ? 'Скрыть ответы' : 'Показать все ответы';
}

function combination(n, r) {
  if (r < 0 || r > n) return 0;
  const k = Math.min(r, n - r);
  let result = 1;
  for (let index = 1; index <= k; index += 1) {
    result = result * (n - k + index) / index;
  }
  return result;
}

function gradeForErrors(errors) {
  if (errors <= 5) return '5';
  if (errors <= 10) return '4';
  if (errors <= 15) return '3';
  return 'below';
}

function probabilityForLearnedCount(learnedCount) {
  const population = questions.length;
  const learned = Math.max(0, Math.min(population, learnedCount));
  const unknown = population - learned;
  const totalByGrade = { '5': 0, '4': 0, '3': 0, below: 0 };
  const denominatorCache = new Map();

  variants.forEach(variant => {
    const sampleSize = questions.filter(question => question.variantId === variant.id).length;
    const denominator = denominatorCache.get(sampleSize) || combination(population, sampleSize);
    denominatorCache.set(sampleSize, denominator);

    for (let errors = 0; errors <= sampleSize; errors += 1) {
      const ways = combination(unknown, errors) * combination(learned, sampleSize - errors);
      if (!ways) continue;
      totalByGrade[gradeForErrors(errors)] += (ways / denominator) / variants.length;
    }
  });

  return totalByGrade;
}

function percentText(value) {
  const rounded = Math.round(value * 10) / 10;
  return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', ',')) + '%';
}

function makeCell(text, tag = 'td') {
  const cell = document.createElement(tag);
  cell.textContent = String(text);
  return cell;
}

function renderProbability(setSliderToProgress = false) {
  if (!questions.length) return;
  const slider = $('#probability-slider');
  const currentKnown = questions.filter(question => isKnown(question.id)).length;
  slider.max = String(questions.length);
  if (setSliderToProgress) slider.value = String(currentKnown);

  const learned = Math.max(0, Math.min(questions.length, Number(slider.value) || 0));
  slider.value = String(learned);
  $('#probability-known-value').textContent = learned + ' / ' + questions.length;

  const distribution = probabilityForLearnedCount(learned);
  const gradeItems = [
    { key: '5', value: distribution['5'], valueId: 'prob-value-5', barId: 'prob-bar-5' },
    { key: '4', value: distribution['4'], valueId: 'prob-value-4', barId: 'prob-bar-4' },
    { key: '3', value: distribution['3'], valueId: 'prob-value-3', barId: 'prob-bar-3' },
    { key: 'below', value: distribution.below, valueId: 'prob-value-below', barId: 'prob-bar-below' }
  ];
  gradeItems.forEach(item => {
    $( '#' + item.valueId).textContent = percentText(item.value * 100);
    $( '#' + item.barId).style.width = (item.value * 100) + '%';
    $( '#' + item.barId).setAttribute('aria-valuenow', String(Math.round(item.value * 1000) / 10));
  });

  const actualGrades = { '5': 0, '4': 0, '3': 0, below: 0 };
  const body = $('#variant-forecast');
  body.replaceChildren();
  variants.forEach(variant => {
    const group = questions.filter(question => question.variantId === variant.id);
    const knownCount = group.filter(question => isKnown(question.id)).length;
    const errors = group.length - knownCount;
    const grade = gradeForErrors(errors);
    actualGrades[grade] += 1;

    const row = document.createElement('tr');
    row.append(
      makeCell('Вариант ' + variant.id),
      makeCell(knownCount + ' / ' + group.length),
      makeCell(errors),
      makeCell(grade === 'below' ? 'Ниже 3' : grade)
    );
    body.append(row);
  });

  [
    ['5', 'actual-value-5'],
    ['4', 'actual-value-4'],
    ['3', 'actual-value-3'],
    ['below', 'actual-value-below']
  ].forEach(([grade, id]) => {
    $('#' + id).textContent = percentText(actualGrades[grade] / variants.length * 100);
  });

  const milestoneBody = $('#probability-milestones');
  milestoneBody.replaceChildren();
  const milestones = [...new Set([0, 15, 30, 45, 60, 75, 85, 95, 100, 105, 110, 115, questions.length])];
  milestones.forEach(count => {
    const result = probabilityForLearnedCount(count);
    const row = document.createElement('tr');
    row.append(
      makeCell(count),
      makeCell(percentText(result['5'] * 100)),
      makeCell(percentText(result['4'] * 100)),
      makeCell(percentText(result['3'] * 100)),
      makeCell(percentText(result.below * 100))
    );
    milestoneBody.append(row);
  });
}

function setView(view) {
  $$('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === view));
  $$('.view').forEach(section => section.classList.toggle('active', section.id === 'view-' + view));
  if (view === 'trainer') renderTrainer();
  if (view === 'library') renderLibrary();
  if (view === 'probability') renderProbability(true);
}

function wireEvents() {
  $$('.tab').forEach(tab => tab.addEventListener('click', () => setView(tab.dataset.view)));

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

  $('#random-test-btn').addEventListener('click', startRandomTest);
  $('#shuffle-btn').addEventListener('click', () => {
    setDeckMode('shuffle');
    toast('Случайный порядок');
  });
  $('#ordered-btn').addEventListener('click', () => {
    setDeckMode('ordered');
    toast('Исходный порядок вопросов');
  });
  $('#prev-btn').addEventListener('click', () => moveCard(-1));
  $('#next-btn').addEventListener('click', () => moveCard(1));
  $('#restart-all').addEventListener('click', restartWholeDeck);
  $('#restart-unlearned').addEventListener('click', restartUnlearnedDeck);
  $('#flip-btn').addEventListener('click', flipCard);
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

  $('#probability-slider').addEventListener('input', () => renderProbability(false));
  $('#probability-use-progress').addEventListener('click', () => renderProbability(true));

  $('#search-input').addEventListener('input', () => {
    libraryLimit = activeVariant === 'all' ? 120 : 30;
    renderLibrary();
  });
  $('#status-filter').addEventListener('change', () => {
    libraryLimit = activeVariant === 'all' ? 120 : 30;
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

  $('#reset-progress').addEventListener('click', () => {
    if (!confirm('Сбросить только прогресс и избранное? Твои локальные изменения вопросов и ответов сохранятся.')) return;
    state.known = [];
    state.review = [];
    state.attempted = [];
    state.favorites = [];
    saveState();
    renderVariantPicker();
    renderDeckModes();
    renderCard();
    renderTrainer();
    renderLibrary();
    renderProbability(true);
    showDeckSession();
    toast('Прогресс сброшен, изменения сохранены');
  });

  $('#reset-everything').addEventListener('click', () => {
    if (!confirm('Полностью очистить данные на этом устройстве? Будут удалены прогресс, избранное и все локальные изменения вопросов и ответов.')) return;
    state.known = [];
    state.review = [];
    state.attempted = [];
    state.favorites = [];
    state.edits = {};
    try { localStorage.removeItem(STORAGE_KEY); } catch (error) { console.warn(error); }
    questions.forEach(question => {
      const original = variants.find(variant => variant.id === question.variantId).questions[question.number - 1];
      if (original) { question.question = original[0]; question.answer = original[1]; }
    });
    randomTest = false;
    activeVariant = 1;
    state.activeVariant = 1;
    deck = makeDeck();
    trainerQueue = makeDeck();
    deckPosition = 0;
    trainerPosition = 0;
    saveState();
    renderVariantPicker();
    renderDeckModes();
    renderCard();
    renderTrainer();
    renderLibrary();
    renderProbability(true);
    showDeckSession();
    toast('Все локальные данные очищены');
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
  initTheme();
  try {
    const response = await fetch(DATA_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error('Не удалось загрузить вопросы: ' + response.status);

    const payload = await response.json();
    variants = payload.variants || [];
    questions = variants.flatMap(variant =>
      variant.questions.map(([question, answer], index) => {
        const sourceNumber = index + 1;
        return {
          id: 'v' + variant.id + '-q' + String(sourceNumber).padStart(2, '0'),
          variantId: variant.id,
          number: sourceNumber,
          question,
          answer
        };
      })
    );
    applyLocalEdits();

    const expectedCounts = [29, 30, 30, 30];
    if (variants.length !== 4 || variants.some((variant, index) => variant.questions.length !== expectedCounts[index]) || questions.length !== 119) {
      throw new Error('Ожидалось 119 исходных вопросов: 29 + 30 + 30 + 30.');
    }

    if (state.activeVariant !== 'all' && !variants.some(variant => variant.id === state.activeVariant)) {
      activeVariant = 1;
    } else {
      activeVariant = state.activeVariant;
    }
    deckMode = state.deckMode === 'ordered' ? 'ordered' : 'shuffle';

    deck = makeDeck();
    trainerQueue = makeDeck();
    renderVariantPicker();
    renderDeckModes();
    renderCard();
    renderTrainer();
    updateStats();
    renderLibrary();
    renderProbability(true);
    showDeckSession();
    wireEvents();
  } catch (error) {
    console.error(error);
    $('#card-question').textContent = 'Не удалось загрузить вопросы. Обнови страницу.';
    $('#trainer-question').textContent = 'Набор вопросов не загрузился.';
    $('#question-list').textContent = 'Не удалось загрузить вопросы. Проверь подключение и обнови страницу.';
  }
}

init();
