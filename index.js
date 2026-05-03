require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const cron = require('node-cron');
const axios = require('axios');
const { dbAsync } = require('./database');
const { setupAntiSpam } = require('./modules/antispam');

const token = process.env.BOT_TOKEN;
if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
    console.error('❌ ERROR: BOT_TOKEN is missing! Please set it in your Render Environment variables.');
    process.exit(1);
}

const bot = new Telegraf(token);

bot.catch((err, ctx) => {
    console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
});

// Middleware to inject database into context
bot.use((ctx, next) => {
    ctx.dbAsync = dbAsync;
    return next();
});

// Setup Anti-Spam module
setupAntiSpam(bot);

bot.start((ctx) => {
    ctx.reply('🛡️ *AI Group Manager Active*\n\nI am monitoring this group for:\n- Promotional images ("link in bio")\n- Long spam paragraphs\n- 3-warning kick system\n- Language policy (English/Hindi only)', { parse_mode: 'Markdown' });
});

// Function to start the bot
async function startBot() {
    console.log('Waiting for database connection...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('Attempting to launch bot...');
    try {
        await bot.launch({ polling: { dropPendingUpdates: true } });
        console.log('🚀 Bot is running and protecting your groups!');
    } catch (err) {
        console.error('Failed to launch bot:', err);
    }
}

startBot();

// ==========================================
// RENDER.COM KEEP-ALIVE SERVER
// ==========================================
const app = express();
app.get('/', (req, res) => res.send('AI Group Manager Bot is active and protecting groups!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Keep-alive server listening on port ${PORT}`);
});

// Self-ping cron job to keep Render awake (every 14 minutes)
cron.schedule('*/14 * * * *', async () => {
    const url = process.env.RENDER_EXTERNAL_URL; 
    if (url) {
        try {
            await axios.get(url);
            console.log(`[Keep-Alive] Pinged ${url} successfully.`);
        } catch (e) {
            console.error(`[Keep-Alive] Ping failed:`, e.message);
        }
    }
});

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
