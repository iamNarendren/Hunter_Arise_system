const XP_REWARDS = {
  Easy: 10,
  Medium: 25,
  Hard: 50
};

const STORAGE_KEY = "arise.hunter-system.state";
const DATA_VERSION = 1;
const questForm = document.querySelector("#quest-form");
const questTitleInput = document.querySelector("#quest-title");
const questList = document.querySelector("#quest-list");
const emptyState = document.querySelector("#empty-state");
const formFeedback = document.querySelector("#form-feedback");
const actionFeedback = document.querySelector("#action-feedback");
const saveStatus = document.querySelector("#save-status");
const VALID_CATEGORIES = ["Study", "Fitness", "Personal", "Work", "Other"];
const RANKS = ["E", "D", "C", "B", "A", "S"];

let quests = [];
let totalXp = 0;
let totalCompletedQuests = 0;
let dailyCompletions = {};
let lastCompletionDate = null;
let streakCount = 0;
let nextQuestId = 1;
let storage = null;
let persistenceBlocked = false;
let lastSavedText = null;

function createEmptyState() {
  return {
    quests: [],
    totalXp: 0,
    level: 1,
    totalCompletedQuests: 0,
    dailyCompletions: {},
    lastCompletionDate: null,
    streakCount: 0,
    nextQuestId: 1
  };
}

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function getPreviousDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day - 1);
  return date.toISOString().slice(0, 10);
}

function calculateStreakEndingOn(completions, endDate) {
  let streak = 0;
  let date = endDate;

  while (completions[date]) {
    streak += 1;
    date = getPreviousDate(date);
  }

  return streak;
}

function getCurrentStreak() {
  if (!lastCompletionDate) {
    return 0;
  }

  const today = getLocalDateString();
  const yesterday = getPreviousDate(today);
  if (lastCompletionDate !== today && lastCompletionDate !== yesterday) {
    return 0;
  }

  return streakCount;
}

function isValidSavedState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== DATA_VERSION) {
    return false;
  }

  if (!Array.isArray(value.quests)
    || !Number.isSafeInteger(value.totalXp) || value.totalXp < 0
    || value.level !== Math.floor(value.totalXp / 100) + 1
    || !Number.isSafeInteger(value.totalCompletedQuests) || value.totalCompletedQuests < 0
    || !value.dailyCompletions || typeof value.dailyCompletions !== "object" || Array.isArray(value.dailyCompletions)
    || (value.lastCompletionDate !== null && !isValidDateString(value.lastCompletionDate))
    || !Number.isSafeInteger(value.streakCount) || value.streakCount < 0
    || !Number.isSafeInteger(value.nextQuestId) || value.nextQuestId < 1) {
    return false;
  }

  let dailyTotal = 0;
  for (const [date, count] of Object.entries(value.dailyCompletions)) {
    if (!isValidDateString(date) || !Number.isSafeInteger(count) || count < 1) {
      return false;
    }
    dailyTotal += count;
    if (!Number.isSafeInteger(dailyTotal)) {
      return false;
    }
  }

  const dates = Object.keys(value.dailyCompletions).sort();
  const newestCompletionDate = dates.length ? dates[dates.length - 1] : null;
  if (value.totalCompletedQuests !== dailyTotal
    || value.lastCompletionDate !== newestCompletionDate
    || value.streakCount !== (newestCompletionDate
      ? calculateStreakEndingOn(value.dailyCompletions, newestCompletionDate)
      : 0)) {
    return false;
  }

  const ids = new Set();
  const retainedCompletionsByDate = {};
  let largestId = 0;
  let retainedCompletedXp = 0;

  for (const quest of value.quests) {
    if (!quest || typeof quest !== "object"
      || !Number.isSafeInteger(quest.id) || quest.id < 1 || ids.has(quest.id)
      || typeof quest.title !== "string" || !quest.title.trim() || quest.title !== quest.title.trim() || quest.title.length > 80
      || !VALID_CATEGORIES.includes(quest.category)
      || !Object.hasOwn(XP_REWARDS, quest.difficulty)
      || quest.xp !== XP_REWARDS[quest.difficulty]
      || typeof quest.completed !== "boolean") {
      return false;
    }

    ids.add(quest.id);
    largestId = Math.max(largestId, quest.id);

    if (quest.completed) {
      if (!isValidDateString(quest.completedOn) || !value.dailyCompletions[quest.completedOn]) {
        return false;
      }
      retainedCompletionsByDate[quest.completedOn] = (retainedCompletionsByDate[quest.completedOn] || 0) + 1;
      retainedCompletedXp += quest.xp;
    } else if (quest.completedOn !== null) {
      return false;
    }
  }

  for (const [date, count] of Object.entries(retainedCompletionsByDate)) {
    if (count > value.dailyCompletions[date]) {
      return false;
    }
  }

  const retainedCompletedCount = value.quests.filter((quest) => quest.completed).length;
  return value.nextQuestId > largestId
    && value.totalCompletedQuests >= retainedCompletedCount
    && value.totalXp >= retainedCompletedXp;
}

