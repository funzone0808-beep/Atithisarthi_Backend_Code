const MENU_RESULT_LIMIT = 3;
const NON_VEG_TERMS = [
  "chicken",
  "mutton",
  "fish",
  "prawn",
  "prawns",
  "seafood",
  "egg",
  "eggs"
];
const VEG_HINT_TERMS = [
  "veg",
  "vegetarian",
  "paneer",
  "mushroom",
  "dal",
  "gobi",
  "aloo",
  "soya",
  "chaap"
];
const SPICY_TERMS = [
  "spicy",
  "hot",
  "masala",
  "schezwan",
  "chilli",
  "tandoori"
];
const MILD_TERMS = [
  "mild",
  "less spicy",
  "not spicy",
  "light",
  "plain",
  "basic"
];
const CATEGORY_HINTS = [
  {
    label: "starter",
    terms: ["starter", "starters", "appetizer", "appetizers", "snack", "snacks"]
  },
  {
    label: "main course",
    terms: ["main", "main course", "meal", "curry", "gravy", "biryani", "rice"]
  },
  {
    label: "bread",
    terms: ["bread", "naan", "roti", "paratha", "kulcha"]
  },
  {
    label: "beverage",
    terms: ["drink", "drinks", "beverage", "beverages", "juice", "shake", "tea", "coffee"]
  },
  {
    label: "dessert",
    terms: ["dessert", "desserts", "sweet", "sweets", "ice cream"]
  }
];
const COMBO_BUCKET_PRIORITY = [
  "starter",
  "main course",
  "bread",
  "beverage",
  "dessert",
  "other"
];
const OUT_OF_SCOPE_PATTERNS = [
  /\border status\b/,
  /\btrack\b.*\border\b/,
  /\bwhere is my order\b/,
  /\bpayment\b/,
  /\bpaid\b/,
  /\bbill\b/,
  /\bcall staff\b/,
  /\bhelp\b/,
  /\bsupport\b/,
  /\breservation\b/,
  /\bbook table\b/
];

function normalizeAssistantText(value = "", maxLength = 500) {
  return typeof value === "string"
    ? value.trim().slice(0, maxLength)
    : "";
}

function normalizeAssistantNumber(value, fallback = null) {
  const candidate = Number(value);
  return Number.isFinite(candidate) ? candidate : fallback;
}

function normalizeAssistantBoolean(value) {
  return value === true;
}

function normalizeAssistantTone(value = "") {
  const candidate = normalizeAssistantText(value, 40).toLowerCase();
  return ["friendly", "formal"].includes(candidate) ? candidate : "default";
}

function formatInr(value = 0) {
  const amount = Number(value || 0);
  return `Rs ${Math.round(amount)}`;
}

function normalizeServiceContext(context = {}) {
  const orderType = normalizeAssistantText(context.orderType, 40).toLowerCase();
  const tableNumber = normalizeAssistantText(context.tableNumber, 80);
  const orderSource = normalizeAssistantText(context.orderSource, 40).toLowerCase();
  const addMode = normalizeAssistantBoolean(context.addMode);
  const isDineIn = !!tableNumber && (orderType === "dine-in" || orderType === "dinein");

  return {
    orderType,
    tableNumber,
    orderSource,
    addMode: isDineIn && addMode,
    isDineIn
  };
}

function getServiceContextLead(serviceContext = {}) {
  if (!serviceContext.isDineIn || !serviceContext.tableNumber) {
    return "";
  }

  return serviceContext.addMode
    ? `For Table ${serviceContext.tableNumber} add-on menu help, `
    : `For Table ${serviceContext.tableNumber}, `;
}

function getTonePhrase(tone = "default", variants = {}) {
  if (tone === "friendly" && variants.friendly) {
    return variants.friendly;
  }

  if (tone === "formal" && variants.formal) {
    return variants.formal;
  }

  return variants.default || "";
}

