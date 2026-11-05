import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const collection = require("@iconify-json/gravity-ui/icons.json");
const names = {
  grid: "layout-cells-large", receipt: "receipt", repeat: "arrows-rotate-right", calendar: "calendar",
  settings: "sliders", plus: "plus", arrow: "arrow-right", download: "arrow-down-to-line",
  upload: "arrow-up-from-line", trash: "trash-bin", edit: "pencil", check: "check", close: "xmark",
  chevron: "chevron-down", wallet: "wallet", trend: "chart-line", coffee: "mug", target: "target",
  spark: "sparkles", menu: "bars", income: "arrow-down-left", expense: "arrow-up-right",
  dots: "ellipsis", clock: "clock", sun: "sun", moon: "moon", monitor: "display", leaf: "circle-tree",
  food: "shopping-basket", drink: "cup", transport: "car", study: "book-open", entertainment: "ticket",
  shopping: "shopping-bag", health: "heart-pulse", home: "house", work: "briefcase", other: "square-dashed",
  shield: "shield-check", info: "circle-info", search: "magnifier", tag: "tag", lock: "lock",
};
const icons = Object.fromEntries(Object.entries(names).map(([name, key]) => {
  if (!collection.icons[key]) throw new Error(`Unknown Gravity icon: ${key}`);
  return [name, { ...collection.icons[key], width: collection.width, height: collection.height }];
}));
// Bundle only the icons we use. Runtime icon downloads would violate the app's self-only CSP.
writeFileSync(new URL("../lib/gravity-icons.json", import.meta.url), JSON.stringify(icons, null, 2) + "\n");