function applySavedState(savedState) {
  quests = savedState.quests;
  totalXp = savedState.totalXp;
  totalCompletedQuests = savedState.totalCompletedQuests;
  dailyCompletions = savedState.dailyCompletions;
  lastCompletionDate = savedState.lastCompletionDate;
  streakCount = savedState.streakCount;
  nextQuestId = savedState.nextQuestId;
}

function getStateForStorage() {
  return {
    version: DATA_VERSION,
    quests,
    totalXp,
    level: Math.floor(totalXp / 100) + 1,
    totalCompletedQuests,
    dailyCompletions,
    lastCompletionDate,
    streakCount,
    nextQuestId
  };
}

function setSaveStatus(message, isError = false) {
  saveStatus.textContent = message;
  saveStatus.classList.toggle("error", isError);
}

function loadState() {
  try {
    storage = window.localStorage;
    const savedText = storage.getItem(STORAGE_KEY);

    if (savedText === null) {
      applySavedState(createEmptyState());
      setSaveStatus("NO SAVE YET");
      return;
    }

    let savedState;
    try {
      savedState = JSON.parse(savedText);
    } catch {
      persistenceBlocked = true;
      applySavedState(createEmptyState());
      setSaveStatus("SAVED DATA NEEDS RECOVERY", true);
      showFeedback(actionFeedback, "Saved data could not be read. The original record was left untouched, and this session will not overwrite it. Copy it from browser storage before attempting recovery.", true);
      return;
    }

    if (!isValidSavedState(savedState)) {
      persistenceBlocked = true;
      applySavedState(createEmptyState());
      setSaveStatus("SAVED DATA NEEDS RECOVERY", true);
      showFeedback(actionFeedback, "Saved data is outdated or invalid. It was left untouched, and this session will not overwrite it. Copy the record from browser storage before attempting recovery.", true);
      return;
    }

    applySavedState(savedState);
    lastSavedText = JSON.stringify(getStateForStorage());
    setSaveStatus("SAVED");
  } catch {
    storage = null;
    applySavedState(createEmptyState());
    setSaveStatus("MEMORY ONLY", true);
    showFeedback(actionFeedback, "Browser storage is unavailable. You can use ARISE in this tab, but changes cannot be saved.", true);
  }
}

function saveState() {
  if (!storage || persistenceBlocked) {
    return false;
  }

  const savedText = JSON.stringify(getStateForStorage());
  if (savedText === lastSavedText) {
    setSaveStatus("SAVED");
    return true;
  }

  try {
    storage.setItem(STORAGE_KEY, savedText);
    lastSavedText = savedText;
    setSaveStatus("SAVED");
    return true;
  } catch {
    setSaveStatus("SAVE FAILED", true);
    return false;
  }
}

function createQuest(title, category, difficulty) {
  return {
    id: nextQuestId++,
    title,
    category,
    difficulty,
    xp: XP_REWARDS[difficulty],
    completed: false,
    completedOn: null
  };
}

function renderQuests() {
  questList.replaceChildren();

  if (quests.length === 0) {
    emptyState.hidden = false;
    questList.append(emptyState);
  } else {
    emptyState.hidden = true;
  }

  quests.forEach((quest) => {
    const item = document.createElement("article");
    item.className = "quest-item";

    const details = document.createElement("div");
    details.className = "quest-details";

    const title = document.createElement("h3");
    title.className = "quest-title";
    title.textContent = quest.title;

    const meta = document.createElement("div");
    meta.className = "quest-meta";

    const category = document.createElement("span");
    category.className = "quest-category";
    category.textContent = quest.category;

    const difficulty = document.createElement("span");
    difficulty.className = "quest-difficulty";
    difficulty.textContent = quest.difficulty;

    const xp = document.createElement("span");
    xp.className = "quest-xp";
    xp.textContent = `+${quest.xp} XP`;

    meta.append(category, difficulty, xp);
    if (quest.completed) {
      const completedOn = document.createElement("span");
      completedOn.className = "quest-difficulty";
      completedOn.textContent = `Done ${quest.completedOn}`;
      meta.append(completedOn);
    }
    details.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "quest-actions";

    const completeButton = document.createElement("button");
    completeButton.className = "complete-button";
    completeButton.type = "button";
    completeButton.textContent = quest.completed ? "Completed" : "Complete";
    completeButton.disabled = quest.completed;
    completeButton.setAttribute("aria-label", `${quest.completed ? "Completed" : "Complete"} quest: ${quest.title}`);
    completeButton.addEventListener("click", () => completeQuest(quest.id));

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", `Delete quest: ${quest.title}`);
    deleteButton.addEventListener("click", () => deleteQuest(quest.id));

    actions.append(completeButton, deleteButton);
    item.append(details, actions);
    questList.append(item);
  });

  updateQuestStats();
}

