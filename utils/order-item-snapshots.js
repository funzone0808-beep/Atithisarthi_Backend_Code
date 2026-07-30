const {
  fetchMenuComboPresentationMap,
  isMissingMenuComboSchemaError
} = require("./menu-combos");

async function buildOrderItemSnapshots({
  hotelSlug,
  requestedItems = [],
  menuItemRows = []
}) {
  const normalizedRequestedItems = Array.isArray(requestedItems) ? requestedItems : [];
  const normalizedMenuItemRows = Array.isArray(menuItemRows) ? menuItemRows : [];
  let comboPresentationMap = new Map();

  try {
    comboPresentationMap = await fetchMenuComboPresentationMap({
      hotelSlug,
      menuItems: normalizedMenuItemRows
    });
  } catch (error) {
    if (!isMissingMenuComboSchemaError(error)) {
      throw error;
    }
  }

  const menuItemsById = new Map(
    normalizedMenuItemRows.map((menuItem) => [String(menuItem.item_id || ""), menuItem])
  );

  return normalizedRequestedItems.map((requestedItem) => {
    const itemId = String(requestedItem?.id || "").trim();
    const menuItem = menuItemsById.get(itemId) || {};
    const qty = Number(requestedItem?.qty || 0);
    const price = Number(menuItem.price || 0);
    const comboPresentation = comboPresentationMap.get(itemId) || null;

    return {
      id: itemId,
      name: menuItem.name || itemId,
      qty,
      price,
      lineTotal: price * qty,
      note: String(requestedItem?.note || "").trim().slice(0, 500),
      itemType: comboPresentation?.itemType || menuItem.item_type || "single",
      comboItems: comboPresentation?.comboItems || [],
      originalPrice: Number(comboPresentation?.originalPrice || 0),
      savings: Number(comboPresentation?.savings || 0)
    };
  });
}

function buildComboSummaryLine(item = {}) {
  if (String(item?.itemType || "single").trim() !== "combo") {
    return "";
  }

  const comboItems = Array.isArray(item?.comboItems) ? item.comboItems : [];
  const comboSummary = comboItems
    .map((comboItem) => {
      const quantity = Number(comboItem?.quantity || 1);
      const comboItemName = String(comboItem?.name || comboItem?.itemId || "").trim();
      return comboItemName ? `${quantity}x ${comboItemName}` : "";
    })
    .filter(Boolean)
    .join(" + ");

  return comboSummary ? `  Includes: ${comboSummary}` : "";
}

module.exports = {
  buildOrderItemSnapshots,
  buildComboSummaryLine
};
