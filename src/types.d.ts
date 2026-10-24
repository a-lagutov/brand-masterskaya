/** A plan or an elective with its price in rubles. */
interface PriceItem {
  title: string;
  price: number;
}

/** Global substituted from src/prices.json by scripts/build.mjs at build time. */
declare const __PRICES__: {
  plans: Record<string, PriceItem>;
  electives: Record<string, PriceItem>;
  electivesPlan: string;
};

/** The package ships no types; only the call build.mjs makes is described. */
declare module 'html-minifier-terser' {
  export function minify(html: string, options: Record<string, unknown>): Promise<string>;
}