function updateQuestStats() {
  document.querySelector("#total-quests").textContent = quests.length;
  document.querySelector("#completed-quests").textContent = totalCompletedQuests;
  document.querySelector("#daily-completions").textContent = dailyCompletions[getLocalDateString()] || 0;
  document.querySelector("#active-quests").textContent = quests.filter((quest) => !quest.completed).length;
  document.querySelector("#quest-count").textContent = quests.length;
}

function updateHunterStats() {
  const level = Math.floor(totalXp / 100) + 1;
  const xpInLevel = totalXp % 100;
  const xpProgress = document.querySelector(".xp-track");
  const rank = RANKS[Math.min(Math.floor((level - 1) / 5), RANKS.length - 1)];
  const currentStreak = getCurrentStreak();

  document.querySelector("#rank-badge").textContent = rank;
  document.querySelector("#rank-label").textContent = `${rank}-RANK HUNTER`;
  document.querySelector("#level-label").textContent = `LEVEL ${level}`;
  document.querySelector("#xp-current").textContent = xpInLevel;
  document.querySelector("#xp-next").textContent = 100;
  document.querySelector("#xp-total").textContent = totalXp;
  document.querySelector("#xp-fill").style.width = `${xpInLevel}%`;
  document.querySelector("#xp-footnote").textContent = `${100 - xpInLevel} XP to your next level`;
  document.querySelector("#streak-count").textContent = currentStreak;
  document.querySelector("#streak-unit").textContent = currentStreak === 1 ? " day" : " days";
  xpProgress.setAttribute("aria-valuemax", 100);
  xpProgress.setAttribute("aria-valuenow", xpInLevel);
}

function showFeedback(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("error", isError);
  element.hidden = false;
}

function completeQuest(questId) {
  const quest = quests.find((item) => item.id === questId);

  if (!quest) {
    return;
  }

  if (quest.completed) {
    showFeedback(actionFeedback, `"${quest.title}" is already complete; no extra XP was awarded.`, true);
    return;
  }

  const today = getLocalDateString();
  const yesterday = getPreviousDate(today);
  quest.completed = true;
  quest.completedOn = today;
  totalXp += quest.xp;
  totalCompletedQuests += 1;
  dailyCompletions[today] = (dailyCompletions[today] || 0) + 1;

  if (lastCompletionDate !== today) {
    streakCount = lastCompletionDate === yesterday ? streakCount + 1 : 1;
    lastCompletionDate = today;
  }

  renderQuests();
  updateHunterStats();
  const saved = saveState();
  const saveNote = saved ? "" : " This change is only in this tab and was not saved.";
  showFeedback(actionFeedback, `"${quest.title}" completed. You earned ${quest.xp} XP.${saveNote}`, !saved);
}

function deleteQuest(questId) {
  const quest = quests.find((item) => item.id === questId);

  if (!quest) {
    return;
  }

  quests = quests.filter((quest) => quest.id !== questId);
  renderQuests();
  updateHunterStats();
  const saved = saveState();
  const message = quest.completed
    ? `"${quest.title}" deleted. Previously earned XP remains unchanged.`
    : `"${quest.title}" deleted. No XP was awarded.`;
  showFeedback(actionFeedback, `${message}${saved ? "" : " This change is only in this tab and was not saved."}`, !saved);
}

questForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const formData = new FormData(questForm);
  const titleValue = formData.get("title");
  const category = formData.get("category");
  const difficulty = formData.get("difficulty");

  if (typeof titleValue !== "string") {
    showFeedback(formFeedback, "Enter a quest title before adding the quest.", true);
    return;
  }

  const title = titleValue.trim();
  if (!title) {
    showFeedback(formFeedback, "Quest title cannot be blank. Enter a title with at least one visible character.", true);
    questTitleInput.focus();
    return;
  }

  if (title.length > 80) {
    showFeedback(formFeedback, "Quest titles must be 80 characters or fewer.", true);
    questTitleInput.focus();
    return;
  }

  if (typeof category !== "string" || !VALID_CATEGORIES.includes(category)) {
    showFeedback(formFeedback, "Choose a valid quest category.", true);
    return;
  }

  if (typeof difficulty !== "string" || !Object.hasOwn(XP_REWARDS, difficulty)) {
    showFeedback(formFeedback, "Choose a valid quest difficulty.", true);
    return;
  }

  quests.push(createQuest(title, category, difficulty));
  renderQuests();
  questForm.reset();
  const saved = saveState();
  const saveNote = saved ? "" : " This change is only in this tab and was not saved.";
  showFeedback(formFeedback, `"${title}" added to your quest board.${saveNote}`, !saved);
  questTitleInput.focus();
});

let displayedDate = getLocalDateString();

function refreshForNewCalendarDay() {
  const today = getLocalDateString();
  if (today === displayedDate) {
    return;
  }

  displayedDate = today;
  updateQuestStats();
  updateHunterStats();
}

loadState();
renderQuests();
updateHunterStats();
window.setInterval(refreshForNewCalendarDay, 60_000);
