// add_product_to_all_collections.js
import fetch from 'node-fetch';
import {
  COLLECTION_IDS,
  FREEFORM_SHAPES,
  SHAPE_COLLECTIONS,
  stoneAliases,
  buildGemstoneCollectionMap
} from './collection_mapping.js';
import fs from 'fs/promises';

// Shopify credentials
const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN;

// Load collections and build gemstone map
let collections;
let gemstoneCollectionMap;

async function loadCollections() {
    try {
        const collectionsData = await fs.readFile('./collections-2025-05-12T07-45-29-851Z.json', 'utf8');
        collections = JSON.parse(collectionsData);
        gemstoneCollectionMap = buildGemstoneCollectionMap(collections);
        console.log('Collections loaded successfully');
    } catch (error) {
        console.error('Error loading collections:', error);
        throw new Error('Failed to load collections data');
    }
}

function hasWord(title, word) {
    return new RegExp(`\\b${word}\\b`, 'i').test(title);
}

function getCollectionIdsForTitle(title) {
    if (!title) {
        console.log('No title provided');
        return [];
    }

    const upperTitle = title.toUpperCase();
    const collectionIds = new Set();

    // Main mapping logic
    if (hasWord(upperTitle, "BEADS")) collectionIds.add(COLLECTION_IDS.BEADS);
    if (hasWord(upperTitle, "ROUND")) {
        if (hasWord(upperTitle, "POLISH") || hasWord(upperTitle, "POLISHED")) collectionIds.add(COLLECTION_IDS.ROUND_POLISHED);
        if (hasWord(upperTitle, "FACETED") || hasWord(upperTitle, "FACET")) collectionIds.add(COLLECTION_IDS.ROUND_FACETED);
        if (hasWord(upperTitle, "FROSTED") || hasWord(upperTitle, "FROST")) collectionIds.add(COLLECTION_IDS.ROUND_FROSTED);
    }
    if (hasWord(upperTitle, "RONDELLE")) {
        if (hasWord(upperTitle, "POLISH") || hasWord(upperTitle, "POLISHED")) collectionIds.add(COLLECTION_IDS.RONDELLE_POLISHED);
        if (hasWord(upperTitle, "FACETED") || hasWord(upperTitle, "FACET")) collectionIds.add(COLLECTION_IDS.RONDELLE_FACETED);
        if (hasWord(upperTitle, "FROSTED") || hasWord(upperTitle, "FROST")) collectionIds.add(COLLECTION_IDS.RONDELLE_FROSTED);
    }
    for (const [shape, collectionId] of Object.entries(SHAPE_COLLECTIONS)) {
        if (hasWord(upperTitle, shape)) collectionIds.add(collectionId);
    }
    for (const shape of FREEFORM_SHAPES) {
        if (hasWord(upperTitle, shape)) collectionIds.add(COLLECTION_IDS.FREEFORM);
    }

    // Stone name logic with aliases
    for (const [canonical, aliases] of Object.entries(stoneAliases)) {
        for (const alias of aliases) {
            if (hasWord(upperTitle, alias)) {
                if (gemstoneCollectionMap[canonical]) {
                    collectionIds.add(gemstoneCollectionMap[canonical]);
                }
                break;
            }
        }
    }

    return Array.from(collectionIds);
}

async function addProductToCollection(productId, collectionId, retries = 3) {
    const endpoint = `https://${SHOPIFY_STORE}.myshopify.com/admin/api/2023-10/collects.json`;
    const body = JSON.stringify({
        collect: {
            product_id: productId,
            collection_id: collectionId
        }
    });
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_TOKEN,
                'Content-Type': 'application/json',
            },
            body
        });
        if (!res.ok) {
            const errorText = await res.text();
            if (res.status === 429) {
                // Rate limit hit, wait longer
                console.log('Rate limit hit, waiting 2 seconds...');
                await delay(2000);
                if (retries > 0) {
                    return addProductToCollection(productId, collectionId, retries - 1);
                }
            }
            console.error(`Failed to add product ${productId} to collection ${collectionId}: ${res.status} ${res.statusText} - ${errorText}`);
            throw new Error(`Failed to add product to collection: ${errorText}`);
        } else {
            console.log(`Added product ${productId} to collection ${collectionId}`);
        }
    } catch (err) {
        if (retries > 0) {
            console.warn(`Error, retrying (${retries})...`);
            await delay(2000); // Increased delay for retries
            return addProductToCollection(productId, collectionId, retries - 1);
        } else {
            console.error(`Failed after retries:`, err);
            throw err;
        }
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function processProducts(productData = null) {
    try {
        // Load collections if not already loaded
        if (!collections) {
            await loadCollections();
        }

        // If productData is provided, process only that product
        if (productData) {
            const { id, title } = productData;
            console.log(`Processing product: ${title} (ID: ${id})`);
            const collectionIds = getCollectionIdsForTitle(title);
            
            if (collectionIds.length === 0) {
                console.log(`No matching collections found for product: ${title}`);
                return;
            }
            
            console.log(`Found ${collectionIds.length} collections to add product to:`, collectionIds);
            
            // Process collections in sequence with delays
            for (const collectionId of collectionIds) {
                try {
                    await addProductToCollection(id, collectionId);
                    // Add a longer delay between collection additions
                    await delay(1000);
                } catch (error) {
                    console.error(`Failed to add to collection ${collectionId}:`, error);
                    // Continue with next collection even if one fails
                    continue;
                }
            }
            return;
        }

        // Otherwise, process all recent products
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const endpoint = `https://${SHOPIFY_STORE}.myshopify.com/admin/api/2023-10/products.json?created_at_min=${oneHourAgo}&updated_at_min=${oneHourAgo}`;
        
        const response = await fetch(endpoint, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_TOKEN,
                'Content-Type': 'application/json',
            }
        });
        
        if (!response.ok) {
            if (response.status === 429) {
                console.log('Rate limit hit, waiting 2 seconds...');
                await delay(2000);
                return processProducts(productData);
            }
            throw new Error(`Failed to fetch products: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        const products = data.products;
        
        if (products.length === 0) {
            console.log('No new or updated products found in the last hour.');
            return;
        }
        
        console.log(`Found ${products.length} products to process.`);
        
        for (const product of products) {
            console.log(`\nProcessing product: ${product.title} (ID: ${product.id})`);
            const collectionIds = getCollectionIdsForTitle(product.title);
            
            if (collectionIds.length === 0) {
                console.log(`No matching collections found for product: ${product.title}`);
                continue;
            }
            
            console.log(`Found ${collectionIds.length} collections to add product to:`, collectionIds);
            
            // Process collections in sequence with delays
            for (const collectionId of collectionIds) {
                try {
                    await addProductToCollection(product.id, collectionId);
                    // Add a longer delay between collection additions
                    await delay(1000);
                } catch (error) {
                    console.error(`Failed to add to collection ${collectionId}:`, error);
                    // Continue with next collection even if one fails
                    continue;
                }
            }
        }
        
        console.log('\nFinished processing all products.');
    } catch (error) {
        console.error('Error in processProducts:', error);
        throw error;
    }
}

// Only run directly if this file is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    processProducts().catch(console.error);
}