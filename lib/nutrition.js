'use strict';

const { fetchJson } = require('./util');

/* ------------------------------------------------------------------ */
/* Built-in ingredient nutrition dataset (values per 100 g, approx.)   */
/* Source: USDA FoodData Central reference values, rounded.            */
/* This dataset makes nutrition calculation deterministic and offline. */
/* ------------------------------------------------------------------ */

const FOODS = [
  { name: 'chicken breast', aliases: ['chicken breast', 'grilled chicken breast', 'skinless chicken breast'], kcal: 165, protein: 31, carbs: 0, fat: 3.6, satfat: 1.0, fiber: 0, sugar: 0, sodium: 74, piece: 170 },
  { name: 'chicken thigh', aliases: ['chicken thigh', 'chicken thighs'], kcal: 209, protein: 26, carbs: 0, fat: 10.9, satfat: 3.0, fiber: 0, sugar: 0, sodium: 88, piece: 110 },
  { name: 'ground chicken', aliases: ['ground chicken', 'minced chicken'], kcal: 189, protein: 23, carbs: 0, fat: 10.9, satfat: 3.0, fiber: 0, sugar: 0, sodium: 75 },
  { name: 'turkey breast', aliases: ['turkey breast', 'turkey'], kcal: 135, protein: 30, carbs: 0, fat: 1.0, satfat: 0.3, fiber: 0, sugar: 0, sodium: 63, piece: 150 },
  { name: 'ground turkey', aliases: ['ground turkey', 'minced turkey'], kcal: 170, protein: 22, carbs: 0, fat: 8.0, satfat: 2.2, fiber: 0, sugar: 0, sodium: 70 },
  { name: 'lean ground beef', aliases: ['lean ground beef', 'ground beef', 'beef mince', 'minced beef'], kcal: 217, protein: 26, carbs: 0, fat: 11.8, satfat: 4.5, fiber: 0, sugar: 0, sodium: 75 },
  { name: 'beef steak', aliases: ['beef steak', 'sirloin steak', 'steak'], kcal: 250, protein: 26, carbs: 0, fat: 15, satfat: 6.0, fiber: 0, sugar: 0, sodium: 60 },
  { name: 'salmon', aliases: ['salmon', 'salmon fillet'], kcal: 208, protein: 20, carbs: 0, fat: 13, satfat: 3.1, fiber: 0, sugar: 0, sodium: 59, piece: 150 },
  { name: 'tuna', aliases: ['canned tuna', 'tuna', 'tuna canned in water'], kcal: 116, protein: 26, carbs: 0, fat: 0.8, satfat: 0.2, fiber: 0, sugar: 0, sodium: 247, piece: 140 },
  { name: 'cod', aliases: ['cod', 'cod fillet', 'white fish'], kcal: 82, protein: 18, carbs: 0, fat: 0.7, satfat: 0.1, fiber: 0, sugar: 0, sodium: 54 },
  { name: 'shrimp', aliases: ['shrimp', 'prawns', 'prawn'], kcal: 99, protein: 24, carbs: 0.2, fat: 0.3, satfat: 0.1, fiber: 0, sugar: 0, sodium: 111, piece: 8 },
  { name: 'sardines', aliases: ['sardines', 'sardine'], kcal: 208, protein: 25, carbs: 0, fat: 11, satfat: 1.5, fiber: 0, sugar: 0, sodium: 505, piece: 12 },
  { name: 'egg', aliases: ['egg', 'eggs', 'whole egg', 'large egg'], kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5, satfat: 3.1, fiber: 0, sugar: 0.4, sodium: 142, piece: 50 },
  { name: 'egg white', aliases: ['egg white', 'egg whites'], kcal: 52, protein: 10.9, carbs: 0.7, fat: 0.2, satfat: 0, fiber: 0, sugar: 0.7, sodium: 166, piece: 33 },
  { name: 'tofu', aliases: ['firm tofu', 'tofu', 'bean curd'], kcal: 144, protein: 17.3, carbs: 2.8, fat: 8.7, satfat: 1.3, fiber: 2.3, sugar: 0.6, sodium: 14 },
  { name: 'tempeh', aliases: ['tempeh'], kcal: 192, protein: 20.3, carbs: 7.6, fat: 10.8, satfat: 2.2, fiber: 5.4, sugar: 0, sodium: 9 },
  { name: 'paneer', aliases: ['paneer', 'indian cottage cheese'], kcal: 296, protein: 18.3, carbs: 3.4, fat: 22.8, satfat: 14, fiber: 0, sugar: 0, sodium: 20 },
  { name: 'cottage cheese', aliases: ['cottage cheese'], kcal: 98, protein: 11.1, carbs: 3.4, fat: 4.3, satfat: 1.7, fiber: 0, sugar: 2.7, sodium: 364 },
  { name: 'greek yogurt', aliases: ['greek yogurt', 'greek yoghurt', 'plain greek yogurt'], kcal: 59, protein: 10.3, carbs: 3.6, fat: 0.4, satfat: 0.1, fiber: 0, sugar: 3.2, sodium: 36, cup: 245 },
  { name: 'yogurt', aliases: ['yogurt', 'yoghurt', 'curd'], kcal: 61, protein: 3.5, carbs: 4.7, fat: 3.3, satfat: 2.1, fiber: 0, sugar: 4.7, sodium: 46, cup: 245 },
  { name: 'milk', aliases: ['whole milk', 'milk', 'skim milk', 'low fat milk'], kcal: 61, protein: 3.2, carbs: 4.8, fat: 3.3, satfat: 1.9, fiber: 0, sugar: 5.1, sodium: 43, cup: 244 },
  { name: 'almond milk', aliases: ['almond milk', 'unsweetened almond milk'], kcal: 15, protein: 0.6, carbs: 0.6, fat: 1.2, satfat: 0.1, fiber: 0.3, sugar: 0.3, sodium: 72, cup: 240 },
  { name: 'soy milk', aliases: ['soy milk', 'soymilk'], kcal: 54, protein: 3.3, carbs: 6.3, fat: 1.8, satfat: 0.2, fiber: 0.6, sugar: 3.9, sodium: 47, cup: 240 },
  { name: 'whey protein', aliases: ['whey protein', 'protein powder', 'whey isolate', 'whey'], kcal: 400, protein: 80, carbs: 8, fat: 6, satfat: 2, fiber: 0, sugar: 4, sodium: 300, scoop: 30 },
  { name: 'lentils', aliases: ['red lentils', 'green lentils', 'lentils', 'lentil'], kcal: 116, protein: 9, carbs: 20, fat: 0.4, satfat: 0.1, fiber: 7.9, sugar: 1.8, sodium: 2, cup: 198, cooked: true },
  { name: 'chickpeas', aliases: ['chickpeas', 'garbanzo beans', 'chickpea'], kcal: 164, protein: 8.9, carbs: 27.4, fat: 2.6, satfat: 0.3, fiber: 7.6, sugar: 4.8, sodium: 7, cup: 164, cooked: true },
  { name: 'black beans', aliases: ['black beans', 'black bean'], kcal: 132, protein: 8.9, carbs: 23.7, fat: 0.5, satfat: 0.1, fiber: 8.7, sugar: 0.3, sodium: 1, cup: 172, cooked: true },
  { name: 'kidney beans', aliases: ['kidney beans', 'red beans'], kcal: 127, protein: 8.7, carbs: 22.8, fat: 0.5, satfat: 0.1, fiber: 6.4, sugar: 0.3, sodium: 1, cup: 177, cooked: true },
  { name: 'edamame', aliases: ['edamame', 'soybeans'], kcal: 121, protein: 11.9, carbs: 8.9, fat: 5.2, satfat: 0.6, fiber: 5.2, sugar: 2.2, sodium: 6, cup: 155 },
  { name: 'quinoa', aliases: ['quinoa'], kcal: 120, protein: 4.4, carbs: 21.3, fat: 1.9, satfat: 0.2, fiber: 2.8, sugar: 0.9, sodium: 7, cup: 185, cooked: true },
  { name: 'brown rice', aliases: ['brown rice'], kcal: 123, protein: 2.7, carbs: 25.6, fat: 1.0, satfat: 0.2, fiber: 1.8, sugar: 0.4, sodium: 4, cup: 195, cooked: true },
  { name: 'white rice', aliases: ['white rice', 'jasmine rice'], kcal: 130, protein: 2.7, carbs: 28.2, fat: 0.3, satfat: 0.1, fiber: 0.4, sugar: 0.1, sodium: 1, cup: 158, cooked: true },
  { name: 'basmati rice', aliases: ['basmati rice'], kcal: 121, protein: 3.5, carbs: 25.2, fat: 0.4, satfat: 0.1, fiber: 0.4, sugar: 0.1, sodium: 1, cup: 163, cooked: true },
  { name: 'oats', aliases: ['rolled oats', 'oats', 'oatmeal'], kcal: 389, protein: 16.9, carbs: 66.3, fat: 6.9, satfat: 1.2, fiber: 10.6, sugar: 1.0, sodium: 2, cup: 90 },
  { name: 'bread', aliases: ['whole wheat bread', 'whole grain bread', 'bread', 'toast'], kcal: 247, protein: 13, carbs: 41, fat: 3.4, satfat: 0.7, fiber: 7, sugar: 6, sodium: 400, slice: 32 },
  { name: 'tortilla', aliases: ['whole wheat tortilla', 'tortilla', 'wrap'], kcal: 310, protein: 8, carbs: 51, fat: 8, satfat: 2, fiber: 5, sugar: 3, sodium: 500, piece: 45 },
  { name: 'pasta', aliases: ['whole wheat pasta', 'pasta', 'spaghetti', 'penne', 'macaroni'], kcal: 131, protein: 5, carbs: 25, fat: 1.1, satfat: 0.2, fiber: 3.2, sugar: 0.6, sodium: 6, cup: 140, cooked: true },
  { name: 'chickpea pasta', aliases: ['chickpea pasta', 'lentil pasta'], kcal: 140, protein: 9, carbs: 20, fat: 2.5, satfat: 0.3, fiber: 5, sugar: 1, sodium: 10, cup: 140, cooked: true },
  { name: 'sweet potato', aliases: ['sweet potato', 'sweet potatoes'], kcal: 86, protein: 1.6, carbs: 20.1, fat: 0.1, satfat: 0, fiber: 3, sugar: 4.2, sodium: 55, piece: 130, cup: 200 },
  { name: 'potato', aliases: ['potato', 'potatoes', 'baby potatoes'], kcal: 77, protein: 2, carbs: 17, fat: 0.1, satfat: 0, fiber: 2.2, sugar: 0.8, sodium: 6, piece: 150, cup: 150 },
  { name: 'broccoli', aliases: ['broccoli'], kcal: 34, protein: 2.8, carbs: 6.6, fat: 0.4, satfat: 0, fiber: 2.6, sugar: 1.7, sodium: 33, cup: 91 },
  { name: 'spinach', aliases: ['baby spinach', 'spinach'], kcal: 23, protein: 2.9, carbs: 3.6, fat: 0.4, satfat: 0.1, fiber: 2.2, sugar: 0.4, sodium: 79, cup: 30 },
  { name: 'kale', aliases: ['kale'], kcal: 49, protein: 4.3, carbs: 8.8, fat: 0.9, satfat: 0.1, fiber: 3.6, sugar: 2.3, sodium: 38, cup: 21 },
  { name: 'bell pepper', aliases: ['bell pepper', 'bell peppers', 'red pepper', 'capsicum'], kcal: 31, protein: 1, carbs: 6, fat: 0.3, satfat: 0, fiber: 2.1, sugar: 4.2, sodium: 4, piece: 119, cup: 149 },
  { name: 'tomato', aliases: ['cherry tomatoes', 'tomato', 'tomatoes'], kcal: 18, protein: 0.9, carbs: 3.9, fat: 0.2, satfat: 0, fiber: 1.2, sugar: 2.6, sodium: 5, piece: 123, cup: 180 },
  { name: 'cucumber', aliases: ['cucumber'], kcal: 15, protein: 0.7, carbs: 3.6, fat: 0.1, satfat: 0, fiber: 0.5, sugar: 1.7, sodium: 2, piece: 200, cup: 120 },
  { name: 'zucchini', aliases: ['zucchini', 'courgette'], kcal: 17, protein: 1.2, carbs: 3.1, fat: 0.3, satfat: 0.1, fiber: 1, sugar: 2.5, sodium: 8, piece: 180, cup: 120 },
  { name: 'cauliflower', aliases: ['cauliflower'], kcal: 25, protein: 1.9, carbs: 5, fat: 0.3, satfat: 0.1, fiber: 2, sugar: 1.9, sodium: 30, cup: 107 },
  { name: 'carrot', aliases: ['carrot', 'carrots'], kcal: 41, protein: 0.9, carbs: 9.6, fat: 0.2, satfat: 0, fiber: 2.8, sugar: 4.7, sodium: 69, piece: 61, cup: 128 },
  { name: 'onion', aliases: ['red onion', 'onion', 'onions'], kcal: 40, protein: 1.1, carbs: 9.3, fat: 0.1, satfat: 0, fiber: 1.7, sugar: 4.2, sodium: 4, piece: 110, cup: 160 },
  { name: 'garlic', aliases: ['garlic', 'garlic cloves'], kcal: 149, protein: 6.4, carbs: 33, fat: 0.5, satfat: 0.1, fiber: 2.1, sugar: 1, sodium: 17, clove: 3 },
  { name: 'mushrooms', aliases: ['mushrooms', 'mushroom', 'cremini mushrooms'], kcal: 22, protein: 3.1, carbs: 3.3, fat: 0.3, satfat: 0, fiber: 1, sugar: 2, sodium: 5, cup: 70 },
  { name: 'avocado', aliases: ['avocado', 'avocados'], kcal: 160, protein: 2, carbs: 8.5, fat: 14.7, satfat: 2.1, fiber: 6.7, sugar: 0.7, sodium: 7, piece: 150 },
  { name: 'olive oil', aliases: ['extra virgin olive oil', 'olive oil'], kcal: 884, protein: 0, carbs: 0, fat: 100, satfat: 13.8, fiber: 0, sugar: 0, sodium: 2, tbsp: 13.5, tsp: 4.5, cup: 216 },
  { name: 'coconut oil', aliases: ['coconut oil'], kcal: 892, protein: 0, carbs: 0, fat: 99, satfat: 82, fiber: 0, sugar: 0, sodium: 0, tbsp: 13.5, tsp: 4.5 },
  { name: 'butter', aliases: ['unsalted butter', 'butter'], kcal: 717, protein: 0.9, carbs: 0.1, fat: 81, satfat: 51, fiber: 0, sugar: 0.1, sodium: 11, tbsp: 14 },
  { name: 'peanut butter', aliases: ['peanut butter', 'natural peanut butter'], kcal: 588, protein: 25, carbs: 20, fat: 50, satfat: 10, fiber: 6, sugar: 9, sodium: 17, tbsp: 16 },
  { name: 'almond butter', aliases: ['almond butter'], kcal: 614, protein: 21, carbs: 19, fat: 56, satfat: 4.7, fiber: 10, sugar: 4.4, sodium: 7, tbsp: 16 },
  { name: 'almonds', aliases: ['almonds', 'almond'], kcal: 579, protein: 21.2, carbs: 21.6, fat: 49.9, satfat: 3.8, fiber: 12.5, sugar: 4.4, sodium: 1, piece: 1.2, cup: 143 },
  { name: 'walnuts', aliases: ['walnuts', 'walnut'], kcal: 654, protein: 15.2, carbs: 13.7, fat: 65.2, satfat: 6.1, fiber: 6.7, sugar: 2.6, sodium: 2, piece: 2.5, cup: 117 },
  { name: 'chia seeds', aliases: ['chia seeds', 'chia'], kcal: 486, protein: 16.5, carbs: 42.1, fat: 30.7, satfat: 3.3, fiber: 34.4, sugar: 0, sodium: 16, tbsp: 12 },
  { name: 'flaxseed', aliases: ['flaxseed', 'ground flaxseed', 'flax'], kcal: 534, protein: 18.3, carbs: 28.9, fat: 42.2, satfat: 3.7, fiber: 27.3, sugar: 1.5, sodium: 30, tbsp: 10 },
  { name: 'hemp seeds', aliases: ['hemp seeds', 'hemp hearts'], kcal: 553, protein: 31.6, carbs: 8.7, fat: 48.8, satfat: 4.6, fiber: 4, sugar: 1.5, sodium: 5, tbsp: 10 },
  { name: 'pumpkin seeds', aliases: ['pumpkin seeds', 'pepitas'], kcal: 559, protein: 30.2, carbs: 10.7, fat: 49, satfat: 8.7, fiber: 6, sugar: 1.4, sodium: 7, tbsp: 10 },
  { name: 'soy sauce', aliases: ['soy sauce', 'tamari'], kcal: 53, protein: 8.1, carbs: 4.9, fat: 0.6, satfat: 0.1, fiber: 0.8, sugar: 0.4, sodium: 5493, tbsp: 16 },
  { name: 'honey', aliases: ['honey'], kcal: 304, protein: 0.3, carbs: 82.4, fat: 0, satfat: 0, fiber: 0.2, sugar: 82.1, sodium: 4, tbsp: 21, tsp: 7 },
  { name: 'maple syrup', aliases: ['maple syrup'], kcal: 260, protein: 0, carbs: 67, fat: 0.1, satfat: 0, fiber: 0, sugar: 60, sodium: 12, tbsp: 20 },
  { name: 'banana', aliases: ['banana', 'bananas'], kcal: 89, protein: 1.1, carbs: 22.8, fat: 0.3, satfat: 0.1, fiber: 2.6, sugar: 12.2, sodium: 1, piece: 118, cup: 150 },
  { name: 'blueberries', aliases: ['blueberries', 'blueberry'], kcal: 57, protein: 0.7, carbs: 14.5, fat: 0.3, satfat: 0, fiber: 2.4, sugar: 10, sodium: 1, cup: 148 },
  { name: 'strawberries', aliases: ['strawberries', 'strawberry'], kcal: 32, protein: 0.7, carbs: 7.7, fat: 0.3, satfat: 0, fiber: 2, sugar: 4.9, sodium: 1, cup: 152 },
  { name: 'mixed berries', aliases: ['mixed berries', 'frozen berries', 'berries'], kcal: 50, protein: 0.8, carbs: 12, fat: 0.3, satfat: 0, fiber: 3, sugar: 8, sodium: 1, cup: 150 },
  { name: 'apple', aliases: ['apple', 'apples'], kcal: 52, protein: 0.3, carbs: 13.8, fat: 0.2, satfat: 0, fiber: 2.4, sugar: 10.4, sodium: 1, piece: 182, cup: 125 },
  { name: 'orange', aliases: ['orange', 'oranges'], kcal: 47, protein: 0.9, carbs: 11.8, fat: 0.1, satfat: 0, fiber: 2.4, sugar: 9.4, sodium: 0, piece: 131 },
  { name: 'lemon juice', aliases: ['lemon juice', 'lime juice', 'lemon', 'lime'], kcal: 22, protein: 0.4, carbs: 6.9, fat: 0.2, satfat: 0, fiber: 0.3, sugar: 2.5, sodium: 1, piece: 44, tbsp: 15 },
  { name: 'cheddar cheese', aliases: ['cheddar cheese', 'cheddar'], kcal: 403, protein: 24.9, carbs: 1.3, fat: 33.1, satfat: 18.9, fiber: 0, sugar: 0.5, sodium: 621, cup: 113, slice: 28 },
  { name: 'mozzarella', aliases: ['mozzarella', 'mozzarella cheese'], kcal: 280, protein: 28, carbs: 3.1, fat: 17, satfat: 10, fiber: 0, sugar: 1.2, sodium: 627, cup: 112 },
  { name: 'feta cheese', aliases: ['feta cheese', 'feta'], kcal: 264, protein: 14.2, carbs: 4.1, fat: 21.3, satfat: 14.9, fiber: 0, sugar: 4.1, sodium: 917, cup: 150 },
  { name: 'parmesan', aliases: ['parmesan cheese', 'parmesan'], kcal: 431, protein: 38, carbs: 4.1, fat: 29, satfat: 19, fiber: 0, sugar: 0.9, sodium: 1529, tbsp: 5 },
  { name: 'cream cheese', aliases: ['cream cheese'], kcal: 342, protein: 6.2, carbs: 4.1, fat: 34, satfat: 19, fiber: 0, sugar: 3.8, sodium: 321, tbsp: 15 },
  { name: 'hummus', aliases: ['hummus'], kcal: 166, protein: 7.9, carbs: 14.3, fat: 9.6, satfat: 1.4, fiber: 6, sugar: 0.3, sodium: 379, tbsp: 15 },
  { name: 'tahini', aliases: ['tahini', 'sesame paste'], kcal: 595, protein: 17, carbs: 21, fat: 54, satfat: 7.5, fiber: 9.3, sugar: 0.5, sodium: 115, tbsp: 15 },
  { name: 'salsa', aliases: ['salsa', 'pico de gallo'], kcal: 36, protein: 1.5, carbs: 7, fat: 0.2, satfat: 0, fiber: 1.5, sugar: 4, sodium: 430, tbsp: 16 },
  { name: 'tomato sauce', aliases: ['tomato sauce', 'passata', 'marinara sauce', 'pasta sauce'], kcal: 29, protein: 1.6, carbs: 5.3, fat: 0.3, satfat: 0, fiber: 1.5, sugar: 3.5, sodium: 300, cup: 245 },
  { name: 'tomato paste', aliases: ['tomato paste'], kcal: 82, protein: 4.3, carbs: 18.9, fat: 0.5, satfat: 0.1, fiber: 4.1, sugar: 12.2, sodium: 59, tbsp: 16 },
  { name: 'coconut milk', aliases: ['light coconut milk', 'coconut milk'], kcal: 230, protein: 2.3, carbs: 5.5, fat: 23.8, satfat: 21.1, fiber: 2.2, sugar: 3.3, sodium: 15, cup: 240 },
  { name: 'flour', aliases: ['all purpose flour', 'whole wheat flour', 'flour'], kcal: 364, protein: 10.3, carbs: 76.3, fat: 1, satfat: 0.2, fiber: 2.7, sugar: 0.3, sodium: 2, cup: 125, tbsp: 8 },
  { name: 'cornstarch', aliases: ['cornstarch', 'corn flour'], kcal: 381, protein: 0.3, carbs: 91.3, fat: 0.1, satfat: 0, fiber: 0.9, sugar: 0, sodium: 9, tbsp: 8 },
  { name: 'baking powder', aliases: ['baking powder'], kcal: 53, protein: 0, carbs: 27.7, fat: 0, satfat: 0, fiber: 0, sugar: 0, sodium: 10600, tsp: 4 },
  { name: 'cocoa powder', aliases: ['cocoa powder', 'cacao powder'], kcal: 228, protein: 19.6, carbs: 57.9, fat: 13.7, satfat: 8.1, fiber: 33.2, sugar: 1.8, sodium: 21, tbsp: 5 },
  { name: 'dark chocolate', aliases: ['dark chocolate', 'chocolate chips', 'dark chocolate chips'], kcal: 598, protein: 7.8, carbs: 45.9, fat: 42.6, satfat: 24.5, fiber: 10.9, sugar: 24, sodium: 20, tbsp: 10 },
  { name: 'nutritional yeast', aliases: ['nutritional yeast'], kcal: 385, protein: 50, carbs: 36, fat: 5, satfat: 0.5, fiber: 20, sugar: 0, sodium: 30, tbsp: 5 },
  { name: 'salt', aliases: ['sea salt', 'kosher salt', 'salt'], kcal: 0, protein: 0, carbs: 0, fat: 0, satfat: 0, fiber: 0, sugar: 0, sodium: 38758, tsp: 6 },
  { name: 'black pepper', aliases: ['black pepper', 'pepper'], kcal: 251, protein: 10.4, carbs: 64, fat: 3.3, satfat: 1.4, fiber: 25, sugar: 0.6, sodium: 20, tsp: 2.3 },
  { name: 'cinnamon', aliases: ['cinnamon'], kcal: 247, protein: 4, carbs: 80.6, fat: 1.2, satfat: 0.3, fiber: 53.1, sugar: 2.2, sodium: 10, tsp: 2.6 },
  { name: 'paprika', aliases: ['paprika', 'smoked paprika'], kcal: 282, protein: 14.1, carbs: 54, fat: 12.9, satfat: 2.1, fiber: 34.9, sugar: 10.3, sodium: 68, tsp: 2.3 },
  { name: 'cumin', aliases: ['cumin', 'ground cumin'], kcal: 375, protein: 17.8, carbs: 44.2, fat: 22.3, satfat: 1.5, fiber: 10.5, sugar: 2.3, sodium: 168, tsp: 2.1 },
  { name: 'oregano', aliases: ['oregano', 'dried oregano'], kcal: 265, protein: 9, carbs: 68.9, fat: 4.3, satfat: 1.6, fiber: 42.5, sugar: 4.1, sodium: 25, tsp: 1 },
  { name: 'basil', aliases: ['fresh basil', 'basil'], kcal: 23, protein: 3.2, carbs: 2.6, fat: 0.6, satfat: 0.1, fiber: 1.6, sugar: 0.3, sodium: 4, cup: 24 },
  { name: 'parsley', aliases: ['parsley', 'fresh parsley'], kcal: 36, protein: 3, carbs: 6.3, fat: 0.8, satfat: 0.1, fiber: 3.3, sugar: 0.9, sodium: 56, cup: 60 },
  { name: 'cilantro', aliases: ['cilantro', 'coriander leaves'], kcal: 23, protein: 2.1, carbs: 3.7, fat: 0.5, satfat: 0, fiber: 2.8, sugar: 0.9, sodium: 46, cup: 16 },
  { name: 'ginger', aliases: ['fresh ginger', 'ginger'], kcal: 80, protein: 1.8, carbs: 17.8, fat: 0.8, satfat: 0.2, fiber: 2, sugar: 1.7, sodium: 13, tsp: 2 },
  { name: 'chili flakes', aliases: ['red chili flakes', 'chili flakes', 'chilli flakes', 'cayenne pepper'], kcal: 318, protein: 12, carbs: 56.6, fat: 17.3, satfat: 3.3, fiber: 27.2, sugar: 10.3, sodium: 30, tsp: 1.8 },
  { name: 'sriracha', aliases: ['sriracha', 'hot sauce'], kcal: 93, protein: 1.9, carbs: 19.6, fat: 0.9, satfat: 0.1, fiber: 1.1, sugar: 14.3, sodium: 2124, tbsp: 17 },
  { name: 'mustard', aliases: ['dijon mustard', 'mustard'], kcal: 66, protein: 4.4, carbs: 5.8, fat: 3.4, satfat: 0.2, fiber: 4, sugar: 0.9, sodium: 1120, tbsp: 15 },
  { name: 'vinegar', aliases: ['balsamic vinegar', 'apple cider vinegar', 'rice vinegar', 'vinegar'], kcal: 21, protein: 0, carbs: 4.2, fat: 0, satfat: 0, fiber: 0, sugar: 4, sodium: 5, tbsp: 15 },
  { name: 'vegetable broth', aliases: ['vegetable broth', 'chicken broth', 'broth', 'stock'], kcal: 6, protein: 0.5, carbs: 0.9, fat: 0.1, satfat: 0, fiber: 0, sugar: 0.4, sodium: 300, cup: 240 },
  { name: 'water', aliases: ['water', 'ice water'], kcal: 0, protein: 0, carbs: 0, fat: 0, satfat: 0, fiber: 0, sugar: 0, sodium: 0, cup: 240 },
  { name: 'protein bar', aliases: ['protein bar'], kcal: 350, protein: 30, carbs: 35, fat: 12, satfat: 5, fiber: 8, sugar: 15, sodium: 250, piece: 60 },
  { name: 'rice cakes', aliases: ['rice cakes', 'rice cake'], kcal: 387, protein: 8, carbs: 82, fat: 2.8, satfat: 0.6, fiber: 4, sugar: 0.7, sodium: 30, piece: 9 },
  { name: 'popcorn', aliases: ['popcorn'], kcal: 387, protein: 12.9, carbs: 77.8, fat: 4.5, satfat: 0.6, fiber: 14.5, sugar: 0.6, sodium: 8, cup: 8 },
  { name: 'granola', aliases: ['granola'], kcal: 471, protein: 10, carbs: 64, fat: 20, satfat: 3, fiber: 7, sugar: 24, sodium: 26, cup: 100 },
  { name: 'protein pancake mix', aliases: ['protein pancake mix', 'pancake mix'], kcal: 360, protein: 25, carbs: 55, fat: 5, satfat: 1, fiber: 5, sugar: 8, sodium: 500, cup: 120 },
];