function tokenizeAssistantText(value = "") {
  return normalizeAssistantText(value, 5000)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function hasAnyToken(text = "", terms = []) {
  return terms.some((term) => text.includes(term));
}

function parseBudgetFromMessage(message = "") {
  const normalizedMessage = normalizeAssistantText(message, 5000).toLowerCase();
  const directMatch = normalizedMessage.match(
    /(?:under|below|within|less than|budget(?:\s+of)?|around)\s*(?:rs\.?|inr|₹)?\s*(\d{2,5})/
  );

  if (directMatch) {
    return normalizeAssistantNumber(directMatch[1], null);
  }

  const currencyMatch = normalizedMessage.match(/(?:rs\.?|inr|₹)\s*(\d{2,5})/);
  return currencyMatch ? normalizeAssistantNumber(currencyMatch[1], null) : null;
}

function parsePeopleCountFromMessage(message = "") {
  const normalizedMessage = normalizeAssistantText(message, 5000).toLowerCase();
  const countedMatch = normalizedMessage.match(
    /(?:for|serve(?:s)?|combo for)\s*(\d{1,2})\s*(?:people|persons|person|guests)?/
  );

  if (countedMatch) {
    return normalizeAssistantNumber(countedMatch[1], null);
  }

  const trailingMatch = normalizedMessage.match(/(\d{1,2})\s*(?:people|persons|person|guests)/);
  return trailingMatch ? normalizeAssistantNumber(trailingMatch[1], null) : null;
}

function detectCategoryHint(message = "") {
  const normalizedMessage = normalizeAssistantText(message, 5000).toLowerCase();

  for (const hint of CATEGORY_HINTS) {
    if (hasAnyToken(normalizedMessage, hint.terms)) {
      return hint.label;
    }
  }

  return "";
}

function getCategoryBucket(category = "") {
  const normalizedCategory = normalizeAssistantText(category, 200).toLowerCase();

  if (!normalizedCategory) {
    return "other";
  }

  for (const hint of CATEGORY_HINTS) {
    if (
      normalizedCategory.includes(hint.label) ||
      hint.terms.some((term) => normalizedCategory.includes(term))
    ) {
      return hint.label;
    }
  }

  return "other";
}

function normalizeMenuItem(rawItem = {}) {
  const price = Number(rawItem.price || 0);
  const item = {
    itemId: normalizeAssistantText(rawItem.item_id || rawItem.itemId, 120),
    name: normalizeAssistantText(rawItem.name, 160),
    description: normalizeAssistantText(rawItem.description, 1000),
    category: normalizeAssistantText(rawItem.category, 120),
    badge: normalizeAssistantText(rawItem.badge, 120),
    tag: normalizeAssistantText(rawItem.tag, 120),
    price: Number.isFinite(price) ? price : 0,
    sortOrder: Number(rawItem.sort_order || rawItem.sortOrder || 0) || 0
  };

  item.searchText = [
    item.name,
    item.description,
    item.category,
    item.badge,
    item.tag
  ]
    .join(" ")
    .toLowerCase();
  item.isNonVeg = hasAnyToken(item.searchText, NON_VEG_TERMS);
  item.isVegHinted = hasAnyToken(item.searchText, VEG_HINT_TERMS) || !item.isNonVeg;
  item.isSpicy = hasAnyToken(item.searchText, SPICY_TERMS);

  return item;
}

function findExactMenuItemMatch(message = "", menuItems = []) {
  const normalizedMessage = normalizeAssistantText(message, 5000).toLowerCase();
  let bestMatch = null;

  for (const item of menuItems) {
    const normalizedName = item.name.toLowerCase();

    if (!normalizedName) {
      continue;
    }

    if (normalizedMessage.includes(normalizedName)) {
      if (!bestMatch || normalizedName.length > bestMatch.name.length) {
        bestMatch = item;
      }
      continue;
    }

    const nameTokens = tokenizeAssistantText(normalizedName);
    const tokenMatchCount = nameTokens.filter((token) => normalizedMessage.includes(token)).length;

    if (
      nameTokens.length >= 2 &&
      tokenMatchCount === nameTokens.length &&
      (!bestMatch || nameTokens.length > tokenizeAssistantText(bestMatch.name).length)
    ) {
      bestMatch = item;
    }
  }

  return bestMatch;
}

function buildDetectedPreferences(message = "", context = {}) {
  const normalizedMessage = normalizeAssistantText(message, 5000).toLowerCase();
  const wantsNonVeg = /non[\s-]?veg|chicken|mutton|fish|prawn|egg/.test(normalizedMessage);
  const wantsVeg = !wantsNonVeg && /veg|vegetarian|paneer|mushroom|dal|aloo|gobi|soya/.test(normalizedMessage);
  const wantsSpicy = hasAnyToken(normalizedMessage, SPICY_TERMS);
  const wantsMild = hasAnyToken(normalizedMessage, MILD_TERMS);
  const asksForExplanation =
    normalizedMessage.includes("what is") ||
    normalizedMessage.includes("tell me about") ||
    normalizedMessage.includes("explain") ||
    normalizedMessage.includes("describe");
  const wantsCombo =
    normalizedMessage.includes("combo") ||
    normalizedMessage.includes("for two") ||
    normalizedMessage.includes("for 2") ||
    normalizedMessage.includes("for family") ||
    normalizedMessage.includes("for group");
  const wantsRecommendation =
    normalizedMessage.includes("recommend") ||
    normalizedMessage.includes("suggest") ||
    normalizedMessage.includes("best") ||
    wantsCombo ||
    wantsVeg ||
    wantsNonVeg ||
    wantsSpicy ||
    wantsMild;
  const asksOutOfScopeQuestion = OUT_OF_SCOPE_PATTERNS.some((pattern) =>
    pattern.test(normalizedMessage)
  );

  return {
    budget: parseBudgetFromMessage(normalizedMessage) ?? normalizeAssistantNumber(context.budget, null),
    peopleCount: parsePeopleCountFromMessage(normalizedMessage) ?? normalizeAssistantNumber(context.peopleCount, null),
    wantsVeg,
    wantsNonVeg,
    spicePreference: wantsSpicy ? "spicy" : wantsMild ? "mild" : "",
    categoryHint: detectCategoryHint(normalizedMessage),
    asksForExplanation,
    wantsCombo,
    wantsRecommendation,
    asksOutOfScopeQuestion
  };
}

function getQueryTokens(message = "") {
  return tokenizeAssistantText(message).filter(
    (token) =>
      ![
        "best",
        "menu",
        "restaurant",
        "hotel",
        "dish",
        "dishes",
        "item",
        "items",
        "show",
        "want",
        "need",
        "please",
        "under",
        "below",
        "within",
        "budget",
        "combo"
      ].includes(token)
  );
}

function matchesCategory(item = {}, categoryHint = "") {
  if (!categoryHint) {
    return true;
  }

  return item.searchText.includes(categoryHint) || item.category.toLowerCase().includes(categoryHint);
}

function scoreMenuItem(item = {}, preferences = {}, queryTokens = []) {
  let score = 0;

  if (preferences.wantsVeg && item.isNonVeg) {
    return -100;
  }

  if (preferences.wantsNonVeg) {
    score += item.isNonVeg ? 5 : -3;
  }

  if (preferences.wantsVeg) {
    score += item.isNonVeg ? -8 : 4;
  }

  if (preferences.categoryHint) {
    score += matchesCategory(item, preferences.categoryHint) ? 5 : -1;
  }

  if (preferences.spicePreference === "spicy") {
    score += item.isSpicy ? 3 : -1;
  }

  if (preferences.spicePreference === "mild") {
    score += item.isSpicy ? -3 : 2;
  }

  if (preferences.budget !== null) {
    score += item.price <= preferences.budget ? 3 : -4;
  }

  for (const token of queryTokens) {
    if (item.searchText.includes(token)) {
      score += 1;
    }
  }

  score += Math.max(0, 2 - item.sortOrder / 10);
  return score;
}

function buildRecommendationReason(item = {}, preferences = {}) {
  const reasons = [];

  if (preferences.categoryHint && matchesCategory(item, preferences.categoryHint)) {
    reasons.push(`fits the ${preferences.categoryHint} request`);
  }

  if (preferences.wantsVeg && !item.isNonVeg) {
    reasons.push("matches a veg preference");
  }

  if (preferences.wantsNonVeg && item.isNonVeg) {
    reasons.push("matches a non-veg preference");
  }

  if (preferences.spicePreference === "spicy" && item.isSpicy) {
    reasons.push("looks like a spicy option");
  }

  if (preferences.spicePreference === "mild" && !item.isSpicy) {
    reasons.push("looks like a milder option");
  }

  if (preferences.budget !== null && item.price <= preferences.budget) {
    reasons.push(`stays within ${formatInr(preferences.budget)}`);
  }

  return reasons.slice(0, 2).join(", ") || "available on the current menu";
}

function rankMenuItems(menuItems = [], preferences = {}, message = "") {
  const queryTokens = getQueryTokens(message);

  return menuItems
    .map((item) => ({
      ...item,
      categoryBucket: getCategoryBucket(item.category),
      score: scoreMenuItem(item, preferences, queryTokens)
    }))
    .filter((item) => item.score > -10)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (left.price !== right.price) {
        return left.price - right.price;
      }

      return left.sortOrder - right.sortOrder;
    });
}

