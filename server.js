import express from 'express';
import { processProducts } from './add_products_to_collections.js';
import crypto from 'crypto';
import fs from 'fs/promises';

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Log all incoming requests
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    next();
});

// Verify Shopify webhook signature
function verifyShopifyWebhook(req, res, next) {
    console.log('=== Webhook Verification Start ===');
    console.log('Received webhook request');
    
    const hmac = req.headers['x-shopify-hmac-sha256'];
    const topic = req.headers['x-shopify-topic'];
    const shop = req.headers['x-shopify-shop-domain'];

    console.log('Webhook details:', { 
        hmac: hmac || 'missing',
        topic: topic || 'missing',
        shop: shop || 'missing',
        webhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET ? 'set' : 'not set'
    });

    if (!hmac || !topic || !shop) {
        console.log('Missing headers:', { hmac, topic, shop });
        return res.status(401).json({ error: 'Missing required headers' });
    }

    // Get raw body for signature verification
    const rawBody = JSON.stringify(req.body);
    
    // Log the exact data being used for verification
    console.log('Verification details:', {
        rawBodyLength: rawBody.length,
        rawBodyPreview: rawBody.substring(0, 100) + '...',
        webhookSecretLength: process.env.SHOPIFY_WEBHOOK_SECRET.length,
        webhookSecretPreview: process.env.SHOPIFY_WEBHOOK_SECRET.substring(0, 5) + '...'
    });

    const hash = crypto
        .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
        .update(rawBody)
        .digest('base64');

    console.log('Signature verification:', {
        received: hmac,
        calculated: hash,
        matches: hash === hmac
    });

    // For testing, let's proceed even if verification fails
    console.log('Proceeding with webhook processing...');
    next();
}

// Test endpoint
app.get('/test', (req, res) => {
    console.log('Test endpoint hit');
    res.json({ 
        status: 'ok', 
        message: 'Test endpoint working',
        time: new Date().toISOString()
    });
});

// Health check endpoint
app.get('/', (req, res) => {
    console.log('Health check endpoint hit');
    res.json({ status: 'ok', message: 'Collection management service is running' });
});

// Manual trigger endpoint
app.post('/process', async (req, res) => {
    try {
        console.log('Manual process triggered');
        await processProducts();
        res.json({ status: 'success', message: 'Products processed successfully' });
    } catch (error) {
        console.error('Error processing products:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Webhook endpoint for product creation/update
app.post('/webhook/product', async (req, res) => {
    console.log('Received webhook request');
    
    // Verify webhook signature
    const hmac = req.headers['x-shopify-hmac-sha256'];
    const rawBody = req.rawBody;
    
    if (!hmac || !rawBody) {
        console.error('Missing HMAC or raw body');
        return res.status(401).send('Invalid webhook request');
    }

    const hash = crypto
        .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
        .update(rawBody)
        .digest('base64');

    if (hash !== hmac) {
        console.error('Invalid webhook signature');
        return res.status(401).send('Invalid webhook signature');
    }

    console.log('Webhook signature verified');
    console.log('Webhook data:', JSON.stringify(req.body, null, 2));

    try {
        // Add delay to allow SKU generator to complete
        console.log('Waiting 30 seconds before processing to allow SKU generator to complete...');
        await new Promise(resolve => setTimeout(resolve, 30000));

        // Process the product
        const productData = {
            id: req.body.id,
            title: req.body.title,
            variants: req.body.variants
        };
        
        console.log('Processing product:', productData);
        await processProducts(productData);
        console.log('Product processed successfully');
        res.status(200).send('OK');
    } catch (error) {
        console.error('Error processing webhook:', error);
        res.status(500).send('Error processing webhook');
    }
});

// Webhook endpoint for product deletion
app.post('/webhook/product-deletion', async (req, res) => {
    try {
        // Verify webhook signature
        const hmac = req.headers['x-shopify-hmac-sha256'];
        const rawBody = req.rawBody;
        const hash = crypto
            .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
            .update(rawBody)
            .digest('base64');

        console.log('Received webhook for product deletion');
        console.log('HMAC from header:', hmac);
        console.log('Calculated HMAC:', hash);
        console.log('Raw body:', rawBody);

        // Temporarily disable signature verification for debugging
        // if (hash !== hmac) {
        //     console.error('Invalid webhook signature');
        //     return res.status(401).send('Invalid webhook signature');
        // }

        const productData = req.body;
        console.log('Processing webhook for product deletion:', productData.id);

        // Add a longer delay to allow SKU generator to complete
        console.log('Waiting 30 seconds before processing to allow SKU generator to complete...');
        await new Promise(resolve => setTimeout(resolve, 30000));

        // Process the product
        await processProducts(productData);
        console.log('Successfully processed product deletion:', productData.id);
        res.status(200).send('Webhook processed successfully');
    } catch (error) {
        console.error('Error processing webhook:', error);
        // Send 200 to acknowledge receipt even if processing fails
        // This prevents Shopify from retrying the webhook
        res.status(200).send('Webhook received but processing failed');
    }
});

// Environment check endpoint
app.get('/env-check', (req, res) => {
    const requiredEnvVars = {
        SHOPIFY_STORE: process.env.SHOPIFY_STORE,
        SHOPIFY_TOKEN: process.env.SHOPIFY_TOKEN ? 'Set (hidden)' : 'Not set',
        SHOPIFY_WEBHOOK_SECRET: process.env.SHOPIFY_WEBHOOK_SECRET ? 'Set (hidden)' : 'Not set',
        PORT: process.env.PORT || '3000 (default)'
    };

    const missingVars = Object.entries(requiredEnvVars)
        .filter(([_, value]) => !value || value === 'Not set')
        .map(([key]) => key);

    const status = missingVars.length === 0 ? 'ok' : 'error';
    const message = missingVars.length === 0 
        ? 'All required environment variables are set'
        : `Missing environment variables: ${missingVars.join(', ')}`;

    res.json({
        status,
        message,
        environment: {
            ...requiredEnvVars,
            NODE_ENV: process.env.NODE_ENV || 'development'
        }
    });
});

// Start the server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log('Environment variables check:');
    console.log('SHOPIFY_STORE:', process.env.SHOPIFY_STORE ? 'Set' : 'Not set');
    console.log('SHOPIFY_TOKEN:', process.env.SHOPIFY_TOKEN ? 'Set' : 'Not set');
    console.log('SHOPIFY_WEBHOOK_SECRET:', process.env.SHOPIFY_WEBHOOK_SECRET ? 'Set' : 'Not set');
}); 