const UNIT_GRAMS = {
  g: 1, gram: 1, grams: 1, gr: 1,
  kg: 1000, kilogram: 1000, kilograms: 1000,
  mg: 0.001,
  oz: 28.35, ounce: 28.35, ounces: 28.35,
  lb: 453.6, lbs: 453.6, pound: 453.6, pounds: 453.6,
  ml: 1, milliliter: 1, millilitre: 1, milliliters: 1, millilitres: 1,
  l: 1000, liter: 1000, litre: 1000, liters: 1000, litres: 1000,
  cup: 240, cups: 240,
  tbsp: 15, tablespoon: 15, tablespoons: 15,
  tsp: 5, teaspoon: 5, teaspoons: 5,
  pinch: 0.6, dash: 0.9, handful: 30,
  clove: 3, cloves: 3,
  slice: 30, slices: 30,
  can: 400, cans: 400,
  scoop: 30, scoops: 30,
  packet: 10, sachet: 10,
  sprig: 2, sprigs: 2,
  stalk: 40, stalks: 40,
  piece: null, pieces: null, whole: null,
};

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

function parseQuantity(str) {
  const s = String(str).trim();
  if (!s) return null;
  if (/^\d+\s*\/\s*\d+$/.test(s)) { const [a, b] = s.split('/').map(Number); return b ? a / b : null; }
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^\d+\s+\d+\s*\/\s*\d+$/.test(s)) {
    const [whole, frac] = s.split(/\s+/); const [a, b] = frac.split('/').map(Number);
    return Number(whole) + (b ? a / b : 0);
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

const UNICODE_FRACTIONS = { '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8' };

function normalizeIngredientLine(line) {
  let s = String(line || '').trim().replace(/\u00a0/g, ' ');
  s = s.replace(/[½⅓⅔¼¾⅛⅜⅝⅞]/g, (m) => ` ${UNICODE_FRACTIONS[m]} `);
  s = s.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  return s;
}

function parseIngredient(line) {
  const original = String(line || '').trim();
  let s = normalizeIngredientLine(original);

  // Detect weight inside parentheses, e.g. "1 can (400 g) chickpeas"
  const paren = /\(\s*([\d.]+)\s*(g|grams?|kg|oz|ml|l)\s*\)/i.exec(s);
  let parenGrams = null;
  if (paren) {
    const n = Number(paren[1]);
    const u = paren[2].toLowerCase().replace(/s$/, '');
    const mult = u === 'kg' ? 1000 : u === 'l' ? 1000 : u === 'oz' ? 28.35 : 1;
    parenGrams = n * mult;
    s = s.replace(paren[0], ' ').trim();
  }

  // Quantity prefix: "1 1/2", "1/2", "2", "2-3", "2 to 3"
  const qtyMatch = /^(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?)(?:\s*(?:-|to)\s*(\d+(?:\.\d+)?))?\s*/i.exec(s);
  let qty = 1;
  if (qtyMatch) {
    qty = parseQuantity(qtyMatch[1]);
    if (qtyMatch[2]) qty = (qty + Number(qtyMatch[2])) / 2;
    s = s.slice(qtyMatch[0].length).trim();
  } else if (/^(a|an|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(s)) {
    const words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const m = /^(a|an|one|two|three|four|five|six|seven|eight|nine|ten)\b\s*/i.exec(s);
    qty = words[m[1].toLowerCase()] ?? 1;
    s = s.slice(m[0].length).trim();
  }

  // Unit
  let unit = null;
  const unitMatch = /^([a-zA-Z]+)\.?\s+/i.exec(s);
  if (unitMatch) {
    const candidate = unitMatch[1].toLowerCase();
    if (candidate in UNIT_GRAMS) {
      unit = candidate;
      s = s.slice(unitMatch[0].length).trim();
    }
  }
  // "200g" (no space)
  if (!unit) {
    const compact = /^(\d+(?:\.\d+)?)\s*(g|kg|ml|l|oz|lb)\b\s*/i.exec(s);
    if (compact) {
      qty = Number(compact[1]);
      unit = compact[2].toLowerCase();
      s = s.slice(compact[0].length).trim();
    }
  }

  let name = s.replace(/^of\s+/i, '').replace(/^,\s*/, '').trim();
  name = name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  name = name.replace(/,\s*(chopped|diced|minced|sliced|grated|shredded|optional|to taste|divided|fresh|frozen|cooked|drained|rinsed|halved|quartered|trimmed|peeled|beaten|softened|melted|room temperature).*$/i, '').trim();

  const vague = /^(salt|pepper|seasoning|spices?|herbs?)\s+to\s+taste$/i.test(original) || /^to taste$/i.test(original);
  const noQuantity = !qtyMatch && !unitMatch?.[0] && !parenGrams;

  return {
    original,
    name: name || original,
    qty: vague ? 0 : (Number.isFinite(qty) ? qty : 1),
    unit,
    explicitGrams: parenGrams,
    toTaste: vague,
    noQuantity: noQuantity && !vague,
  };
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

function scoreAlias(name, alias) {
  const n = ` ${String(name).toLowerCase()} `;
  const a = String(alias).toLowerCase();
  if (n.includes(` ${a} `)) return 100 + a.length;
  if (n.includes(a)) return 60 + a.length;
  const nt = new Set(n.split(/[^a-z0-9]+/).filter(Boolean));
  const at = a.split(/[^a-z0-9]+/).filter(Boolean);
  if (!at.length) return 0;
  const hits = at.filter((t) => nt.has(t)).length;
  if (hits === at.length) return 40 + a.length;
  if (hits >= Math.ceil(at.length * 0.75) && at.length > 1) return 20 + a.length;
  return 0;
}

function matchFood(name) {
  let best = null; let bestScore = 0;
  for (const food of FOODS) {
    const aliases = [food.name, ...(food.aliases || [])];
    for (const alias of aliases) {
      const score = scoreAlias(name, alias);
      if (score > bestScore) { bestScore = score; best = food; }
    }
  }
  return bestScore >= 40 ? { food: best, score: bestScore, matchedName: best.name } : null;
}

function gramsFor(parsed, food) {
  if (parsed.explicitGrams) return parsed.explicitGrams;
  if (parsed.toTaste) return 0;
  if (!parsed.unit) {
    // no unit: assume piece weight when known, else 100 g per unit
    return parsed.qty * (food?.piece || 100);
  }
  const u = parsed.unit;
  if (UNIT_GRAMS[u] != null) {
    if (u === 'cup' && food?.cup) return parsed.qty * food.cup;
    if (u === 'tbsp' && food?.tbsp) return parsed.qty * food.tbsp;
    if (u === 'tsp' && food?.tsp) return parsed.qty * food.tsp;
    if (u === 'clove' && food?.clove) return parsed.qty * food.clove;
    if (u === 'slice' && food?.slice) return parsed.qty * food.slice;
    if (u === 'piece' || u === 'pieces' || u === 'whole') return parsed.qty * (food?.piece || 100);
    if (u === 'cup' && !food?.cup) return parsed.qty * 240;
    return parsed.qty * UNIT_GRAMS[u];
  }
  return parsed.qty * (food?.piece || 100);
}

function emptyNutrients() {
  return { kcal: 0, protein: 0, carbs: 0, fat: 0, satfat: 0, fiber: 0, sugar: 0, sodium: 0 };
}

function addNutrients(target, per100, grams) {
  const factor = grams / 100;
  for (const k of Object.keys(target)) target[k] += (Number(per100[k]) || 0) * factor;
}

function roundNutrients(n) {
  return {
    calories: Math.round(n.kcal),
    protein: Math.round(n.protein * 10) / 10,
    carbs: Math.round(n.carbs * 10) / 10,
    fat: Math.round(n.fat * 10) / 10,
    satfat: Math.round(n.satfat * 10) / 10,
    fiber: Math.round(n.fiber * 10) / 10,
    sugar: Math.round(n.sugar * 10) / 10,
    sodium: Math.round(n.sodium),
  };
}

/* ------------------------------------------------------------------ */
/* USDA FoodData Central (optional)                                    */
/* ------------------------------------------------------------------ */

const usdaCache = new Map();

async function usdaLookup(name, apiKey) {
  const key = `usda:${String(name).toLowerCase()}`;
  if (usdaCache.has(key)) return usdaCache.get(key);
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}`;
  const body = {
    query: name,
    pageSize: 3,
    dataType: ['SR Legacy', 'Foundation'],
  };
  const data = await fetchJson(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeoutMs: 20_000,
  });
  const food = data?.foods?.[0];
  if (!food) { usdaCache.set(key, null); return null; }
  const nutrients = food.foodNutrients || [];
  const byId = (id) => {
    const n = nutrients.find((x) => Number(x.nutrientId) === id);
    return n ? Number(n.value) : 0;
  };
  const result = {
    name: food.description,
    kcal: byId(1008), protein: byId(1003), carbs: byId(1005), fat: byId(1004),
    satfat: byId(1258), fiber: byId(1079), sugar: byId(2000), sodium: byId(1093),
    piece: 0,
  };
  usdaCache.set(key, result);
  return result;
}

/* ------------------------------------------------------------------ */
/* Main calculation                                                    */
/* ------------------------------------------------------------------ */

/**
 * Deterministic nutrition calculation from real ingredient quantities.
 * @param {Array} ingredients [{item, quantity, unit, notes}] or strings
 * @param {number} servings
 * @param {object} opts {provider:'builtin'|'usda'|'gemini', usdaKey, mapWithAI}
 */
async function calculateNutrition(ingredients, servings = 1, opts = {}) {
  const list = Array.isArray(ingredients) ? ingredients : [];
  const servingsN = Math.max(1, Number(servings) || 1);
  const provider = opts.provider || 'builtin';
  const usdaKey = opts.usdaKey || '';

  const lines = list.map((ing) => {
    if (typeof ing === 'string') return ing;
    const q = ing.quantity ?? ing.qty ?? '';
    const u = ing.unit || '';
    const item = ing.item || ing.name || '';
    return `${q} ${u} ${item}`.replace(/\s+/g, ' ').trim();
  }).filter(Boolean);

  let mappings = null;
  if (provider === 'gemini' && typeof opts.mapWithAI === 'function' && lines.length) {
    try {
      const res = await opts.mapWithAI(lines);
      const arr = Array.isArray(res) ? res : res?.mappings;
      if (Array.isArray(arr)) mappings = arr;
    } catch { mappings = null; }
  }

  const rows = [];
  const totals = emptyNutrients();
  let unmatchedCount = 0;
  let matchedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parsed = parseIngredient(line);
    let lookupName = parsed.name;
    if (mappings) {
      const m = mappings.find((x) => String(x.input || '').toLowerCase() === line.toLowerCase())
        || mappings.find((x) => String(x.input || '').toLowerCase().includes(parsed.name.toLowerCase()));
      if (m?.food) lookupName = m.food;
    }

    let food = null; let source = 'builtin';
    if (provider === 'usda' && usdaKey) {
      try { food = await usdaLookup(lookupName, usdaKey); source = 'usda'; } catch { food = null; }
    }
    let match = food ? { food, matchedName: food.name } : matchFood(lookupName);
    if (!match && lookupName !== parsed.name) match = matchFood(parsed.name);
    if (!match && provider === 'usda' && usdaKey) {
      try { const f = await usdaLookup(parsed.name, usdaKey); if (f) { match = { food: f, matchedName: f.name }; source = 'usda'; } } catch { /* ignore */ }
    }
    if (!match) {
      unmatchedCount++;
      rows.push({ input: line, parsedName: parsed.name, matched: false, grams: 0, note: 'No nutrition match — excluded from totals.' });
      continue;
    }
    matchedCount++;
    const grams = gramsFor(parsed, match.food);
    const nutrients = {
      kcal: match.food.kcal, protein: match.food.protein, carbs: match.food.carbs, fat: match.food.fat,
      satfat: match.food.satfat, fiber: match.food.fiber, sugar: match.food.sugar, sodium: match.food.sodium,
    };
    addNutrients(totals, nutrients, grams);
    rows.push({
      input: line,
      matched: true,
      matchedName: match.matchedName,
      grams: Math.round(grams * 10) / 10,
      quantity: parsed.qty,
      unit: parsed.unit,
      source,
      nutrients: roundNutrients(Object.fromEntries([
        ['kcal', nutrients.kcal * grams / 100], ['protein', nutrients.protein * grams / 100],
        ['carbs', nutrients.carbs * grams / 100], ['fat', nutrients.fat * grams / 100],
        ['satfat', nutrients.satfat * grams / 100], ['fiber', nutrients.fiber * grams / 100],
        ['sugar', nutrients.sugar * grams / 100], ['sodium', nutrients.sodium * grams / 100],
      ].map(([k, v]) => [k, v]))),
    });
  }

  const total = roundNutrients(totals);
  const perServing = {
    calories: Math.round(total.calories / servingsN),
    protein: Math.round((total.protein / servingsN) * 10) / 10,
    carbs: Math.round((total.carbs / servingsN) * 10) / 10,
    fat: Math.round((total.fat / servingsN) * 10) / 10,
    satfat: Math.round((total.satfat / servingsN) * 10) / 10,
    fiber: Math.round((total.fiber / servingsN) * 10) / 10,
    sugar: Math.round((total.sugar / servingsN) * 10) / 10,
    sodium: Math.round(total.sodium / servingsN),
  };

  return {
    servings: servingsN,
    provider: provider === 'usda' && !usdaKey ? 'builtin' : provider,
    source: provider === 'usda' && usdaKey ? 'USDA FoodData Central + built-in dataset' : 'Built-in nutrition dataset (USDA reference values)',
    estimated: true,
    disclaimer: 'Nutrition values are estimates calculated from ingredient quantities. Actual values vary by brand, preparation and portion size.',
    total,
    perServing,
    ingredients: rows,
    unmatched: rows.filter((r) => !r.matched).map((r) => r.input),
    matchedCount,
    unmatchedCount,
    confidence: lines.length ? Math.round((matchedCount / lines.length) * 100) : 0,
    calculatedAt: new Date().toISOString(),
  };
}

module.exports = {
  calculateNutrition, parseIngredient, matchFood, FOODS, UNIT_GRAMS,
};