function buildComboReason(item = {}, comboTotal = 0, preferences = {}) {
  const reasons = [];

  if (item.categoryBucket && item.categoryBucket !== "other") {
    reasons.push(`adds a ${item.categoryBucket} option`);
  }

  if (preferences.wantsVeg && !item.isNonVeg) {
    reasons.push("fits a veg request");
  }

  if (preferences.wantsNonVeg && item.isNonVeg) {
    reasons.push("fits a non-veg request");
  }

  if (preferences.spicePreference === "spicy" && item.isSpicy) {
    reasons.push("keeps the combo spicy");
  }

  if (preferences.spicePreference === "mild" && !item.isSpicy) {
    reasons.push("keeps the combo mild");
  }

  if (preferences.budget !== null && comboTotal <= preferences.budget) {
    reasons.push(`helps keep the combo near ${formatInr(preferences.budget)}`);
  }

  return reasons.slice(0, 2).join(", ") || "works well in a simple combo";
}

function buildComboSuggestion(rankedItems = [], preferences = {}) {
  if (!rankedItems.length) {
    return {
      items: [],
      total: 0,
      fitsBudget: preferences.budget === null
    };
  }

  const targetCount = Math.max(
    2,
    Math.min(3, preferences.peopleCount && preferences.peopleCount >= 3 ? 3 : 2)
  );
  const selectedItems = [];
  const selectedIds = new Set();
  const selectedBuckets = new Set();
  let runningTotal = 0;

  function canFitBudget(item) {
    if (preferences.budget === null) {
      return true;
    }

    return runningTotal + Number(item.price || 0) <= preferences.budget;
  }

  function pushItem(item) {
    if (!item || selectedIds.has(item.itemId)) {
      return false;
    }

    if (!canFitBudget(item)) {
      return false;
    }

    selectedItems.push(item);
    selectedIds.add(item.itemId);
    selectedBuckets.add(item.categoryBucket || "other");
    runningTotal += Number(item.price || 0);
    return true;
  }

  const bucketPriority = preferences.categoryHint
    ? [
        preferences.categoryHint,
        ...COMBO_BUCKET_PRIORITY.filter((bucket) => bucket !== preferences.categoryHint)
      ]
    : COMBO_BUCKET_PRIORITY;

  for (const bucket of bucketPriority) {
    if (selectedItems.length >= targetCount) {
      break;
    }

    const candidate = rankedItems.find(
      (item) => !selectedIds.has(item.itemId) && item.categoryBucket === bucket
    );

    if (candidate) {
      pushItem(candidate);
    }
  }

  for (const item of rankedItems) {
    if (selectedItems.length >= targetCount) {
      break;
    }

    if (selectedBuckets.has(item.categoryBucket) && selectedItems.length >= 2) {
      continue;
    }

    pushItem(item);
  }

  for (const item of rankedItems) {
    if (selectedItems.length >= targetCount) {
      break;
    }

    pushItem(item);
  }

  return {
    items: selectedItems.map((item) => ({
      itemId: item.itemId,
      name: item.name,
      category: item.category || "menu",
      price: item.price,
      description: item.description,
      reason: ""
    })),
    total: runningTotal,
    fitsBudget: preferences.budget === null || runningTotal <= preferences.budget
  };
}

