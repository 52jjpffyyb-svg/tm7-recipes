import fs from "node:fs";
import process from "node:process";
import { CookidooClient, step, tts } from "@recode-software/cookidoo-api";

const file = process.argv[2];
if (!file) {
  throw new Error("Usage: node scripts/push-cookidoo.mjs <recipe.json>");
}

const email = process.env.COOKIDOO_EMAIL;
const password = process.env.COOKIDOO_PASSWORD;

if (!email || !password) {
  throw new Error(
    "Missing COOKIDOO_EMAIL or COOKIDOO_PASSWORD GitHub Actions secret."
  );
}

const recipe = JSON.parse(fs.readFileSync(file, "utf8"));

for (const key of ["name", "ingredients", "steps"]) {
  if (!recipe[key]) throw new Error(`Recipe is missing required field: ${key}`);
}

const client = new CookidooClient({
  email,
  password,
  country: "gb",
  language: "en-GB",
  baseUrl: "https://cookidoo.co.uk"
});

let recipeId = recipe.recipeId;

if (!recipeId) {
  const created = await client.recipes.create(recipe.name);
  recipeId = created.recipeId;
  console.log(`Created blank Cookidoo recipe: ${recipeId}`);
} else {
  console.log(`Updating existing Cookidoo recipe: ${recipeId}`);
}

const meta = {
  name: recipe.name,
  ingredients: recipe.ingredients.map((text) => ({
    type: "INGREDIENT",
    text
  })),
  ...(Number.isFinite(recipe.prepTime) ? { prepTime: recipe.prepTime } : {}),
  ...(Number.isFinite(recipe.totalTime) ? { totalTime: recipe.totalTime } : {})
};

if (recipe.yield?.value) {
  meta.yield = {
    value: recipe.yield.value,
    unitText: recipe.yield.unitText || "portion"
  };
}

await client.recipes.patchMeta(recipeId, meta);

const instructions = recipe.steps.map((item, index) => {
  if (typeof item === "string") return step(item, []);

  const text = item.text;
  if (!text) throw new Error(`Step ${index + 1} has no text.`);

  const annotations = (item.actions ?? []).map((action, actionIndex) => {
    const match = action.match;
    const offset = text.indexOf(match);

    if (!match || offset < 0) {
      throw new Error(
        `Step ${index + 1}, action ${actionIndex + 1}: match text was not found in step text.`
      );
    }

    const data = {
      offset,
      length: match.length,
      time: action.time,
      speed: String(action.speed)
    };

    if (action.temperature !== undefined && action.temperature !== null) {
      data.temperature = action.temperature;
    }
    if (action.direction === "CCW") {
      data.direction = "CCW";
    }

    return tts(data);
  });

  return step(text, annotations);
});

await client.recipes.patchInstructions(recipeId, instructions);

console.log(`Cookidoo recipe saved: ${recipe.name}`);
console.log(`Cookidoo recipe ID: ${recipeId}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## Cookidoo recipe saved ✅\n\n**${recipe.name}**\n\nRecipe ID: \`${recipeId}\`\n\nOpen **Created Recipes** in Cookidoo to view it.\n`
  );
}
