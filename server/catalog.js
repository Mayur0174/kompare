// Seed catalog. Prices are in INR (whole rupees).
export const PLATFORMS = [
  { id: 'amazon', name: 'Amazon', color: '#FF9900', domain: 'amazon.in', shipping_fee: 40, free_shipping_above: 499, return_days: 7, cod: 1 },
  { id: 'flipkart', name: 'Flipkart', color: '#2874F0', domain: 'flipkart.com', shipping_fee: 40, free_shipping_above: 500, return_days: 7, cod: 1 },
  { id: 'myntra', name: 'Myntra', color: '#FF3F6C', domain: 'myntra.com', shipping_fee: 79, free_shipping_above: 799, return_days: 14, cod: 1 },
  { id: 'ajio', name: 'AJIO', color: '#2C4152', domain: 'ajio.com', shipping_fee: 99, free_shipping_above: 999, return_days: 15, cod: 1 },
  { id: 'croma', name: 'Croma', color: '#12DAA8', domain: 'croma.com', shipping_fee: 0, free_shipping_above: 0, return_days: 7, cod: 1 },
  { id: 'reliance', name: 'Reliance Digital', color: '#E42529', domain: 'reliancedigital.in', shipping_fee: 0, free_shipping_above: 0, return_days: 7, cod: 1 },
  { id: 'tatacliq', name: 'Tata CLiQ', color: '#A2218C', domain: 'tatacliq.com', shipping_fee: 50, free_shipping_above: 699, return_days: 10, cod: 1 },
  { id: 'nykaa', name: 'Nykaa', color: '#FC2779', domain: 'nykaa.com', shipping_fee: 70, free_shipping_above: 499, return_days: 15, cod: 1 },
  { id: 'meesho', name: 'Meesho', color: '#9F2089', domain: 'meesho.com', shipping_fee: 0, free_shipping_above: 0, return_days: 7, cod: 1 },
];

const ELEC = ['amazon', 'flipkart', 'croma', 'reliance', 'tatacliq'];
const FASHION = ['amazon', 'flipkart', 'myntra', 'ajio', 'tatacliq', 'meesho'];
const BEAUTY = ['amazon', 'flipkart', 'nykaa', 'myntra', 'tatacliq'];
const HOME = ['amazon', 'flipkart', 'tatacliq', 'meesho', 'reliance'];

// Shortcuts on the home screen. Each one runs a real live search across all stores.
export const CATEGORIES = [
  { id: 'mobiles', name: 'Mobiles', emoji: '📱', query: 'smartphones', platforms: ELEC },
  { id: 'laptops', name: 'Laptops', emoji: '💻', query: 'laptops', platforms: ELEC },
  { id: 'audio', name: 'Headphones', emoji: '🎧', query: 'wireless earbuds', platforms: ELEC },
  { id: 'wearables', name: 'Smartwatches', emoji: '⌚', query: 'smartwatch', platforms: ELEC },
  { id: 'appliances', name: 'TV & Appliances', emoji: '📺', query: 'smart tv 43 inch', platforms: ELEC },
  { id: 'fashion', name: 'Fashion', emoji: '👕', query: 'men t-shirt', platforms: FASHION },
  { id: 'footwear', name: 'Footwear', emoji: '👟', query: 'running shoes', platforms: FASHION },
  { id: 'beauty', name: 'Beauty', emoji: '💄', query: 'sunscreen spf 50', platforms: BEAUTY },
  { id: 'home', name: 'Home & Kitchen', emoji: '🏠', query: 'air fryer', platforms: HOME },
];

// Real search pages on each store ({q} = URL-encoded query). Always lead to live results on the store itself.
export const SEARCH_URLS = {
  amazon: 'https://www.amazon.in/s?k={q}',
  flipkart: 'https://www.flipkart.com/search?q={q}',
  myntra: 'https://www.myntra.com/{q}',
  ajio: 'https://www.ajio.com/search/?text={q}',
  croma: 'https://www.croma.com/searchB?q={q}',
  reliance: 'https://www.reliancedigital.in/products?q={q}',
  tatacliq: 'https://www.tatacliq.com/search/?searchCategory=all&text={q}',
  nykaa: 'https://www.nykaa.com/search/result/?q={q}',
  meesho: 'https://www.meesho.com/search?q={q}',
};