function pickSuggestedItems(menuItems = [], preferences = {}, message = "") {
  return rankMenuItems(menuItems, preferences, message)
    .slice(0, MENU_RESULT_LIMIT)
    .map((item) => ({
      itemId: item.itemId,
      name: item.name,
      category: item.category || "menu",
      price: item.price,
      description: item.description,
      reason: buildRecommendationReason(item, preferences)
    }));
}

function buildActionSuggestions(suggestedItems = []) {
  const actions = suggestedItems.slice(0, MENU_RESULT_LIMIT).map((item) => ({
    type: "add_to_cart",
    itemId: item.itemId,
    label: `Add ${item.name} to cart`
  }));

  actions.push({
    type: "open_cart",
    label: "Open cart"
  });
  actions.push({
    type: "view_full_menu",
    label: "View full menu"
  });

  return actions;
}

function buildExplanationAnswer(hotelName = "", item = {}, serviceContext = {}, tone = "default") {
  const description = item.description || "No detailed description is available for this item yet.";
  const categoryText = item.category ? ` in the ${item.category} section` : "";
  const leadText = getTonePhrase(tone, {
    default: `${item.name} is currently available${categoryText} at ${hotelName}.`,
    friendly: `${item.name} is on the menu${categoryText} at ${hotelName}.`,
    formal: `${item.name} is currently listed${categoryText} at ${hotelName}.`
  });
  const priceText = getTonePhrase(tone, {
    default: `It is priced at ${formatInr(item.price)}.`,
    friendly: `It currently comes in at ${formatInr(item.price)}.`,
    formal: `The current listed price is ${formatInr(item.price)}.`
  });

  return `${getServiceContextLead(serviceContext)}${leadText} ${description} ${priceText}`;
}

