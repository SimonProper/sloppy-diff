import { parseDiff } from '$lib/diff/parse';
import { annotateChanges } from '$lib/server/changes';
import { highlightFile } from '$lib/server/highlight';

// a made-up change that shows the diff colours and most of the syntax ones
const SAMPLE = `diff --git a/src/lib/cart.ts b/src/lib/cart.ts
--- a/src/lib/cart.ts
+++ b/src/lib/cart.ts
@@ -1,16 +1,18 @@
 import { round } from './money';
 
-const TAX = 0.2;
+// VAT, the same for every item in the cart
+const TAX_RATE = 0.25;
 
 export interface Item {
 	name: string;
 	price: number;
+	quantity: number;
 }
 
 /** The cart's total with tax, in whole cents. */
 export function total(items: Item[], discount = 0): number {
-	const sum = items.reduce((acc, item) => acc + item.price, 0);
-	return round(sum * (1 + TAX) - discount);
+	const sum = items.reduce((acc, item) => acc + item.price * item.quantity, 0);
+	return round(sum * (1 + TAX_RATE) - discount);
 }
 
 export const isEmpty = (items: Item[]) => items.length === 0;
`;

export function load() {
	const files = parseDiff(SAMPLE);
	annotateChanges(files, 'tokens');
	return { file: highlightFile(files[0]) };
}