function buildRecommendationAnswer(
  hotelName = "",
  suggestedItems = [],
  preferences = {},
  serviceContext = {},
  tone = "default"
) {
  if (!suggestedItems.length) {
    return `${getServiceContextLead(serviceContext)}${getTonePhrase(tone, {
      default: `I could not find a strong match in ${hotelName}'s current menu for that request, but you can still browse the full menu for nearby options.`,
      friendly: `I could not find a close match in ${hotelName}'s current menu for that just yet, but you can still browse the full menu for nearby options.`,
      formal: `I could not identify a strong match in ${hotelName}'s current menu for that request, though the full menu remains available for nearby options.`
    })}`;
  }

  const itemNames = suggestedItems.map((item) => item.name);
  const budgetText =
    preferences.budget !== null ? ` within about ${formatInr(preferences.budget)}` : "";
  const peopleText =
    preferences.peopleCount ? ` for ${preferences.peopleCount} people` : "";
  const leadText = preferences.wantsCombo
    ? getTonePhrase(tone, {
        default: "Here is a simple combo-style suggestion",
        friendly: "Here is a simple combo-style pick",
        formal: "Here is a grounded combo-style suggestion"
      })
    : getTonePhrase(tone, {
        default: "Here are some grounded menu suggestions",
        friendly: "Here are some grounded menu picks",
        formal: "Here are several grounded menu suggestions"
      });

  return `${getServiceContextLead(serviceContext)}${leadText}${peopleText}${budgetText} from ${hotelName}'s current menu: ${itemNames.join(", ")}.`;
}

function buildComboAnswer(
  hotelName = "",
  combo = {},
  preferences = {},
  serviceContext = {},
  tone = "default"
) {
  const suggestedItems = Array.isArray(combo.items) ? combo.items : [];

  if (suggestedItems.length < 2) {
    if (preferences.budget !== null) {
      return `${getServiceContextLead(serviceContext)}${getTonePhrase(tone, {
        default: `I could not build a full combo within ${formatInr(preferences.budget)} from ${hotelName}'s current menu, so I picked the closest grounded options instead.`,
        friendly: `I could not build a full combo within ${formatInr(preferences.budget)} from ${hotelName}'s current menu, so I picked the closest grounded options for you instead.`,
        formal: `I could not assemble a full combo within ${formatInr(preferences.budget)} from ${hotelName}'s current menu, so I selected the closest grounded options instead.`
      })}`;
    }

    return `${getServiceContextLead(serviceContext)}${getTonePhrase(tone, {
      default: `I could not build a strong combo mix from ${hotelName}'s current menu, so I picked the closest grounded options instead.`,
      friendly: `I could not build a strong combo mix from ${hotelName}'s current menu, so I picked the closest grounded options instead.`,
      formal: `I could not assemble a strong combo mix from ${hotelName}'s current menu, so I selected the closest grounded options instead.`
    })}`;
  }

  const peopleText = preferences.peopleCount
    ? ` for ${preferences.peopleCount} people`
    : "";
  const budgetText =
    preferences.budget !== null
      ? combo.fitsBudget
        ? ` and stays near ${formatInr(preferences.budget)}`
        : ` with an estimated total of ${formatInr(combo.total)}`
      : ` with an estimated total of ${formatInr(combo.total)}`;

  const leadText = getTonePhrase(tone, {
    default: "Here is a grounded combo suggestion",
    friendly: "Here is a grounded combo idea",
    formal: "Here is a grounded combo recommendation"
  });

  return `${getServiceContextLead(serviceContext)}${leadText}${peopleText} from ${hotelName}'s current menu: ${suggestedItems
    .map((item) => item.name)
    .join(", ")}. It has an estimated total of ${formatInr(combo.total)}${preferences.budget !== null && combo.fitsBudget ? ` and stays near ${formatInr(preferences.budget)}` : ""}.`;
}

function buildOutOfScopeAnswer(hotelName = "", serviceContext = {}, tone = "default") {
  if (serviceContext.isDineIn && serviceContext.tableNumber) {
    return getTonePhrase(tone, {
      default: `For Table ${serviceContext.tableNumber}, I can safely help only with ${hotelName}'s live menu, dish suggestions, budgets, spice level, and combo ideas. For live order status, bill requests, or staff help, please use the regular table-order options on the site.`,
      friendly: `For Table ${serviceContext.tableNumber}, I can safely help only with ${hotelName}'s live menu, dish suggestions, budgets, spice level, and combo ideas. For live order status, bill requests, or staff help, please use the regular table-order options on the site.`,
      formal: `For Table ${serviceContext.tableNumber}, this assistant is limited to ${hotelName}'s live menu, dish suggestions, budget guidance, spice-level guidance, and combo ideas. For live order status, bill requests, or staff assistance, please use the regular table-order options on the site.`
    });
  }

  return getTonePhrase(tone, {
    default: `Right now I can safely help only with ${hotelName}'s live menu, dish suggestions, budgets, spice level, and combo ideas. For order tracking, bill requests, staff help, or payment questions, please use the regular order and support options on the site.`,
    friendly: `Right now I can safely help only with ${hotelName}'s live menu, dish suggestions, budgets, spice level, and combo ideas. For order tracking, bill requests, staff help, or payment questions, please use the regular order and support options on the site.`,
    formal: `At present, this assistant is limited to ${hotelName}'s live menu, dish suggestions, budget guidance, spice-level guidance, and combo ideas. For order tracking, bill requests, staff help, or payment questions, please use the regular order and support options on the site.`
  });
}

function buildFallbackAnswer(
  hotelName = "",
  normalizedMenuItems = [],
  preferences = {},
  serviceContext = {},
  tone = "default"
) {
  const availableBuckets = Array.from(
    new Set(
      normalizedMenuItems
        .map((item) => getCategoryBucket(item.category))
        .filter((bucket) => bucket && bucket !== "other")
    )
  ).slice(0, 4);
  const categoryText = availableBuckets.length
    ? ` You can ask for things like ${availableBuckets.join(", ")} recommendations.`
    : "";
  const budgetText =
    preferences.budget !== null
      ? ` I also understand budget questions around ${formatInr(preferences.budget)}.`
      : "";

  return `${getServiceContextLead(serviceContext)}${getTonePhrase(tone, {
    default: `I could not find a strong grounded match in ${hotelName}'s current menu for that request.${categoryText}${budgetText}`,
    friendly: `I could not find a strong grounded match in ${hotelName}'s current menu for that request.${categoryText}${budgetText}`,
    formal: `I could not identify a strong grounded match in ${hotelName}'s current menu for that request.${categoryText}${budgetText}`
  })}`;
}

function buildFollowUpPrompts({
  hotelName = "",
  suggestions = [],
  preferences = {},
  meta = {},
  serviceContext = {}
}) {
  const prompts = [];
  const seenPrompts = new Set();
  const isTableContext = serviceContext.isDineIn && !!serviceContext.tableNumber;
  const isAddMode = isTableContext && serviceContext.addMode;

  function addPrompt(value = "") {
    const prompt = normalizeAssistantText(value, 120);

    if (!prompt) {
      return;
    }

    const normalizedKey = prompt.toLowerCase();

    if (seenPrompts.has(normalizedKey)) {
      return;
    }

    seenPrompts.add(normalizedKey);
    prompts.push(prompt);
  }

  const leadItem = suggestions[0];
  const leadItemName = leadItem?.name || "";

  if (meta.mode === "out_of_scope") {
    if (isAddMode) {
      addPrompt("Suggest something light to add");
      addPrompt("Suggest a mild starter to add");
      addPrompt("Suggest a drink to add for 2 people");
    } else if (isTableContext) {
      addPrompt("Suggest a starter to share for 2 people");
      addPrompt("Suggest a light dish for this table");
      addPrompt("Suggest a drink for 2 people");
    } else {
      addPrompt("Best veg starter under 300");
      addPrompt("Suggest something spicy for 2 people");
      addPrompt("Show a simple combo under 700");
    }
    return prompts.slice(0, 3);
  }

  if (leadItemName && (meta.mode === "item_lookup" || meta.mode === "explain_item")) {
    addPrompt(`What goes well with ${leadItemName}?`);
    addPrompt(`Add ${leadItemName} to cart`);
  }

  if (meta.mode === "combo_recommendation") {
    if (isAddMode) {
      addPrompt("Suggest something light to add");
      addPrompt("Suggest a drink to add");
    } else if (isTableContext) {
      addPrompt("Suggest a starter to share for this table");
      addPrompt("Suggest a light dish for this table");
    }

    if (!preferences.wantsVeg) {
      addPrompt("Make it veg");
    }

    if (!preferences.wantsNonVeg) {
      addPrompt("Show a non-veg combo");
    }

    if (preferences.spicePreference !== "mild") {
      addPrompt("Suggest a milder combo");
    }

    if (preferences.budget !== null) {
      addPrompt(`Suggest a cheaper combo than ${formatInr(preferences.budget)}`);
    } else {
      addPrompt("Suggest a combo under 700");
    }
  } else {
    if (isAddMode) {
      addPrompt("Suggest something light to add");
      addPrompt("Suggest a mild side dish to add");
    } else if (isTableContext) {
      addPrompt("Suggest a starter to share for this table");
      addPrompt("Suggest a light dish for this table");
    }

    if (!preferences.wantsVeg) {
      addPrompt("Show veg options");
    }

    if (!preferences.wantsNonVeg) {
      addPrompt("Show non-veg options");
    }

    if (preferences.spicePreference !== "spicy") {
      addPrompt("Suggest something spicy");
    }

    if (preferences.spicePreference !== "mild") {
      addPrompt("Suggest something mild");
    }

    if (preferences.peopleCount === null) {
      addPrompt("Suggest something for 2 people");
    }

    if (preferences.budget === null) {
      addPrompt("Suggest something under 500");
    }
  }

  if (prompts.length < 3 && leadItemName) {
    addPrompt(`Tell me about ${leadItemName}`);
  }

  if (prompts.length < 3) {
    addPrompt(`What is popular at ${hotelName}?`);
  }

  return prompts.slice(0, 4);
}

function buildGroundedMenuAssistantReply({
  hotelName = "this restaurant",
  message = "",
  menuItems = [],
  context = {},
  tone = "default"
}) {
  const normalizedMenuItems = menuItems
    .map((item) => normalizeMenuItem(item))
    .filter((item) => item.itemId && item.name);
  const preferences = buildDetectedPreferences(message, context);
  const serviceContext = normalizeServiceContext(context);
  const assistantTone = normalizeAssistantTone(tone);
  const exactItemMatch = findExactMenuItemMatch(message, normalizedMenuItems);

  if (preferences.asksOutOfScopeQuestion) {
    const meta = {
      mode: "out_of_scope",
      groundedItemCount: 0
    };

    return {
      answer: buildOutOfScopeAnswer(hotelName, serviceContext, assistantTone),
      suggestions: [],
      suggestedActions: [
        {
          type: "view_full_menu",
          label: "View full menu"
        }
      ],
      followUpPrompts: buildFollowUpPrompts({
        hotelName,
        suggestions: [],
        preferences,
        meta,
        serviceContext
      }),
      meta
    };
  }

  if (preferences.asksForExplanation && exactItemMatch) {
    const suggestedItems = [
      {
        itemId: exactItemMatch.itemId,
        name: exactItemMatch.name,
        category: exactItemMatch.category || "menu",
        price: exactItemMatch.price,
        description: exactItemMatch.description,
        reason: "directly matches the item you asked about"
      }
    ];

    return {
      answer: buildExplanationAnswer(hotelName, exactItemMatch, serviceContext, assistantTone),
      suggestions: suggestedItems,
      suggestedActions: buildActionSuggestions(suggestedItems),
      followUpPrompts: buildFollowUpPrompts({
        hotelName,
        suggestions: suggestedItems,
        preferences,
        meta: {
          mode: "explain_item",
          groundedItemCount: suggestedItems.length
        },
        serviceContext
      }),
      meta: {
        mode: "explain_item",
        groundedItemCount: suggestedItems.length
      }
    };
  }

  if (exactItemMatch && !preferences.wantsRecommendation && !preferences.wantsCombo) {
    const suggestedItems = [
      {
        itemId: exactItemMatch.itemId,
        name: exactItemMatch.name,
        category: exactItemMatch.category || "menu",
        price: exactItemMatch.price,
        description: exactItemMatch.description,
        reason: "directly matches the item you mentioned"
      }
    ];

    return {
      answer: buildExplanationAnswer(hotelName, exactItemMatch, serviceContext, assistantTone),
      suggestions: suggestedItems,
      suggestedActions: buildActionSuggestions(suggestedItems),
      followUpPrompts: buildFollowUpPrompts({
        hotelName,
        suggestions: suggestedItems,
        preferences,
        meta: {
          mode: "item_lookup",
          groundedItemCount: suggestedItems.length
        },
        serviceContext
      }),
      meta: {
        mode: "item_lookup",
        groundedItemCount: suggestedItems.length
      }
    };
  }

  if (preferences.wantsCombo || (preferences.peopleCount !== null && preferences.peopleCount >= 2)) {
    const rankedItems = rankMenuItems(normalizedMenuItems, preferences, message);
    const combo = buildComboSuggestion(rankedItems, preferences);
    const comboItems = combo.items.map((item) => ({
      ...item,
      reason: buildComboReason(
        {
          ...item,
          categoryBucket: getCategoryBucket(item.category),
          isNonVeg: hasAnyToken(
            `${item.name} ${item.description} ${item.category}`.toLowerCase(),
            NON_VEG_TERMS
          ),
          isSpicy: hasAnyToken(
            `${item.name} ${item.description} ${item.category}`.toLowerCase(),
            SPICY_TERMS
          )
        },
        combo.total,
        preferences
      )
    }));

    const meta = {
      mode: "combo_recommendation",
      groundedItemCount: comboItems.length,
      detectedBudget: preferences.budget,
      detectedPeopleCount: preferences.peopleCount,
      detectedCategory: preferences.categoryHint || "",
      detectedSpicePreference: preferences.spicePreference || "",
      comboEstimatedTotal: combo.total || 0
    };

      return {
        answer:
          comboItems.length > 0
            ? buildComboAnswer(
                hotelName,
                { ...combo, items: comboItems },
                preferences,
                serviceContext,
                assistantTone
              )
            : buildFallbackAnswer(
                hotelName,
                normalizedMenuItems,
                preferences,
                serviceContext,
                assistantTone
              ),
      suggestions: comboItems,
      suggestedActions: buildActionSuggestions(comboItems),
      followUpPrompts: buildFollowUpPrompts({
        hotelName,
        suggestions: comboItems,
        preferences,
        meta,
        serviceContext
      }),
      meta
    };
  }

  const suggestedItems = pickSuggestedItems(
    normalizedMenuItems,
    preferences,
    message
  );

  const meta = {
    mode: preferences.wantsCombo ? "combo_recommendation" : "menu_recommendation",
    groundedItemCount: suggestedItems.length,
    detectedBudget: preferences.budget,
    detectedPeopleCount: preferences.peopleCount,
    detectedCategory: preferences.categoryHint || "",
    detectedSpicePreference: preferences.spicePreference || ""
  };

  return {
    answer: suggestedItems.length
      ? buildRecommendationAnswer(
          hotelName,
          suggestedItems,
          preferences,
          serviceContext,
          assistantTone
        )
      : buildFallbackAnswer(
          hotelName,
          normalizedMenuItems,
          preferences,
          serviceContext,
          assistantTone
        ),
    suggestions: suggestedItems,
    suggestedActions: buildActionSuggestions(suggestedItems),
    followUpPrompts: buildFollowUpPrompts({
      hotelName,
      suggestions: suggestedItems,
      preferences,
      meta,
      serviceContext
    }),
    meta
  };
}

module.exports = {
  buildGroundedMenuAssistantReply
};
